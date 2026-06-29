#!/usr/bin/env python3
"""
ctc_citation_sidecar.py — Python sidecar for CTCCitationMemory (ttruthdesk-platform)

Reads JSON from stdin, executes the requested method, writes JSON to stdout.

Methods:
  ingest_chain          — Index a citation chain episode into the CTC graph
  reconstruct           — Run MRAgent active reconstruction for a question
  distortion_patterns   — Get distortion patterns for a source PMID
  trace_distortion_path — Trace the full distortion path from a source PMID
  high_distortion_claims — Find claims with high distortion scores
"""

import json
import logging
import sqlite3
import sys
from pathlib import Path

# Add evolva-mragent to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
logger = logging.getLogger(__name__)


def handle_ingest_chain(args: dict) -> dict:
    """Index a citation chain episode into the CTC graph."""
    from evolva_mragent.memory.system import MemorySystem
    from evolva_mragent.memory.indexer import CitationIndexer
    from evolva_mragent.memory.persistence import MemoryPersistence
    from evolva_mragent.llm.controller import LLMController

    episode = args.get("episode", {})
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_citation_graph.db"))

    if not episode:
        return {"ok": False, "error": "episode is required"}

    persistence = MemoryPersistence()
    memory = None
    if db_path.exists():
        try:
            memory = persistence.load(str(db_path))
        except Exception as e:
            logger.warning(f"Failed to load existing graph: {e}")
            memory = MemorySystem()
    else:
        memory = MemorySystem()
        db_path.parent.mkdir(parents=True, exist_ok=True)

    llm = LLMController()
    indexer = CitationIndexer(llm=llm, memory=memory)
    indexer.index_episodes([episode])

    persistence.save(memory, str(db_path))
    return {"ok": True, "events": len(memory.episode_events)}


def handle_reconstruct(args: dict) -> dict:
    """Run MRAgent active reconstruction for a question."""
    from evolva_mragent.memory.persistence import MemoryPersistence
    from evolva_mragent.memory.controller import MemoryController
    from evolva_mragent.llm.controller import LLMController
    from evolva_mragent.agent.reconstruct import ActiveReconstructionAgent
    from evolva_mragent.prompts.evolva import EvolvaPrompts

    question = args.get("question", "")
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_citation_graph.db"))

    if not question:
        return {"error": "question is required", "answer": "", "confidence": "low"}

    if not db_path.exists():
        return {
            "error": f"CTC citation graph not found at {db_path}. Ingest some chains first.",
            "answer": "",
            "confidence": "low",
            "question": question,
            "supports": [],
            "reasoning": "",
            "tool_calls_made": 0,
            "rounds": 0,
            "evidence_texts": [],
        }

    persistence = MemoryPersistence()
    memory = persistence.load(str(db_path))
    controller = MemoryController(memory)
    llm = LLMController()
    agent = ActiveReconstructionAgent(
        controller=controller,
        llm=llm,
        system_prompt=EvolvaPrompts.CITATION_SYSTEM_PROMPT,
    )

    result = agent.reconstruct(question)
    return result.to_dict()


def handle_distortion_patterns(args: dict) -> dict:
    """Get distortion patterns for a source PMID."""
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_citation_graph.db"))
    source_pmid = args.get("source_pmid", "")

    if not db_path.exists():
        return {"source_pmid": source_pmid, "patterns": []}

    try:
        conn = sqlite3.connect(str(db_path))
        # Find all episodes for this PMID via the cue graph
        rows = conn.execute(
            """SELECT e.text, e.domain, e.time
               FROM episode_events e
               JOIN event_to_keys etk ON e.event_id = etk.event_id
               JOIN key_nodes k ON etk.key_id = k.key_id
               WHERE k.key_id = ?
               LIMIT 200""",
            (f"pmid:{source_pmid}",)
        ).fetchall()
        conn.close()

        # Parse distortion types from event texts
        from collections import Counter
        type_counter: Counter = Counter()
        type_examples: dict = {}
        type_scores: dict = {}

        for (text, domain, time) in rows:
            try:
                data = json.loads(text) if text.startswith('{') else {}
                dtype = data.get("distortion_type", "unknown")
                score = float(data.get("distortion_score", 0))
                pmid = data.get("pmid", "")
                type_counter[dtype] += 1
                if dtype not in type_examples:
                    type_examples[dtype] = []
                if pmid and len(type_examples[dtype]) < 3:
                    type_examples[dtype].append(pmid)
                if dtype not in type_scores:
                    type_scores[dtype] = []
                type_scores[dtype].append(score)
            except Exception:
                continue

        patterns = []
        for dtype, count in type_counter.most_common():
            avg_score = sum(type_scores.get(dtype, [0])) / max(len(type_scores.get(dtype, [1])), 1)
            patterns.append({
                "distortion_type": dtype,
                "count": count,
                "example_pmids": type_examples.get(dtype, []),
                "avg_score": round(avg_score, 3),
                "description": _distortion_description(dtype),
            })

        return {"source_pmid": source_pmid, "patterns": patterns}
    except Exception as e:
        return {"source_pmid": source_pmid, "patterns": [], "error": str(e)}


