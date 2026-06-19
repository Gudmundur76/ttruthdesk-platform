/**
 * scorer.ts — SkillOpt Evaluation Metrics
 *
 * Pure functions for computing accuracy, precision, recall, F1, and Brier
 * score against a ground truth set. No side effects, no DB calls.
 *
 * PRD_SKILLOPT_AGENT2MODEL §1.4 — SkillOpt Loop scoring step.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ScoringResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  /** Brier score for confidence calibration (lower is better, 0 = perfect) */
  brierScore: number;
  /** Number of examples evaluated */
  sampleCount: number;
  /** Breakdown per verdict label */
  perLabelF1: Record<string, number>;
}

export interface PredictedExample {
  /** The predicted verdict label */
  predictedVerdict: string;
  /** The expected (ground truth) verdict label */
  expectedVerdict: string;
  /** Predicted confidence score 0–1 */
  predictedConfidence: number;
  /** Whether the confidence is within the expected range */
  confidenceInRange: boolean;
}

// ─── Scoring Functions ─────────────────────────────────────────────────────────

/**
 * Compute macro-averaged F1 and related metrics across all examples.
 * Uses macro-averaging: each label is weighted equally regardless of frequency.
 */
export function computeMetrics(examples: PredictedExample[]): ScoringResult {
  if (examples.length === 0) {
    return {
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1: 0,
      brierScore: 1,
      sampleCount: 0,
      perLabelF1: {},
    };
  }

  // Accuracy: fraction of exact verdict matches
  const correct = examples.filter(
    e => e.predictedVerdict === e.expectedVerdict
  ).length;
  const accuracy = correct / examples.length;

  // Collect all unique labels
  const labels = Array.from(
    new Set([
      ...examples.map(e => e.expectedVerdict),
      ...examples.map(e => e.predictedVerdict),
    ])
  );

  // Per-label precision, recall, F1
  const perLabelF1: Record<string, number> = {};
  let sumPrecision = 0;
  let sumRecall = 0;
  let sumF1 = 0;

  for (const label of labels) {
    const tp = examples.filter(
      e => e.predictedVerdict === label && e.expectedVerdict === label
    ).length;
    const fp = examples.filter(
      e => e.predictedVerdict === label && e.expectedVerdict !== label
    ).length;
    const fn = examples.filter(
      e => e.predictedVerdict !== label && e.expectedVerdict === label
    ).length;

    const p = tp + fp > 0 ? tp / (tp + fp) : 0;
    const r = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f = p + r > 0 ? (2 * p * r) / (p + r) : 0;

    perLabelF1[label] = f;
    sumPrecision += p;
    sumRecall += r;
    sumF1 += f;
  }

  const macroP = labels.length > 0 ? sumPrecision / labels.length : 0;
  const macroR = labels.length > 0 ? sumRecall / labels.length : 0;
  const macroF1 = labels.length > 0 ? sumF1 / labels.length : 0;

  // Brier score: mean squared error of confidence vs. correctness (0 = perfect)
  const brierScore =
    examples.reduce((sum, e) => {
      const outcome = e.predictedVerdict === e.expectedVerdict ? 1 : 0;
      return sum + Math.pow(e.predictedConfidence - outcome, 2);
    }, 0) / examples.length;

  return {
    accuracy,
    precision: macroP,
    recall: macroR,
    f1: macroF1,
    brierScore,
    sampleCount: examples.length,
    perLabelF1,
  };
}

/**
 * Compare two ScoringResult objects and return the delta (after - before).
 * Positive delta means improvement.
 */
export function computeDelta(
  before: ScoringResult,
  after: ScoringResult
): {
  f1Delta: number;
  precisionDelta: number;
  recallDelta: number;
  brierDelta: number;
} {
  return {
    f1Delta: after.f1 - before.f1,
    precisionDelta: after.precision - before.precision,
    recallDelta: after.recall - before.recall,
    // Brier: lower is better, so negative delta = improvement
    brierDelta: after.brierScore - before.brierScore,
  };
}

/**
 * Check whether a ScoringResult meets the convergence target.
 */
export function meetsTarget(result: ScoringResult, targetF1: number): boolean {
  return result.f1 >= targetF1;
}
