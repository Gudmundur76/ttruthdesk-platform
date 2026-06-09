#!/usr/bin/env python3
"""
scripts/generate-feature-list.py
Parses todo.md and emits feature_list.json — the machine-readable contract.

Rules:
- Every [ ] / [x] line becomes a feature entry
- passes = true  for [x] items
- passes = false for [ ] items
- id is derived from the phase heading + sequential index
- category is inferred from the heading text
- The JSON is sorted: incomplete features first, then complete
"""
import re
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
TODO = ROOT / "todo.md"
OUT  = ROOT / "feature_list.json"

def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:60]

def infer_category(heading: str) -> str:
    h = heading.lower()
    if any(k in h for k in ["schema", "backend", "db", "database", "adapter", "engine", "router"]):
        return "backend"
    if any(k in h for k in ["frontend", "ui", "page", "landing", "dashboard", "view"]):
        return "frontend"
    if any(k in h for k in ["monitor", "schedule", "cron", "heartbeat", "notification"]):
        return "infra"
    if any(k in h for k in ["test", "coverage", "quality", "lint", "ci"]):
        return "quality"
    if any(k in h for k in ["admin", "harness", "audit", "drift"]):
        return "admin"
    if any(k in h for k in ["agent", "swarm", "llm", "multi"]):
        return "agent"
    return "feature"

def parse_todo(path: Path) -> list[dict]:
    features = []
    current_heading = "general"
    current_category = "feature"
    phase_counters: dict[str, int] = {}

    for line in path.read_text().splitlines():
        # Detect headings
        m = re.match(r"^#{1,3}\s+(.+)$", line)
        if m:
            current_heading = m.group(1).strip()
            current_category = infer_category(current_heading)
            continue

        # Detect task lines
        m = re.match(r"^- \[([ xX])\]\s+(.+)$", line)
        if not m:
            continue

        done = m.group(1).lower() == "x"
        description = m.group(2).strip()

        phase_slug = slugify(current_heading)
        phase_counters[phase_slug] = phase_counters.get(phase_slug, 0) + 1
        feature_id = f"{phase_slug}-{phase_counters[phase_slug]:03d}"

        features.append({
            "id": feature_id,
            "category": current_category,
            "phase": current_heading,
            "description": description,
            "passes": done,
            "notes": ""
        })

    # Sort: incomplete first, then complete (preserves order within each group)
    incomplete = [f for f in features if not f["passes"]]
    complete   = [f for f in features if f["passes"]]
    return incomplete + complete

def main():
    if not TODO.exists():
        print(f"ERROR: {TODO} not found", file=sys.stderr)
        sys.exit(1)

    features = parse_todo(TODO)
    total    = len(features)
    done     = sum(1 for f in features if f["passes"])
    pending  = total - done

    payload = {
        "meta": {
            "source": "todo.md",
            "total": total,
            "done": done,
            "pending": pending,
            "percent_complete": round(done / total * 100, 1) if total else 0
        },
        "features": features
    }

    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"✓ feature_list.json written: {total} features ({done} done, {pending} pending)")

if __name__ == "__main__":
    main()
