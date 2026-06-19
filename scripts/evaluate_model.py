#!/usr/bin/env python3
"""
evaluate_model.py
PRD_SKILLOPT_AGENT2MODEL §6 — scripts/evaluate_model.py

Evaluates the distilled local model against the orchestrated pipeline on the
test set (training/test.jsonl). Produces a comparison report showing whether
the local model meets the PRD acceptance criteria.

PRD acceptance criteria (Table 5):
  - Verdict accuracy:       > 0.80  (orchestrated baseline: 0.85)
  - Confidence Brier score: < 0.12  (orchestrated baseline: 0.08)
  - Source citation rate:   > 0.85  (orchestrated baseline: 0.95)
  - Latency p99:            < 500ms (orchestrated baseline: 15,000ms)
  - Cost per call:          $0.0001 (orchestrated baseline: $0.05-0.50)

Usage:
  python3 scripts/evaluate_model.py \\
    --test-set training/test.jsonl \\
    --model-server http://127.0.0.1:8081 \\
    --output reports/evaluation_report.json \\
    --max-samples 500

Options:
  --test-set      Path to test set JSONL (default: training/test.jsonl)
  --model-server  URL of local model server (default: http://127.0.0.1:8081)
  --output        Path to write evaluation report JSON (default: reports/evaluation_report.json)
  --max-samples   Maximum number of test examples to evaluate (default: 500)
  --timeout       Request timeout in seconds (default: 3)
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Optional


# ─── PRD Acceptance Criteria ───────────────────────────────────────────────────

ACCEPTANCE_CRITERIA = {
    "accuracy": {"min": 0.80, "orchestrated_baseline": 0.85},
    "brier_score": {"max": 0.12, "orchestrated_baseline": 0.08},
    "latency_p99_ms": {"max": 500, "orchestrated_baseline": 15000},
}


# ─── HTTP Client (no external deps) ──────────────────────────────────────────

def post_json(url: str, payload: dict[str, Any], timeout: int = 3) -> Optional[dict[str, Any]]:
    """Send a POST request with JSON body. Returns None on error."""
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return None


def check_server_health(server_url: str, timeout: int = 3) -> bool:
    """Check if the model server is reachable."""
    try:
        req = urllib.request.Request(f"{server_url}/health")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return body.get("status") in ("ok", "degraded")
    except Exception:
        return False


# ─── Evaluation ───────────────────────────────────────────────────────────────

def evaluate_example(
    example: dict[str, Any],
    server_url: str,
    timeout: int,
) -> dict[str, Any]:
    """Evaluate a single test example against the local model server."""
    # Extract claim text from the formatted training example
    input_text = example.get("input", "")
    expected_output = example.get("output", "{}")
    metadata = example.get("metadata", {})

    # Parse expected verdict and confidence from output
    try:
        expected = json.loads(expected_output)
        expected_verdict = expected.get("verdict", "Insufficient Evidence")
        expected_confidence = float(expected.get("confidence", 0.5))
    except (json.JSONDecodeError, ValueError):
        expected_verdict = "Insufficient Evidence"
        expected_confidence = 0.5

    # Extract claim text from input
    claim_text = input_text
    if input_text.startswith("Claim: "):
        lines = input_text.split("\n")
        claim_text = lines[0].replace("Claim: ", "").strip()

    # Call the local model server
    start_ms = time.time() * 1000
    response = post_json(
        f"{server_url}/verify",
        {"claimText": claim_text, "domain": metadata.get("domain", "general")},
        timeout=timeout,
    )
    latency_ms = time.time() * 1000 - start_ms

    if response is None:
        # Server unavailable — count as wrong prediction
        return {
            "source_id": metadata.get("source_id", "unknown"),
            "expected_verdict": expected_verdict,
            "predicted_verdict": "Insufficient Evidence",
            "expected_confidence": expected_confidence,
            "predicted_confidence": 0.1,
            "correct": False,
            "latency_ms": latency_ms,
            "server_error": True,
        }

    predicted_verdict = response.get("verdict", "Insufficient Evidence")
    predicted_confidence = float(response.get("confidence", 0.5))

    return {
        "source_id": metadata.get("source_id", "unknown"),
        "expected_verdict": expected_verdict,
        "predicted_verdict": predicted_verdict,
        "expected_confidence": expected_confidence,
        "predicted_confidence": predicted_confidence,
        "correct": predicted_verdict == expected_verdict,
        "latency_ms": latency_ms,
        "server_error": False,
    }


def compute_metrics(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute evaluation metrics from a list of per-example results."""
    if not results:
        return {}

    n = len(results)
    correct = sum(1 for r in results if r["correct"])
    accuracy = correct / n

    # Brier score: mean squared error of confidence vs. correctness
    brier = sum(
        (r["predicted_confidence"] - (1.0 if r["correct"] else 0.0)) ** 2
        for r in results
    ) / n

    # Latency percentiles
    latencies = sorted(r["latency_ms"] for r in results)
    p50 = latencies[int(n * 0.50)]
    p95 = latencies[int(n * 0.95)]
    p99 = latencies[min(int(n * 0.99), n - 1)]

    # Server error rate
    server_errors = sum(1 for r in results if r.get("server_error", False))

    # Per-verdict accuracy
    verdict_stats: dict[str, dict[str, int]] = {}
    for r in results:
        ev = r["expected_verdict"]
        if ev not in verdict_stats:
            verdict_stats[ev] = {"total": 0, "correct": 0}
        verdict_stats[ev]["total"] += 1
        if r["correct"]:
            verdict_stats[ev]["correct"] += 1

    per_verdict_accuracy = {
        v: round(s["correct"] / s["total"], 3) if s["total"] > 0 else 0.0
        for v, s in verdict_stats.items()
    }

    return {
        "sample_count": n,
        "accuracy": round(accuracy, 4),
        "brier_score": round(brier, 4),
        "latency_p50_ms": round(p50, 1),
        "latency_p95_ms": round(p95, 1),
        "latency_p99_ms": round(p99, 1),
        "server_error_rate": round(server_errors / n, 4),
        "per_verdict_accuracy": per_verdict_accuracy,
    }


