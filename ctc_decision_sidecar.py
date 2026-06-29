#!/usr/bin/env python3
"""
ctc_decision_sidecar.py — Python sidecar for CTCDecisionMemory (self-direct)

Reads JSON from stdin, executes the requested method, writes JSON to stdout.

Methods:
  ingest_directive   — Index a frontier directive into the CTC graph
  record_outcome     — Record the outcome of a directive
  reconstruct        — Run MRAgent active reconstruction for a question
  directive_patterns — Get convergence statistics per directive type
  gap_history        — Get full decision history for a gap
  recent_directives  — Get the most recent N directives
"""

import json
import logging
import sqlite3
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
logger = logging.getLogger(__name__)


def handle_ingest_directive(args: dict) -> dict:
    """Index a frontier directive into the CTC graph."""
    from evolva_mragent.memory.system import MemorySystem
    from evolva_mragent.memory.indexer import DecisionIndexer
    from evolva_mragent.memory.persistence import MemoryPersistence
    from evolva_mragent.llm.controller import LLMController

    episode = args.get("episode", {})
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_decision_graph.db"))

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
    indexer = DecisionIndexer(llm=llm, memory=memory)
    indexer.index_episodes([episode])

    persistence.save(memory, str(db_path))
    return {"ok": True, "events": len(memory.episode_events)}


def handle_record_outcome(args: dict) -> dict:
    """Record the outcome of a directive by updating the episode event."""
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_decision_graph.db"))
    directive_id = args.get("directive_id", "")
    outcome = args.get("outcome", "unknown")
    notes = args.get("notes", "")
    recorded_at = args.get("recorded_at", "")

    if not db_path.exists():
        return {"ok": False, "error": "CTC decision graph not found"}

    try:
        conn = sqlite3.connect(str(db_path))
        # Find the event for this directive
        rows = conn.execute(
            "SELECT event_id, text FROM episode_events WHERE origin LIKE ?",
            (f"%{directive_id}%",)
        ).fetchall()

        updated = 0
        for (event_id, text) in rows:
            try:
                data = json.loads(text) if text.startswith('{') else {}
                data["outcome"] = outcome
                data["outcome_notes"] = notes
                data["outcome_recorded_at"] = recorded_at
                conn.execute(
                    "UPDATE episode_events SET text = ? WHERE event_id = ?",
                    (json.dumps(data), event_id)
                )
                updated += 1
            except Exception:
                continue

        conn.commit()
        conn.close()
        return {"ok": True, "updated": updated}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def handle_reconstruct(args: dict) -> dict:
    """Run MRAgent active reconstruction for a question."""
    from evolva_mragent.memory.persistence import MemoryPersistence
    from evolva_mragent.memory.controller import MemoryController
    from evolva_mragent.llm.controller import LLMController
    from evolva_mragent.agent.reconstruct import ActiveReconstructionAgent
    from evolva_mragent.prompts.evolva import EvolvaPrompts

    question = args.get("question", "")
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_decision_graph.db"))

    if not question:
        return {"error": "question is required", "answer": "", "confidence": "low"}

    if not db_path.exists():
        return {
            "error": f"CTC decision graph not found at {db_path}. Ingest some directives first.",
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
        system_prompt=EvolvaPrompts.SELF_DIRECT_SYSTEM_PROMPT,
    )

    result = agent.reconstruct(question)
    return result.to_dict()


