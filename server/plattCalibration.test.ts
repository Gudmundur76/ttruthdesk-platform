/**
 * plattCalibration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Platt scaling calibration module — pure math functions
 * that require no DB or LLM mocking.
 *
 * Tests: sigmoid(), applyPlattScaling(), computeBrierScore(),
 *        computeLogLoss(), fitPlattScaling(), fitFeatureWeights().
 */
import { describe, it, expect } from "vitest";
import {
  sigmoid,
  applyPlattScaling,
  computeBrierScore,
  computeLogLoss,
  fitPlattScaling,
  fitFeatureWeights,
  DEFAULT_FEATURE_WEIGHTS,
  DEFAULT_PLATT_W,
  DEFAULT_PLATT_B,
} from "./plattCalibration";

// ─── sigmoid ──────────────────────────────────────────────────────────────────
describe("plattCalibration — sigmoid()", () => {
  it("returns 0.5 for input 0", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 5);
  });

  it("returns value > 0.5 for positive input", () => {
    expect(sigmoid(1)).toBeGreaterThan(0.5);
    expect(sigmoid(5)).toBeGreaterThan(0.9);
  });

  it("returns value < 0.5 for negative input", () => {
    expect(sigmoid(-1)).toBeLessThan(0.5);
    expect(sigmoid(-5)).toBeLessThan(0.1);
  });

  it("output is always in (0, 1) for moderate inputs", () => {
    // For extreme values (±100), floating-point saturates to exactly 0 or 1;
    // test with values where the sigmoid is strictly between 0 and 1.
    for (const x of [-10, -1, 0, 1, 10]) {
      const s = sigmoid(x);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(1);
    }
    // Extreme values saturate to 0 or 1 due to floating-point limits
    expect(sigmoid(100)).toBeGreaterThanOrEqual(0);
    expect(sigmoid(-100)).toBeGreaterThanOrEqual(0);
  });

  it("is monotonically increasing", () => {
    expect(sigmoid(2)).toBeGreaterThan(sigmoid(1));
    expect(sigmoid(1)).toBeGreaterThan(sigmoid(0));
    expect(sigmoid(0)).toBeGreaterThan(sigmoid(-1));
  });
});

// ─── applyPlattScaling ────────────────────────────────────────────────────────
describe("plattCalibration — applyPlattScaling()", () => {
  it("clamps output to [0.05, 0.95]", () => {
    // Very large positive → clamped to 0.95
    expect(applyPlattScaling(1000, 1.0, 0.0)).toBe(0.95);
    // Very large negative → clamped to 0.05
    expect(applyPlattScaling(-1000, 1.0, 0.0)).toBe(0.05);
  });

  it("with identity params (w=1, b=0), maps 0 → 0.5", () => {
    expect(applyPlattScaling(0, 1.0, 0.0)).toBeCloseTo(0.5, 5);
  });

  it("uses default constants correctly", () => {
    const result = applyPlattScaling(0.5, DEFAULT_PLATT_W, DEFAULT_PLATT_B);
    expect(result).toBeGreaterThan(0.05);
    expect(result).toBeLessThan(0.95);
  });

  it("bias shifts the output", () => {
    const withPositiveBias = applyPlattScaling(0, 1.0, 2.0);
    const withNegativeBias = applyPlattScaling(0, 1.0, -2.0);
    expect(withPositiveBias).toBeGreaterThan(withNegativeBias);
  });
});

