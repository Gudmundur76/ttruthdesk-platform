#!/usr/bin/env python3
"""
convert_to_agent2model_format.py
PRD_SKILLOPT_AGENT2MODEL §6 — scripts/convert_to_agent2model_format.py

Converts the ttruthdesk registry corpus (JSONL) into the training format
required by QLoRA fine-tuning on slm-infra-deploy.

Input format (registry corpus — one JSON per line):
  {
    "id": "claim-abc123",
    "claimText": "Protein 1ABC has a resolution of 2.1 angstroms.",
    "verdict": "Supported",
    "confidenceScore": 0.92,
    "domain": "structural_biology",
    "evidenceUrl": "https://www.rcsb.org/structure/1ABC",
    "evidenceRaw": {"resolution": 2.1, "method": "X-ray crystallography"},
    "compositeTruthLabel": "verified_faithful",
    "compositeTruthScore": 0.88
  }

Output format (agent2model training format — one JSON per line):
  {
    "instruction": "Verify the following scientific claim and return a structured verdict.",
    "input": "Claim: Protein 1ABC has a resolution of 2.1 angstroms.\nDomain: structural_biology",
    "output": "{\"verdict\": \"Supported\", \"confidence\": 0.92, \"rationale\": \"PDB entry 1ABC confirms resolution of 2.1 angstroms.\"}",
    "metadata": {
      "source_id": "claim-abc123",
      "domain": "structural_biology",
      "compositeTruthLabel": "verified_faithful",
      "split": "train"
    }
  }

Usage:
  python3 scripts/convert_to_agent2model_format.py \\
    --input training/corpus.jsonl \\
    --output training/formatted.jsonl \\
    --train-ratio 0.9 \\
    --min-confidence 0.7 \\
    --min-composite-score 0.6

Options:
  --input             Path to input corpus JSONL (default: training/corpus.jsonl)
  --output            Path to output formatted JSONL (default: training/formatted.jsonl)
  --train-ratio       Fraction for training set (default: 0.9, rest goes to test)
  --min-confidence    Minimum confidence score to include (default: 0.7)
  --min-composite     Minimum composite truth score to include (default: 0.6)
  --exclude-labels    Comma-separated composite truth labels to exclude
                      (default: insufficient_evidence,out_of_scope)
  --seed              Random seed for train/test split (default: 42)
  --stats             Print dataset statistics and exit without writing
"""

import argparse
import json
import os
import random
import sys
from pathlib import Path
from typing import Any, Optional


# ─── Constants ─────────────────────────────────────────────────────────────────

INSTRUCTION_TEMPLATE = (
    "Verify the following scientific claim and return a structured verdict.\n"
    "Return a JSON object with fields: verdict (one of Supported, Contradicted, "
    "Partially Supported, Ambiguous, Insufficient Evidence, Out of Scope), "
    "confidence (0.0-1.0), rationale (one sentence)."
)

VERDICT_TO_RATIONALE_TEMPLATE = {
    "Supported": "Evidence from {domain} sources confirms this claim.",
    "Contradicted": "Evidence from {domain} sources contradicts this claim.",
    "Partially Supported": "Evidence partially supports this claim with caveats.",
    "Ambiguous": "Evidence is ambiguous or conflicting for this claim.",
    "Insufficient Evidence": "Insufficient evidence found to evaluate this claim.",
    "Out of Scope": "This claim is outside the scope of available evidence.",
}

DEFAULT_EXCLUDE_LABELS = {"insufficient_evidence", "out_of_scope"}


# ─── Conversion ────────────────────────────────────────────────────────────────

def build_rationale(row: dict[str, Any]) -> str:
    """Build a rationale string from the registry row."""
    verdict = row.get("verdict", "Insufficient Evidence")
    domain = row.get("domain", "scientific")
    template = VERDICT_TO_RATIONALE_TEMPLATE.get(verdict, "Verdict based on available evidence.")
    return template.format(domain=domain.replace("_", " "))


def convert_row(row: dict[str, Any], split: str) -> Optional[dict[str, Any]]:
    """Convert a single registry row to the agent2model training format."""
    claim_text = row.get("claimText", "").strip()
    verdict = row.get("verdict", "").strip()
    confidence = row.get("confidenceScore")
    domain = row.get("domain", "general")
    source_id = row.get("id", "unknown")
    composite_label = row.get("compositeTruthLabel", "")
    composite_score = row.get("compositeTruthScore")

    if not claim_text or not verdict:
        return None

    # Build the input text
    input_text = f"Claim: {claim_text}\nDomain: {domain}"

    # Build the output JSON
    output_obj = {
        "verdict": verdict,
        "confidence": round(float(confidence), 3) if confidence is not None else 0.5,
        "rationale": build_rationale(row),
    }

    return {
        "instruction": INSTRUCTION_TEMPLATE,
        "input": input_text,
        "output": json.dumps(output_obj, ensure_ascii=False),
        "metadata": {
            "source_id": source_id,
            "domain": domain,
            "compositeTruthLabel": composite_label,
            "compositeTruthScore": round(float(composite_score), 3) if composite_score is not None else None,
            "split": split,
        },
    }


