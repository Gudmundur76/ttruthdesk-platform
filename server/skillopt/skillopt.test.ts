/**
 * skillopt.test.ts
 * Unit tests for the SkillOpt module — scorer, groundTruthLoader, candidateGenerator, skillOptRunner.
 * PRD_SKILLOPT_AGENT2MODEL §1.7 — all pure functions tested without DB or API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeMetrics,
  computeDelta,
  meetsTarget,
  type PredictedExample,
} from "./scorer";
import {
  loadGroundTruth,
  validateDataset,
  type GroundTruthExample,
} from "./groundTruthLoader";
import { generateCandidates, type InstructionSet } from "./candidateGenerator";

// ─── scorer.ts ────────────────────────────────────────────────────────────────

describe("computeMetrics()", () => {
  it("returns all-zero metrics for empty input", () => {
    const result = computeMetrics([]);
    expect(result.accuracy).toBe(0);
    expect(result.f1).toBe(0);
    expect(result.brierScore).toBe(1);
    expect(result.sampleCount).toBe(0);
  });

  it("returns perfect metrics for all-correct predictions", () => {
    const examples: PredictedExample[] = [
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Supported",
        predictedConfidence: 0.9,
        confidenceInRange: true,
      },
      {
        predictedVerdict: "Contradicted",
        expectedVerdict: "Contradicted",
        predictedConfidence: 0.8,
        confidenceInRange: true,
      },
    ];
    const result = computeMetrics(examples);
    expect(result.accuracy).toBe(1);
    expect(result.f1).toBeCloseTo(1, 2);
    expect(result.brierScore).toBeLessThan(0.05);
  });

  it("returns zero F1 for all-wrong predictions", () => {
    const examples: PredictedExample[] = [
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Contradicted",
        predictedConfidence: 0.9,
        confidenceInRange: false,
      },
      {
        predictedVerdict: "Contradicted",
        expectedVerdict: "Supported",
        predictedConfidence: 0.8,
        confidenceInRange: false,
      },
    ];
    const result = computeMetrics(examples);
    expect(result.accuracy).toBe(0);
    // Macro F1 for 2-class swap: precision = 0 for each label → F1 = 0
    expect(result.f1).toBe(0);
  });

  it("computes correct accuracy for mixed predictions", () => {
    const examples: PredictedExample[] = [
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Supported",
        predictedConfidence: 0.9,
        confidenceInRange: true,
      },
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Contradicted",
        predictedConfidence: 0.7,
        confidenceInRange: false,
      },
      {
        predictedVerdict: "Ambiguous",
        expectedVerdict: "Ambiguous",
        predictedConfidence: 0.5,
        confidenceInRange: true,
      },
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Ambiguous",
        predictedConfidence: 0.6,
        confidenceInRange: false,
      },
    ];
    const result = computeMetrics(examples);
    expect(result.accuracy).toBe(0.5); // 2 correct out of 4
    expect(result.sampleCount).toBe(4);
  });

  it("computes Brier score correctly", () => {
    // Perfect prediction: confidence 1.0 for correct, 0.0 for wrong
    const examples: PredictedExample[] = [
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Supported",
        predictedConfidence: 1.0,
        confidenceInRange: true,
      },
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Contradicted",
        predictedConfidence: 0.0,
        confidenceInRange: false,
      },
    ];
    const result = computeMetrics(examples);
    // Brier: ((1.0 - 1)^2 + (0.0 - 0)^2) / 2 = 0
    expect(result.brierScore).toBeCloseTo(0, 5);
  });

  it("populates perLabelF1 for each verdict type", () => {
    const examples: PredictedExample[] = [
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Supported",
        predictedConfidence: 0.9,
        confidenceInRange: true,
      },
      {
        predictedVerdict: "Contradicted",
        expectedVerdict: "Contradicted",
        predictedConfidence: 0.8,
        confidenceInRange: true,
      },
    ];
    const result = computeMetrics(examples);
    expect(result.perLabelF1["Supported"]).toBeCloseTo(1, 2);
    expect(result.perLabelF1["Contradicted"]).toBeCloseTo(1, 2);
  });
});

describe("computeDelta()", () => {
  it("returns positive delta when F1 improves", () => {
    const before = computeMetrics([
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Contradicted",
        predictedConfidence: 0.5,
        confidenceInRange: false,
      },
    ]);
    const after = computeMetrics([
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Supported",
        predictedConfidence: 0.9,
        confidenceInRange: true,
      },
    ]);
    const delta = computeDelta(before, after);
    expect(delta.f1Delta).toBeGreaterThan(0);
  });

  it("returns negative brierDelta when Brier score improves (lower is better)", () => {
    const before = computeMetrics([
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Supported",
        predictedConfidence: 0.5,
        confidenceInRange: true,
      },
    ]);
    const after = computeMetrics([
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Supported",
        predictedConfidence: 0.95,
        confidenceInRange: true,
      },
    ]);
    const delta = computeDelta(before, after);
    // After has lower Brier score → negative delta = improvement
    expect(delta.brierDelta).toBeLessThan(0);
  });
});

describe("meetsTarget()", () => {
  it("returns true when F1 meets the target", () => {
    const result = computeMetrics([
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Supported",
        predictedConfidence: 0.9,
        confidenceInRange: true,
      },
    ]);
    expect(meetsTarget(result, 0.85)).toBe(true);
  });

  it("returns false when F1 is below the target", () => {
    const result = computeMetrics([
      {
        predictedVerdict: "Supported",
        expectedVerdict: "Contradicted",
        predictedConfidence: 0.5,
        confidenceInRange: false,
      },
    ]);
    expect(meetsTarget(result, 0.85)).toBe(false);
  });
});

// ─── groundTruthLoader.ts ─────────────────────────────────────────────────────

describe("loadGroundTruth()", () => {
  it("returns empty dataset for non-existent file", () => {
    const dataset = loadGroundTruth("/tmp/does-not-exist-skillopt.jsonl");
    expect(dataset.stats.total).toBe(0);
    expect(dataset.examples).toHaveLength(0);
  });

  it("loads examples from a valid JSONL file", async () => {
    const { writeFileSync, unlinkSync } = await import("fs");
    const tmpPath = "/tmp/test-ground-truth.jsonl";
    const example: GroundTruthExample = {
      id: "test-1",
      inputText: "The protein 1ABC has a resolution of 2.1 angstroms.",
      claimText: "The protein 1ABC has a resolution of 2.1 angstroms.",
      expectedVerdict: "Supported",
      expectedConfidenceRange: [0.85, 1.0],
      source: "synthetic_gold",
      domain: "structural_biology",
      humanReviewed: true,
    };
    writeFileSync(tmpPath, JSON.stringify(example) + "\n", "utf-8");
    const dataset = loadGroundTruth(tmpPath);
    expect(dataset.stats.total).toBe(1);
    expect(dataset.examples[0].id).toBe("test-1");
    expect(dataset.stats.bySource.synthetic_gold).toBe(1);
    unlinkSync(tmpPath);
  });

  it("filters by source when specified", async () => {
    const { writeFileSync, unlinkSync } = await import("fs");
    const tmpPath = "/tmp/test-ground-truth-filter.jsonl";
    const examples: GroundTruthExample[] = [
      {
        id: "manual-1",
        inputText: "text",
        claimText: "claim",
        expectedVerdict: "Supported",
        expectedConfidenceRange: [0.8, 1.0],
        source: "manual_calibration",
        domain: "structural_biology",
        humanReviewed: true,
      },
      {
        id: "synthetic-1",
        inputText: "text",
        claimText: "claim",
        expectedVerdict: "Contradicted",
        expectedConfidenceRange: [0.8, 1.0],
        source: "synthetic_gold",
        domain: "clinical",
        humanReviewed: false,
      },
    ];
    writeFileSync(
      tmpPath,
      examples.map(e => JSON.stringify(e)).join("\n") + "\n",
      "utf-8"
    );
    const dataset = loadGroundTruth(tmpPath, {
      sources: ["manual_calibration"],
    });
    expect(dataset.stats.total).toBe(1);
    expect(dataset.examples[0].id).toBe("manual-1");
    unlinkSync(tmpPath);
  });

  it("skips malformed lines without throwing", async () => {
    const { writeFileSync, unlinkSync } = await import("fs");
    const tmpPath = "/tmp/test-ground-truth-malformed.jsonl";
    const example: GroundTruthExample = {
      id: "good-1",
      inputText: "text",
      claimText: "claim",
      expectedVerdict: "Supported",
      expectedConfidenceRange: [0.8, 1.0],
      source: "synthetic_gold",
      domain: "structural_biology",
      humanReviewed: true,
    };
    writeFileSync(
      tmpPath,
      `{malformed json}\n${JSON.stringify(example)}\n`,
      "utf-8"
    );
    const dataset = loadGroundTruth(tmpPath);
    expect(dataset.stats.total).toBe(1);
    unlinkSync(tmpPath);
  });
});

describe("validateDataset()", () => {
  it("returns warning for empty dataset", () => {
    const dataset = loadGroundTruth("/tmp/does-not-exist-validate.jsonl");
    const warnings = validateDataset(dataset);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("too small");
  });
});

// ─── candidateGenerator.ts ────────────────────────────────────────────────────

describe("generateCandidates()", () => {
  it("generates the requested number of candidates", async () => {
    const candidates = await generateCandidates({
      instructionSet: "claim_extraction",
      currentInstruction: "Extract claims from the text.",
      count: 4,
      useLlmGeneration: false, // disable LLM calls in tests
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(4);
  });

  it("generates local_edit candidates without LLM calls", async () => {
    const candidates = await generateCandidates({
      instructionSet: "evidence_lookup",
      currentInstruction: "Look up evidence for the claim.",
      count: 3,
      useLlmGeneration: false,
    });
    const localEdits = candidates.filter(c => c.strategy === "local_edit");
    expect(localEdits.length).toBeGreaterThan(0);
  });

  it("generates cross_pollination candidates when reference instructions provided", async () => {
    const candidates = await generateCandidates({
      instructionSet: "confidence_scoring",
      currentInstruction: "Score the confidence.",
      referenceInstructions: ["Reference instruction 1\nReturn: JSON format"],
      count: 5,
      useLlmGeneration: false,
    });
    const crossPoll = candidates.filter(
      c => c.strategy === "cross_pollination"
    );
    expect(crossPoll.length).toBeGreaterThan(0);
  });

  it("all candidates have non-empty instruction text", async () => {
    const candidates = await generateCandidates({
      instructionSet: "claim_extraction",
      currentInstruction: "Base instruction.",
      count: 6,
      useLlmGeneration: false,
    });
    for (const c of candidates) {
      expect(c.instruction.length).toBeGreaterThan(10);
      expect(c.changeDescription.length).toBeGreaterThan(0);
    }
  });
});