def handle_directive_patterns(args: dict) -> dict:
    """Get convergence statistics per directive type."""
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_decision_graph.db"))

    if not db_path.exists():
        return {"patterns": []}

    try:
        conn = sqlite3.connect(str(db_path))
        rows = conn.execute(
            "SELECT text FROM episode_events WHERE domain = 'self_direct' LIMIT 2000"
        ).fetchall()
        conn.close()

        # Aggregate by directive type
        type_stats: dict = {}
        for (text,) in rows:
            try:
                data = json.loads(text) if text.startswith('{') else {}
                dtype = data.get("directive_type", "unknown")
                outcome = data.get("outcome", "unknown")
                confidence = float(data.get("confidence", 0))
                reason = data.get("reason", "")

                if dtype not in type_stats:
                    type_stats[dtype] = {
                        "total": 0, "converged": 0, "stalled": 0,
                        "expired": 0, "confidences": [], "reasons": []
                    }
                s = type_stats[dtype]
                s["total"] += 1
                s["confidences"].append(confidence)
                s["reasons"].extend(reason.lower().split())
                if outcome == "converged":
                    s["converged"] += 1
                elif outcome == "stalled":
                    s["stalled"] += 1
                elif outcome == "expired":
                    s["expired"] += 1
            except Exception:
                continue

        patterns = []
        for dtype, s in type_stats.items():
            total = s["total"]
            avg_conf = sum(s["confidences"]) / max(len(s["confidences"]), 1)
            conv_rate = s["converged"] / max(total, 1)
            # Top 5 reason keywords (excluding stopwords)
            stopwords = {"the", "a", "an", "is", "was", "for", "to", "in", "of", "and", "or"}
            word_counts = Counter(w for w in s["reasons"] if len(w) > 3 and w not in stopwords)
            top_keywords = [w for w, _ in word_counts.most_common(5)]

            patterns.append({
                "directive_type": dtype,
                "total_issued": total,
                "converged": s["converged"],
                "stalled": s["stalled"],
                "expired": s["expired"],
                "convergence_rate": round(conv_rate, 3),
                "avg_confidence": round(avg_conf, 3),
                "most_common_reason_keywords": top_keywords,
            })

        patterns.sort(key=lambda x: x["convergence_rate"], reverse=True)
        return {"patterns": patterns}
    except Exception as e:
        return {"patterns": [], "error": str(e)}


def handle_gap_history(args: dict) -> dict:
    """Get full decision history for a gap."""
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_decision_graph.db"))
    gap_id = str(args.get("gap_id", ""))

    if not db_path.exists():
        return {"gap_id": gap_id, "history": []}

    try:
        conn = sqlite3.connect(str(db_path))
        rows = conn.execute(
            """SELECT e.event_id, e.text, e.time
               FROM episode_events e
               JOIN event_to_keys etk ON e.event_id = etk.event_id
               JOIN key_nodes k ON etk.key_id = k.key_id
               WHERE k.key_id = ?
               ORDER BY e.time ASC""",
            (f"gap:{gap_id}",)
        ).fetchall()
        conn.close()

        history = []
        for (event_id, text, time) in rows:
            try:
                data = json.loads(text) if text.startswith('{') else {}
                history.append({
                    "directive_id": data.get("directive_id", event_id),
                    "directive_type": data.get("directive_type", "unknown"),
                    "reason": data.get("reason", ""),
                    "confidence": float(data.get("confidence", 0)),
                    "issued_at": data.get("issued_at", time),
                    "outcome": data.get("outcome", "unknown"),
                    "outcome_notes": data.get("outcome_notes"),
                })
            except Exception:
                continue

        return {"gap_id": gap_id, "history": history}
    except Exception as e:
        return {"gap_id": gap_id, "history": [], "error": str(e)}


def handle_recent_directives(args: dict) -> dict:
    """Get the most recent N directives."""
    db_path = Path(args.get("db_path", Path.home() / ".codebase-memory" / "ctc_decision_graph.db"))
    limit = int(args.get("limit", 20))

    if not db_path.exists():
        return {"directives": []}

    try:
        conn = sqlite3.connect(str(db_path))
        rows = conn.execute(
            """SELECT text FROM episode_events
               WHERE domain = 'self_direct'
               ORDER BY time DESC LIMIT ?""",
            (limit,)
        ).fetchall()
        conn.close()

        directives = []
        for (text,) in rows:
            try:
                data = json.loads(text) if text.startswith('{') else {}
                directives.append(data)
            except Exception:
                continue

        return {"directives": directives}
    except Exception as e:
        return {"directives": [], "error": str(e)}


HANDLERS = {
    "ingest_directive": handle_ingest_directive,
    "record_outcome": handle_record_outcome,
    "reconstruct": handle_reconstruct,
    "directive_patterns": handle_directive_patterns,
    "gap_history": handle_gap_history,
    "recent_directives": handle_recent_directives,
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