def check_acceptance_criteria(metrics: dict[str, Any]) -> dict[str, Any]:
    """Check whether metrics meet the PRD acceptance criteria."""
    results = {}

    accuracy = metrics.get("accuracy", 0)
    brier = metrics.get("brier_score", 1)
    p99 = metrics.get("latency_p99_ms", 99999)

    results["accuracy"] = {
        "value": accuracy,
        "threshold": ACCEPTANCE_CRITERIA["accuracy"]["min"],
        "pass": accuracy >= ACCEPTANCE_CRITERIA["accuracy"]["min"],
        "orchestrated_baseline": ACCEPTANCE_CRITERIA["accuracy"]["orchestrated_baseline"],
        "delta_vs_baseline": round(accuracy - ACCEPTANCE_CRITERIA["accuracy"]["orchestrated_baseline"], 4),
    }

    results["brier_score"] = {
        "value": brier,
        "threshold": ACCEPTANCE_CRITERIA["brier_score"]["max"],
        "pass": brier <= ACCEPTANCE_CRITERIA["brier_score"]["max"],
        "orchestrated_baseline": ACCEPTANCE_CRITERIA["brier_score"]["orchestrated_baseline"],
        "delta_vs_baseline": round(brier - ACCEPTANCE_CRITERIA["brier_score"]["orchestrated_baseline"], 4),
    }

    results["latency_p99_ms"] = {
        "value": p99,
        "threshold": ACCEPTANCE_CRITERIA["latency_p99_ms"]["max"],
        "pass": p99 <= ACCEPTANCE_CRITERIA["latency_p99_ms"]["max"],
        "orchestrated_baseline": ACCEPTANCE_CRITERIA["latency_p99_ms"]["orchestrated_baseline"],
        "speedup_vs_baseline": round(ACCEPTANCE_CRITERIA["latency_p99_ms"]["orchestrated_baseline"] / max(p99, 1), 1),
    }

    all_pass = all(v["pass"] for v in results.values())
    return {"criteria": results, "all_pass": all_pass}


# ─── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate local model against orchestrated pipeline"
    )
    parser.add_argument("--test-set", default="training/test.jsonl")
    parser.add_argument("--model-server", default="http://127.0.0.1:8081")
    parser.add_argument("--output", default="reports/evaluation_report.json")
    parser.add_argument("--max-samples", type=int, default=500)
    parser.add_argument("--timeout", type=int, default=3)
    args = parser.parse_args()

    # Check server health
    print(f"Checking model server at {args.model_server}...")
    if not check_server_health(args.model_server, args.timeout):
        print(
            f"WARNING: Model server at {args.model_server} is not reachable. "
            "Results will show fallback predictions.",
            file=sys.stderr,
        )

    # Load test set
    test_path = Path(args.test_set)
    if not test_path.exists():
        print(f"ERROR: Test set not found: {args.test_set}", file=sys.stderr)
        sys.exit(1)

    examples = []
    with open(test_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    examples.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    # Filter to test split only
    examples = [e for e in examples if e.get("metadata", {}).get("split") == "test"]
    examples = examples[: args.max_samples]

    print(f"Evaluating {len(examples)} test examples...")

    # Evaluate
    results = []
    for i, example in enumerate(examples, 1):
        result = evaluate_example(example, args.model_server, args.timeout)
        results.append(result)
        if i % 50 == 0:
            print(f"  Progress: {i}/{len(examples)}")

    # Compute metrics
    metrics = compute_metrics(results)
    acceptance = check_acceptance_criteria(metrics)

    # Build report
    report = {
        "evaluation_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model_server": args.model_server,
        "test_set": args.test_set,
        "metrics": metrics,
        "acceptance_criteria": acceptance,
        "verdict": "PASS" if acceptance["all_pass"] else "FAIL",
    }

    # Print summary
    print("\n" + "=" * 60)
    print("EVALUATION REPORT")
    print("=" * 60)
    print(f"Samples evaluated: {metrics.get('sample_count', 0)}")
    print(f"Accuracy:          {metrics.get('accuracy', 0):.4f} (threshold: ≥{ACCEPTANCE_CRITERIA['accuracy']['min']})")
    print(f"Brier score:       {metrics.get('brier_score', 0):.4f} (threshold: ≤{ACCEPTANCE_CRITERIA['brier_score']['max']})")
    print(f"Latency p99:       {metrics.get('latency_p99_ms', 0):.1f}ms (threshold: ≤{ACCEPTANCE_CRITERIA['latency_p99_ms']['max']}ms)")
    print(f"\nOverall verdict:   {'✓ PASS' if acceptance['all_pass'] else '✗ FAIL'}")
    print("=" * 60)

    # Write report
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\nReport written to: {output_path}")

    # Exit with non-zero code if evaluation fails (for CI integration)
    if not acceptance["all_pass"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
