"""
vectorSidecar.py — TurboVec semantic search sidecar
====================================================
A lightweight FastAPI service that:
  1. Loads a compact sentence-transformer model (all-MiniLM-L6-v2, ~22 MB)
  2. Maintains an in-memory FAISS index of claim texts
  3. Exposes three HTTP endpoints:
       POST /index   — add/update a batch of claim vectors
       POST /search  — return top-k similar claim IDs for a query
       GET  /health  — liveness probe

The Node.js vectorStore.ts bridge calls this service.
If the sidecar is not running, vectorStore.ts falls back to SQL full-text search.

Usage:
  python3 server/vectorSidecar.py
  # or: uvicorn server.vectorSidecar:app --port 5001
"""

from __future__ import annotations

import os
import logging
from typing import List, Optional

import numpy as np
import faiss
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vectorSidecar")

# ─── Model ────────────────────────────────────────────────────────────────────
MODEL_NAME = os.getenv("VECTOR_MODEL", "all-MiniLM-L6-v2")
logger.info(f"Loading sentence-transformer model: {MODEL_NAME}")
model = SentenceTransformer(MODEL_NAME)
DIM = model.get_sentence_embedding_dimension()
logger.info(f"Model loaded. Embedding dimension: {DIM}")

# ─── FAISS index ──────────────────────────────────────────────────────────────
# Inner-product index (cosine similarity after L2-normalisation)
index = faiss.IndexFlatIP(DIM)
# Map from FAISS internal position → claim ID
id_map: List[int] = []

app = FastAPI(title="TurboVec Sidecar", version="1.0.0")

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
    return {"status": "ok", "indexed": len(id_map), "dim": DIM}


@app.post("/index")
def index_claims(req: IndexRequest):
    """
    Upsert a batch of claim texts into the FAISS index.
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
    """Clear the entire FAISS index (admin use only)."""
    global index, id_map
    index = faiss.IndexFlatIP(DIM)
    id_map = []
    return {"cleared": True}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("VECTOR_SIDECAR_PORT", "5001"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
