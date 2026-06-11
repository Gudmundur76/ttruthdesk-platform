"""
Citation Integrity Task — Evaluator

Scores the target agent's submission.jsonl against held-out ground truth.

Metrics:
  - citation_state_accuracy: exact match on citation state (weight 0.50)
  - passage_precision: whether source_passage contains the ground-truth passage (weight 0.20)
  - misrep_recall: correct identification of misrepresentation pattern (weight 0.15)
  - chain_distortion_score: accuracy of chain distortion type classification (weight 0.15)

Combined score:
  0.50 * state_accuracy
  + 0.20 * passage_precision
  + 0.15 * misrep_recall
  + 0.15 * chain_distortion_accuracy

Usage:
  python evaluate.py --gen-dir runs/run_1/gen_1
"""

import argparse
import json
import sys
from pathlib import Path

# Ground truth is in data/private/ — never exposed to the agent
TASK_DIR = Path(__file__).parent.parent.parent
PRIVATE_DIR = TASK_DIR / "data" / "private"
GROUND_TRUTH_FILE = PRIVATE_DIR / "ground_truth.jsonl"

# Metric weights (must sum to 1.0)
WEIGHT_STATE = 0.50
WEIGHT_PASSAGE = 0.20
WEIGHT_MISREP = 0.15
WEIGHT_CHAIN = 0.15


def load_jsonl(path: Path) -> dict:
    """Load a JSONL file as a dict keyed by claim_id."""
    records = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            records[record["claim_id"]] = record
    return records


def score_passage_alignment(predicted_passage: str | None, truth_passage: str | None) -> float:
    """
    Score passage alignment.
    Returns 1.0 if the predicted passage contains the ground-truth passage (or both are null).
    Returns 0.5 if the predicted passage overlaps with the ground-truth passage.
    Returns 0.0 if there is no overlap or the predicted passage is null when truth is not.
    """
    if truth_passage is None:
        # No passage expected — any answer is acceptable
        return 1.0
    if predicted_passage is None:
        return 0.0

    # Normalise whitespace for comparison
    pred_norm = " ".join(predicted_passage.lower().split())
    truth_norm = " ".join(truth_passage.lower().split())

    if truth_norm in pred_norm:
        return 1.0

    # Partial overlap: check if at least 50% of truth words appear in prediction
    truth_words = set(truth_norm.split())
    pred_words = set(pred_norm.split())
    overlap = len(truth_words & pred_words) / len(truth_words) if truth_words else 0.0

    return 0.5 if overlap >= 0.5 else 0.0


def score_chain_distortion(
    predicted_type: str | None, truth_type: str | None
) -> float:
    """
    Score chain distortion type classification.

    Scoring rules:
    - Both null → 1.0 (no chain data expected and none provided)
    - Truth null, prediction non-null → 0.0 (false positive)
    - Truth non-null, prediction null → 0.0 (missed distortion)
    - Exact match → 1.0
    - "faithful" vs any distortion type (or vice versa) → 0.0 (critical error)
    - Any other mismatch within distortion types → 0.5 (partial credit)
    """
    if truth_type is None and predicted_type is None:
        return 1.0
    if truth_type is None:
        return 0.0  # False positive
    if predicted_type is None:
        return 0.0  # Missed distortion
    if predicted_type == truth_type:
        return 1.0
    # Faithful vs distortion is a critical error
    if truth_type == "faithful" or predicted_type == "faithful":
        return 0.0
    # Mismatch between two distortion types — partial credit
    return 0.5


