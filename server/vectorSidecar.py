"""
vectorSidecar.py — TurboVec semantic search sidecar
====================================================
A lightweight FastAPI service that:
  1. Loads a compact sentence-transformer model (all-MiniLM-L6-v2, ~22 MB)
  2. Maintains an in-memory FAISS index of claim texts
  3. Persists the FAISS index + id_map to S3 on every /index call
  4. Reloads the index from S3 on startup (warm start — no re-embedding needed)
  5. Exposes four HTTP endpoints:
       POST /index   — add/update a batch of claim vectors (auto-saves to S3)
       POST /search  — return top-k similar claim IDs for a query
       GET  /health  — liveness probe
       DELETE /index — clear the index (also clears S3 snapshot)

S3 persistence uses the Manus built-in storage API (same as storagePut in Node).
Set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY env vars (auto-injected by platform).

Usage:
  python3 server/vectorSidecar.py
  # or: uvicorn server.vectorSidecar:app --port 5001
"""

from __future__ import annotations

import io
import json
import logging
import os
import pickle
import threading
from typing import List, Optional

import numpy as np
import faiss
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vectorSidecar")

# ─── Config ───────────────────────────────────────────────────────────────────
MODEL_NAME = os.getenv("VECTOR_MODEL", "all-MiniLM-L6-v2")
FORGE_API_URL = os.getenv("BUILT_IN_FORGE_API_URL", "")
FORGE_API_KEY = os.getenv("BUILT_IN_FORGE_API_KEY", "")
INDEX_S3_KEY = "turbovec/faiss_index.pkl"   # relative key in Manus storage

# ─── Model ────────────────────────────────────────────────────────────────────
logger.info(f"Loading sentence-transformer model: {MODEL_NAME}")
model = SentenceTransformer(MODEL_NAME)
DIM = model.get_sentence_embedding_dimension()
logger.info(f"Model loaded. Embedding dimension: {DIM}")

# ─── FAISS index ──────────────────────────────────────────────────────────────
index = faiss.IndexFlatIP(DIM)
id_map: List[int] = []
_save_lock = threading.Lock()

# ─── S3 helpers ───────────────────────────────────────────────────────────────

def _storage_headers() -> dict:
    return {
        "Authorization": f"Bearer {FORGE_API_KEY}",
        "Content-Type": "application/octet-stream",
    }


def _save_to_s3() -> bool:
    """Serialize the FAISS index + id_map and upload to Manus storage."""
    if not FORGE_API_URL or not FORGE_API_KEY:
        logger.debug("S3 persistence disabled — FORGE env vars not set.")
        return False
    try:
        with _save_lock:
            buf = io.BytesIO()
            faiss.write_index(index, faiss.PyCallbackIOWriter(buf.write))
            snapshot = pickle.dumps({
                "faiss_bytes": buf.getvalue(),
                "id_map": id_map,
                "dim": DIM,
            })
        url = f"{FORGE_API_URL}/storage/v1/put/{INDEX_S3_KEY}"
        resp = requests.put(url, data=snapshot, headers=_storage_headers(), timeout=30)
        if resp.ok:
            logger.info(f"FAISS index saved to S3 ({len(snapshot):,} bytes, {len(id_map)} vectors)")
            return True
        else:
            logger.warning(f"S3 save failed: {resp.status_code} {resp.text[:200]}")
            return False
    except Exception as e:
        logger.warning(f"S3 save error: {e}")
        return False