def load_corpus(input_path: str) -> list[dict[str, Any]]:
    """Load JSONL corpus from file."""
    rows = []
    skipped = 0
    path = Path(input_path)

    if not path.exists():
        print(f"ERROR: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"WARNING: Skipping malformed line {i}: {e}", file=sys.stderr)
                skipped += 1

    print(f"Loaded {len(rows)} rows ({skipped} skipped) from {input_path}")
    return rows


def filter_rows(
    rows: list[dict[str, Any]],
    min_confidence: float,
    min_composite: float,
    exclude_labels: set[str],
) -> list[dict[str, Any]]:
    """Apply quality filters to the corpus."""
    filtered = []
    reasons: dict[str, int] = {}

    for row in rows:
        confidence = row.get("confidenceScore")
        composite_score = row.get("compositeTruthScore")
        composite_label = row.get("compositeTruthLabel", "")

        if confidence is not None and float(confidence) < min_confidence:
            reasons["low_confidence"] = reasons.get("low_confidence", 0) + 1
            continue

        if composite_score is not None and float(composite_score) < min_composite:
            reasons["low_composite_score"] = reasons.get("low_composite_score", 0) + 1
            continue

        if composite_label in exclude_labels:
            reasons[f"excluded_label_{composite_label}"] = (
                reasons.get(f"excluded_label_{composite_label}", 0) + 1
            )
            continue

        filtered.append(row)

    print(f"After filtering: {len(filtered)}/{len(rows)} rows retained")
    for reason, count in sorted(reasons.items()):
        print(f"  Excluded ({reason}): {count}")

    return filtered


def split_dataset(
    rows: list[dict[str, Any]], train_ratio: float, seed: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split rows into train and test sets."""
    rng = random.Random(seed)
    shuffled = rows.copy()
    rng.shuffle(shuffled)
    split_idx = int(len(shuffled) * train_ratio)
    return shuffled[:split_idx], shuffled[split_idx:]


def print_stats(rows: list[dict[str, Any]]) -> None:
    """Print dataset statistics."""
    verdicts: dict[str, int] = {}
    domains: dict[str, int] = {}
    labels: dict[str, int] = {}

    for row in rows:
        v = row.get("verdict", "unknown")
        d = row.get("domain", "unknown")
        l = row.get("compositeTruthLabel", "unknown")
        verdicts[v] = verdicts.get(v, 0) + 1
        domains[d] = domains.get(d, 0) + 1
        labels[l] = labels.get(l, 0) + 1

    print(f"\nTotal rows: {len(rows)}")
    print("\nVerdicts:")
    for k, v in sorted(verdicts.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}")
    print("\nDomains:")
    for k, v in sorted(domains.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}")
    print("\nComposite Truth Labels:")
    for k, v in sorted(labels.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}")


# ─── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert ttruthdesk corpus to agent2model training format"
    )
    parser.add_argument("--input", default="training/corpus.jsonl", help="Input corpus JSONL path")
    parser.add_argument("--output", default="training/formatted.jsonl", help="Output formatted JSONL path")
    parser.add_argument("--train-ratio", type=float, default=0.9, help="Train/test split ratio (default: 0.9)")
    parser.add_argument("--min-confidence", type=float, default=0.7, help="Minimum confidence score (default: 0.7)")
    parser.add_argument("--min-composite", type=float, default=0.6, help="Minimum composite truth score (default: 0.6)")
    parser.add_argument(
        "--exclude-labels",
        default="insufficient_evidence,out_of_scope",
        help="Comma-separated composite truth labels to exclude",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed for train/test split")
    parser.add_argument("--stats", action="store_true", help="Print stats and exit without writing")
    args = parser.parse_args()

    exclude_labels = set(args.exclude_labels.split(",")) if args.exclude_labels else DEFAULT_EXCLUDE_LABELS

    # Load
    rows = load_corpus(args.input)

    if args.stats:
        print_stats(rows)
        return

    # Filter
    filtered = filter_rows(rows, args.min_confidence, args.min_composite, exclude_labels)

    if len(filtered) < 100:
        print(
            f"WARNING: Only {len(filtered)} examples after filtering. "
            "Minimum 100 recommended for training.",
            file=sys.stderr,
        )

    # Split
    train_rows, test_rows = split_dataset(filtered, args.train_ratio, args.seed)
    print(f"Train: {len(train_rows)}, Test: {len(test_rows)}")

    # Convert
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    train_path = output_path.parent / "train.jsonl"
    test_path = output_path.parent / "test.jsonl"

    train_written = 0
    test_written = 0
    skipped = 0

    with open(output_path, "w", encoding="utf-8") as f_all, \
         open(train_path, "w", encoding="utf-8") as f_train, \
         open(test_path, "w", encoding="utf-8") as f_test:

        for row in train_rows:
            converted = convert_row(row, "train")
            if converted:
                line = json.dumps(converted, ensure_ascii=False)
                f_all.write(line + "\n")
                f_train.write(line + "\n")
                train_written += 1
            else:
                skipped += 1

        for row in test_rows:
            converted = convert_row(row, "test")
            if converted:
                line = json.dumps(converted, ensure_ascii=False)
                f_all.write(line + "\n")
                f_test.write(line + "\n")
                test_written += 1
            else:
                skipped += 1

    print(f"\nOutput written:")
    print(f"  {output_path} ({train_written + test_written} total)")
    print(f"  {train_path} ({train_written} train)")
    print(f"  {test_path} ({test_written} test)")
    if skipped:
        print(f"  Skipped (conversion failed): {skipped}")


if __name__ == "__main__":
    main()