def evaluate(submission_path: Path) -> dict:
    """
    Evaluate submission against ground truth.

    Args:
        submission_path: Path to submission.jsonl

    Returns:
        dict with metrics
    """
    if not GROUND_TRUTH_FILE.exists():
        raise FileNotFoundError(f"Ground truth file not found: {GROUND_TRUTH_FILE}")

    ground_truth = load_jsonl(GROUND_TRUTH_FILE)
    predictions = load_jsonl(submission_path)

    n_total = len(ground_truth)
    n_evaluated = 0
    n_state_correct = 0
    passage_scores = []
    misrep_scores = []
    chain_scores = []

    missing_claims = []

    for claim_id, truth in ground_truth.items():
        if claim_id not in predictions:
            missing_claims.append(claim_id)
            # Missing predictions count as wrong on all metrics
            passage_scores.append(0.0)
            misrep_scores.append(0.0)
            chain_scores.append(0.0)
            continue

        pred = predictions[claim_id]
        n_evaluated += 1

        # 1. Citation state accuracy
        if pred.get("citation_state") == truth.get("citation_state"):
            n_state_correct += 1

        # 2. Passage alignment
        passage_score = score_passage_alignment(
            pred.get("source_passage"),
            truth.get("source_passage"),
        )
        passage_scores.append(passage_score)

        # 3. Misrepresentation recall
        truth_pattern = truth.get("misrepresentation_pattern")
        pred_pattern = pred.get("misrepresentation_pattern")

        if truth_pattern is None:
            # No misrepresentation expected — correct if prediction also null
            misrep_scores.append(1.0 if pred_pattern is None else 0.0)
        else:
            # Misrepresentation expected — correct if prediction matches
            misrep_scores.append(1.0 if pred_pattern == truth_pattern else 0.0)

        # 4. Chain distortion classification (Phase 102)
        truth_chain_type = truth.get("chain_distortion_type")
        pred_chain_type = pred.get("chain_distortion_type")
        chain_score = score_chain_distortion(pred_chain_type, truth_chain_type)
        chain_scores.append(chain_score)

    # Compute metrics
    state_accuracy = n_state_correct / n_total if n_total > 0 else 0.0
    passage_precision = sum(passage_scores) / n_total if n_total > 0 else 0.0
    misrep_recall = sum(misrep_scores) / n_total if n_total > 0 else 0.0
    chain_distortion_accuracy = sum(chain_scores) / n_total if n_total > 0 else 0.0

    combined_score = (
        WEIGHT_STATE * state_accuracy
        + WEIGHT_PASSAGE * passage_precision
        + WEIGHT_MISREP * misrep_recall
        + WEIGHT_CHAIN * chain_distortion_accuracy
    )

    return {
        "combined_score": round(combined_score, 4),
        "citation_state_accuracy": round(state_accuracy, 4),
        "passage_precision": round(passage_precision, 4),
        "misrepresentation_recall": round(misrep_recall, 4),
        "chain_distortion_accuracy": round(chain_distortion_accuracy, 4),
        "n_total": n_total,
        "n_evaluated": n_evaluated,
        "n_missing": len(missing_claims),
        "missing_claims": missing_claims[:10],  # Show first 10 only
    }


def main():
    parser = argparse.ArgumentParser(description="Evaluate citation integrity submission")
    parser.add_argument(
        "--gen-dir",
        type=Path,
        required=True,
        help="Generation directory containing submission.jsonl",
    )
    args = parser.parse_args()

    submission_path = args.gen_dir / "submission.jsonl"

    if not submission_path.exists():
        print(f"Error: submission.jsonl not found in {args.gen_dir}", file=sys.stderr)
        sys.exit(1)

    print("Evaluating citation integrity submission...", file=sys.stderr)

    results = evaluate(submission_path)

    # Save results.json (required by SIA orchestrator)
    results_path = args.gen_dir / "results.json"
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)

    print(f"Saved: {results_path}", file=sys.stderr)
    print(f"\n=== Citation Integrity Evaluation Results ===", file=sys.stderr)
    print(f"Combined Score:              {results['combined_score']:.4f}", file=sys.stderr)
    print(f"Citation State Accuracy:     {results['citation_state_accuracy']:.4f} (weight {WEIGHT_STATE:.2f})", file=sys.stderr)
    print(f"Passage Alignment Precision: {results['passage_precision']:.4f} (weight {WEIGHT_PASSAGE:.2f})", file=sys.stderr)
    print(f"Misrepresentation Recall:    {results['misrepresentation_recall']:.4f} (weight {WEIGHT_MISREP:.2f})", file=sys.stderr)
    print(f"Chain Distortion Accuracy:   {results['chain_distortion_accuracy']:.4f} (weight {WEIGHT_CHAIN:.2f})", file=sys.stderr)
    print(f"Claims evaluated: {results['n_evaluated']}/{results['n_total']}", file=sys.stderr)
    if results["n_missing"] > 0:
        print(f"Missing predictions: {results['n_missing']}", file=sys.stderr)


if __name__ == "__main__":
    main()