def _load_from_s3() -> bool:
    """Download and restore the FAISS index + id_map from Manus storage."""
    global index, id_map
    if not FORGE_API_URL or not FORGE_API_KEY:
        logger.info("S3 persistence disabled — starting with empty index.")
        return False
    try:
        url = f"{FORGE_API_URL}/storage/v1/get/{INDEX_S3_KEY}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {FORGE_API_KEY}"}, timeout=30)
        if resp.status_code == 404:
            logger.info("No S3 snapshot found — starting with empty index.")
            return False
        if not resp.ok:
            logger.warning(f"S3 load failed: {resp.status_code} — starting with empty index.")
            return False
        snapshot = pickle.loads(resp.content)
        buf = io.BytesIO(snapshot["faiss_bytes"])
        loaded_index = faiss.read_index(faiss.PyCallbackIOReader(buf.read))
        loaded_id_map: List[int] = snapshot["id_map"]
        index = loaded_index
        id_map = loaded_id_map
        logger.info(f"FAISS index restored from S3 ({len(id_map)} vectors)")
        return True
    except Exception as e:
        logger.warning(f"S3 load error: {e} — starting with empty index.")
        return False


# ─── Startup: warm-load from S3 ───────────────────────────────────────────────
_load_from_s3()

# ─── FastAPI app ──────────────────────────────────────────────────────────────
app = FastAPI(title="TurboVec Sidecar", version="2.0.0")

# ─── Schemas ──────────────────────────────────────────────────────────────────

class IndexItem(BaseModel):
    id: int
    text: str

class IndexRequest(BaseModel):
    items: List[IndexItem]

class SearchRequest(BaseModel):
    query: str
    top_k: int = 10
    vertical: Optional[str] = None   # unused at vector layer; filtered by Node bridge
    verdict: Optional[str] = None    # unused at vector layer; filtered by Node bridge

class SearchResult(BaseModel):
    id: int
    score: float

class SearchResponse(BaseModel):
    results: List[SearchResult]
    total_indexed: int

# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "indexed": len(id_map),
        "dim": DIM,
        "s3_persistence": bool(FORGE_API_URL and FORGE_API_KEY),
        "s3_key": INDEX_S3_KEY,
    }


@app.post("/index")
def index_claims(req: IndexRequest):
    """
    Upsert a batch of claim texts into the FAISS index, then persist to S3.
    Duplicate IDs are not deduplicated at the vector layer — the caller
    (vectorStore.ts) is responsible for only sending new/changed items.
    """
    if not req.items:
        return {"indexed": 0, "total": len(id_map)}

    texts = [item.text for item in req.items]
    embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    embeddings = np.array(embeddings, dtype="float32")

    index.add(embeddings)
    id_map.extend([item.id for item in req.items])

    logger.info(f"Indexed {len(req.items)} items. Total: {len(id_map)}")

    # Persist to S3 asynchronously so the HTTP response is not delayed
    threading.Thread(target=_save_to_s3, daemon=True).start()

    return {"indexed": len(req.items), "total": len(id_map)}


@app.post("/search", response_model=SearchResponse)
def search_claims(req: SearchRequest):
    """
    Return the top-k most similar claim IDs for a natural-language query.
    Scores are cosine similarities in [0, 1].
    """
    if len(id_map) == 0:
        return SearchResponse(results=[], total_indexed=0)

    k = min(req.top_k, len(id_map))
    query_vec = model.encode([req.query], normalize_embeddings=True, show_progress_bar=False)
    query_vec = np.array(query_vec, dtype="float32")

    scores, positions = index.search(query_vec, k)

    results: List[SearchResult] = []
    for score, pos in zip(scores[0], positions[0]):
        if pos < 0 or pos >= len(id_map):
            continue
        results.append(SearchResult(id=id_map[pos], score=float(score)))

    return SearchResponse(results=results, total_indexed=len(id_map))


@app.delete("/index")
def clear_index():
    """Clear the entire FAISS index (admin use only). Also clears the S3 snapshot."""
    global index, id_map
    index = faiss.IndexFlatIP(DIM)
    id_map = []
    # Overwrite S3 with empty index
    threading.Thread(target=_save_to_s3, daemon=True).start()
    return {"cleared": True}


@app.post("/save")
def force_save():
    """Manually trigger an S3 snapshot (e.g. called by swarm-tick)."""
    ok = _save_to_s3()
    return {"saved": ok, "total": len(id_map)}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("VECTOR_SIDECAR_PORT", "5001"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