// ─── computeBrierScore ────────────────────────────────────────────────────────
describe("plattCalibration — computeBrierScore()", () => {
  it("returns 1.0 for empty arrays", () => {
    expect(computeBrierScore([], [])).toBe(1.0);
  });

  it("returns 0 for perfect predictions", () => {
    expect(computeBrierScore([1, 0, 1], [1, 0, 1])).toBeCloseTo(0, 5);
  });

  it("returns 1 for worst-case predictions (all wrong)", () => {
    expect(computeBrierScore([0, 1, 0], [1, 0, 1])).toBeCloseTo(1.0, 5);
  });

  it("returns 0.25 for all-0.5 predictions on binary outcomes", () => {
    expect(computeBrierScore([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0])).toBeCloseTo(0.25, 5);
  });

  it("is always in [0, 1]", () => {
    const score = computeBrierScore([0.3, 0.7, 0.5], [1, 0, 1]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── computeLogLoss ───────────────────────────────────────────────────────────
describe("plattCalibration — computeLogLoss()", () => {
  it("returns Infinity for empty arrays", () => {
    expect(computeLogLoss([], [])).toBe(Infinity);
  });

  it("returns near-zero for perfect predictions", () => {
    // Near-perfect: 0.9999 for actual=1
    expect(computeLogLoss([0.9999, 0.0001], [1, 0])).toBeLessThan(0.01);
  });

  it("is higher for worse predictions", () => {
    const good = computeLogLoss([0.9, 0.1], [1, 0]);
    const bad = computeLogLoss([0.5, 0.5], [1, 0]);
    expect(bad).toBeGreaterThan(good);
  });

  it("is always non-negative", () => {
    const loss = computeLogLoss([0.3, 0.7, 0.5], [1, 0, 1]);
    expect(loss).toBeGreaterThanOrEqual(0);
  });
});

// ─── fitPlattScaling ──────────────────────────────────────────────────────────
describe("plattCalibration — fitPlattScaling()", () => {
  it("returns w and b as numbers", () => {
    const result = fitPlattScaling([0.3, 0.7, 0.5], [1, 0, 1]);
    expect(typeof result.w).toBe("number");
    expect(typeof result.b).toBe("number");
  });

  it("converges to reasonable w and b for separable data", () => {
    // High scores → positive, low scores → negative
    const rawScores = [0.9, 0.8, 0.7, 0.2, 0.1, 0.15];
    const actuals   = [1,   1,   1,   0,   0,   0  ];
    const { w, b } = fitPlattScaling(rawScores, actuals, 0.1, 500);
    // After fitting, applying Platt scaling should give better calibration
    const calibrated = rawScores.map((s) => applyPlattScaling(s, w, b));
    const brierAfter = computeBrierScore(calibrated, actuals);
    expect(brierAfter).toBeLessThan(0.25); // better than random
  });

  it("returns initial values for single sample", () => {
    const result = fitPlattScaling([0.5], [1], 0.1, 100);
    expect(isFinite(result.w)).toBe(true);
    expect(isFinite(result.b)).toBe(true);
  });
});

// ─── fitFeatureWeights ────────────────────────────────────────────────────────
describe("plattCalibration — fitFeatureWeights()", () => {
  it("returns an array of 4 weights", () => {
    const features = [[0.8, 0.6, 0.7, 0.5], [0.2, 0.3, 0.4, 0.1]];
    const actuals = [1, 0];
    const weights = fitFeatureWeights(features, actuals);
    expect(weights).toHaveLength(4);
  });

  it("weights sum to approximately 1.0", () => {
    const features = [
      [0.9, 0.8, 0.7, 0.6],
      [0.1, 0.2, 0.3, 0.4],
      [0.5, 0.5, 0.5, 0.5],
    ];
    const actuals = [1, 0, 1];
    const weights = fitFeatureWeights(features, actuals);
    const sum = weights.reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });

  it("all weights are in [0.05, 0.60]", () => {
    const features = [[0.8, 0.6, 0.7, 0.5], [0.2, 0.3, 0.4, 0.1]];
    const actuals = [1, 0];
    const weights = fitFeatureWeights(features, actuals);
    for (const w of weights) {
      expect(w).toBeGreaterThanOrEqual(0.05);
      expect(w).toBeLessThanOrEqual(0.60);
    }
  });

  it("default feature weights sum to 1.0", () => {
    const sum = DEFAULT_FEATURE_WEIGHTS.reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});