def handle_trace_distortion_path(args: dict) -> dict:
    """Trace the full distortion path from a source PMID."""
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_citation_graph.db"))
    source_pmid = args.get("source_pmid", "")

    if not db_path.exists():
        return {"source_pmid": source_pmid, "chain": [], "max_distortion": 0}

    try:
        conn = sqlite3.connect(str(db_path))
        rows = conn.execute(
            """SELECT e.event_id, e.text, e.time
               FROM episode_events e
               JOIN event_to_keys etk ON e.event_id = etk.event_id
               JOIN key_nodes k ON etk.key_id = k.key_id
               WHERE k.key_id = ?
               ORDER BY e.time ASC""",
            (f"pmid:{source_pmid}",)
        ).fetchall()
        conn.close()

        chain = []
        max_distortion = 0.0
        for (event_id, text, time) in rows:
            try:
                data = json.loads(text) if text.startswith('{') else {}
                score = float(data.get("distortion_score", 0))
                max_distortion = max(max_distortion, score)
                chain.append({
                    "hop": data.get("hop_number", len(chain) + 1),
                    "pmid": data.get("pmid", ""),
                    "title": data.get("title", ""),
                    "distortion_score": score,
                    "distortion_type": data.get("distortion_type", "unknown"),
                    "citing_claim": data.get("citing_claim_text", ""),
                })
            except Exception:
                continue

        chain.sort(key=lambda x: x["hop"])
        return {"source_pmid": source_pmid, "chain": chain, "max_distortion": round(max_distortion, 3)}
    except Exception as e:
        return {"source_pmid": source_pmid, "chain": [], "max_distortion": 0, "error": str(e)}


def handle_high_distortion_claims(args: dict) -> dict:
    """Find claims with high distortion scores."""
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_citation_graph.db"))
    threshold = float(args.get("threshold", 0.7))
    limit = int(args.get("limit", 20))

    if not db_path.exists():
        return {"claims": []}

    try:
        conn = sqlite3.connect(str(db_path))
        # Get all episodes with high distortion from the domain tag
        rows = conn.execute(
            """SELECT DISTINCT e.event_id, e.text, e.domain, e.time
               FROM episode_events e
               WHERE e.domain = 'citation'
               ORDER BY e.time DESC LIMIT 500"""
        ).fetchall()
        conn.close()

        high_distortion = []
        seen_pmids: set = set()

        for (event_id, text, domain, time) in rows:
            try:
                data = json.loads(text) if text.startswith('{') else {}
                score = float(data.get("distortion_score", 0))
                if score < threshold:
                    continue
                source_pmid = data.get("source_pmid", "")
                if source_pmid in seen_pmids:
                    continue
                seen_pmids.add(source_pmid)
                high_distortion.append({
                    "source_pmid": source_pmid,
                    "original_claim": data.get("original_claim", ""),
                    "max_distortion": score,
                    "hop_count": data.get("hop_count", 1),
                    "dominant_type": data.get("distortion_type", "unknown"),
                })
            except Exception:
                continue

        high_distortion.sort(key=lambda x: x["max_distortion"], reverse=True)
        return {"claims": high_distortion[:limit]}
    except Exception as e:
        return {"claims": [], "error": str(e)}


def _distortion_description(dtype: str) -> str:
    descriptions = {
        "exaggeration": "Claim strengthened beyond what the source supports",
        "overgeneralization": "Finding applied to a broader population than studied",
        "omission": "Key caveats or limitations removed from the original claim",
        "reversal": "Claim direction reversed (positive → negative or vice versa)",
        "fabrication": "Claim not present in the original source",
        "faithful": "Claim accurately represents the original finding",
        "unknown": "Distortion type could not be determined",
    }
    return descriptions.get(dtype, f"Distortion type: {dtype}")


HANDLERS = {
    "ingest_chain": handle_ingest_chain,
    "reconstruct": handle_reconstruct,
    "distortion_patterns": handle_distortion_patterns,
    "trace_distortion_path": handle_trace_distortion_path,
    "high_distortion_claims": handle_high_distortion_claims,
}


def main():
    try:
        raw = sys.stdin.read().strip()
        if not raw:
            print(json.dumps({"error": "Empty input"}))
            return

        request = json.loads(raw)
        method = request.get("method", "")
        args = request.get("args", {})

        handler = HANDLERS.get(method)
        if not handler:
            print(json.dumps({"error": f"Unknown method: {method}"}))
            return

        response = handler(args)
        print(json.dumps(response))

    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"JSON parse error: {e}"}))
    except Exception as e:
        logger.exception("Sidecar error")
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
