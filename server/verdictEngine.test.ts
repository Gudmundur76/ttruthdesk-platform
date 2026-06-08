/**
 * verdictEngine.test.ts — imports from the real module.
 */
import { describe, it, expect } from "vitest";
import {
  VALID_VERDICTS, RESOLUTION_THRESHOLDS, CONFIDENCE_THRESHOLDS,
  isValidVerdict, checkSourceCompleteness, classifyResolutionClaim,
  verdictForResolution, classifyByConfidence, computeFinalVerdict,
  buildVerdictSummaryFromDecisions, computeDeterminismMetrics,
} from "./verdictEngine";
import type { CompletenessCheckResult, VerdictType } from "./verdictEngine";

describe("VALID_VERDICTS", () => {
  it("contains exactly 7 verdict types", () => { expect(VALID_VERDICTS).toHaveLength(7); });
  it("contains all required verdict types", () => {
    const expected: VerdictType[] = ["Supported","Contradicted","Partially Supported","Ambiguous","Insufficient Evidence","Out of Scope","Needs Expert Review"];
    for (const v of expected) expect(VALID_VERDICTS).toContain(v);
  });
});

describe("isValidVerdict", () => {
  it("returns true for all valid verdicts", () => { for (const v of VALID_VERDICTS) expect(isValidVerdict(v)).toBe(true); });
  it("returns false for invalid strings", () => {
    expect(isValidVerdict("")).toBe(false);
    expect(isValidVerdict("supported")).toBe(false);
    expect(isValidVerdict("Unknown")).toBe(false);
  });
});

describe("checkSourceCompleteness", () => {
  it("returns score 1.0 and passed=true when all conditions are met", () => {
    const r = checkSourceCompleteness({ sourceFound: true, fieldPresent: true, dataFresh: true, sourceReachable: true });
    expect(r.score).toBe(1.0); expect(r.passed).toBe(true); expect(r.flags).toHaveLength(0);
  });
  it("deducts 0.60 when source not found", () => {
    const r = checkSourceCompleteness({ sourceFound: false, fieldPresent: true, dataFresh: true });
    expect(r.score).toBeCloseTo(0.40); expect(r.flags).toContain("Primary source not found");
  });
  it("deducts 0.30 when field not present", () => {
    const r = checkSourceCompleteness({ sourceFound: true, fieldPresent: false, dataFresh: true });
    expect(r.score).toBeCloseTo(0.70); expect(r.flags).toContain("Required field absent in source record");
  });
  it("deducts 0.10 when data is stale", () => {
    const r = checkSourceCompleteness({ sourceFound: true, fieldPresent: true, dataFresh: false });
    expect(r.score).toBeCloseTo(0.90); expect(r.flags).toContain("Source data may be stale");
  });
  it("deducts 0.20 when source is unreachable", () => {
    const r = checkSourceCompleteness({ sourceFound: true, fieldPresent: true, dataFresh: true, sourceReachable: false });
    expect(r.score).toBeCloseTo(0.80); expect(r.flags).toContain("Source URL unreachable");
  });
  it("score is clamped to 0 when all conditions fail", () => {
    const r = checkSourceCompleteness({ sourceFound: false, fieldPresent: false, dataFresh: false, sourceReachable: false });
    expect(r.score).toBe(0); expect(r.passed).toBe(false); expect(r.flags).toHaveLength(4);
  });
  it("passed is true when score equals COMPLETENESS_GATE_THRESHOLD (0.40)", () => {
    const r = checkSourceCompleteness({ sourceFound: false, fieldPresent: true, dataFresh: true });
    expect(r.score).toBeCloseTo(0.40); expect(r.passed).toBe(true);
  });
  it("passed is false when score is below threshold", () => {
    const r = checkSourceCompleteness({ sourceFound: false, fieldPresent: false, dataFresh: true });
    expect(r.score).toBeCloseTo(0.10); expect(r.passed).toBe(false);
  });
  it("defaults sourceReachable to true when not provided", () => {
    const r = checkSourceCompleteness({ sourceFound: true, fieldPresent: true, dataFresh: true });
    expect(r.score).toBe(1.0); expect(r.flags).not.toContain("Source URL unreachable");
  });
});

describe("classifyResolutionClaim", () => {
  it("returns Insufficient Evidence when actualResolution is null", () => {
    expect(classifyResolutionClaim(2.0, null)).toBe("Insufficient Evidence");
  });
  it("returns Supported when diff <= EXACT threshold (0.05)", () => {
    expect(classifyResolutionClaim(2.0, 2.03)).toBe("Supported");
    expect(classifyResolutionClaim(2.0, 1.97)).toBe("Supported");
    expect(classifyResolutionClaim(2.0, 2.0)).toBe("Supported");
  });
  it("returns Partially Supported when diff is within CLOSE threshold (0.20)", () => {
    expect(classifyResolutionClaim(2.0, 2.10)).toBe("Partially Supported");
    expect(classifyResolutionClaim(2.0, 1.85)).toBe("Partially Supported");
  });
  it("returns Ambiguous when diff is within AMBIGUOUS threshold (0.50)", () => {
    expect(classifyResolutionClaim(2.0, 2.30)).toBe("Ambiguous");
    expect(classifyResolutionClaim(2.0, 1.60)).toBe("Ambiguous");
  });
  it("returns Contradicted when diff exceeds AMBIGUOUS threshold", () => {
    expect(classifyResolutionClaim(2.0, 2.60)).toBe("Contradicted");
    expect(classifyResolutionClaim(2.0, 1.30)).toBe("Contradicted");
  });
  it("uses absolute difference (direction does not matter)", () => {
    expect(classifyResolutionClaim(1.5, 2.0)).toBe(classifyResolutionClaim(2.0, 1.5));
  });
});

const passingCompleteness: CompletenessCheckResult = { score: 1.0, passed: true, flags: [] };
const failingCompleteness: CompletenessCheckResult = { score: 0.10, passed: false, flags: ["Primary source not found"] };

describe("verdictForResolution", () => {
  it("returns Insufficient Evidence when completeness gate fails", () => {
    const r = verdictForResolution(2.0, 2.0, "1LYZ", failingCompleteness);
    expect(r.verdict).toBe("Insufficient Evidence"); expect(r.method).toBe("completeness_gate");
  });
  it("returns Ambiguous when actualResolution is null but completeness passes", () => {
    const r = verdictForResolution(2.0, null, "1LYZ", passingCompleteness);
    expect(r.verdict).toBe("Ambiguous"); expect(r.method).toBe("deterministic_source");
  });
  it("returns Supported for exact match", () => {
    const r = verdictForResolution(2.0, 2.02, "1LYZ", passingCompleteness);
    expect(r.verdict).toBe("Supported"); expect(r.decisionConfidence).toBe(1.0);
  });
  it("returns Partially Supported for close match", () => {
    const r = verdictForResolution(2.0, 2.15, "1LYZ", passingCompleteness);
    expect(r.verdict).toBe("Partially Supported"); expect(r.decisionConfidence).toBe(0.85);
  });
  it("returns Contradicted for large difference", () => {
    const r = verdictForResolution(2.0, 3.0, "1LYZ", passingCompleteness);
    expect(r.verdict).toBe("Contradicted");
  });
  it("includes the PDB ID in the rationale", () => {
    const r = verdictForResolution(2.0, 2.0, "4HHB", passingCompleteness);
    expect(r.rationale).toContain("4HHB");
  });
});

describe("classifyByConfidence", () => {
  it("returns Insufficient Evidence when completeness gate fails", () => {
    const r = classifyByConfidence(0.95, failingCompleteness, "UniProt:P12345", []);
    expect(r.verdict).toBe("Insufficient Evidence"); expect(r.method).toBe("completeness_gate");
  });
  it("returns Supported when confidence >= 0.85", () => {
    const r = classifyByConfidence(0.90, passingCompleteness, "UniProt:P12345", []);
    expect(r.verdict).toBe("Supported"); expect(r.method).toBe("confidence_threshold");
  });
  it("returns Partially Supported when confidence >= 0.60 and < 0.85", () => {
    expect(classifyByConfidence(0.70, passingCompleteness, "src", []).verdict).toBe("Partially Supported");
  });
  it("returns Ambiguous when confidence >= 0.30 and < 0.60", () => {
    expect(classifyByConfidence(0.45, passingCompleteness, "src", []).verdict).toBe("Ambiguous");
  });
  it("returns Needs Expert Review when confidence < 0.30", () => {
    expect(classifyByConfidence(0.20, passingCompleteness, "src", []).verdict).toBe("Needs Expert Review");
  });
  it("includes flags in rationale", () => {
    const r = classifyByConfidence(0.90, passingCompleteness, "src", ["low coverage"]);
    expect(r.rationale).toContain("low coverage");
  });
  it("handles null sourceId gracefully", () => {
    expect(classifyByConfidence(0.90, passingCompleteness, null, []).rationale).toContain("unknown");
  });
});

describe("computeFinalVerdict", () => {
  it("returns overriddenVerdict when valid", () => { expect(computeFinalVerdict("Supported", "Contradicted")).toBe("Contradicted"); });
  it("returns verdict when overriddenVerdict is null", () => { expect(computeFinalVerdict("Supported", null)).toBe("Supported"); });
  it("returns Insufficient Evidence when both are null", () => { expect(computeFinalVerdict(null, null)).toBe("Insufficient Evidence"); });
  it("returns Insufficient Evidence when both are undefined", () => { expect(computeFinalVerdict(undefined, undefined)).toBe("Insufficient Evidence"); });
  it("returns Insufficient Evidence when verdict is invalid", () => { expect(computeFinalVerdict("invalid" as VerdictType, null)).toBe("Insufficient Evidence"); });
});

describe("buildVerdictSummaryFromDecisions", () => {
  it("returns all-zero summary for empty input", () => {
    const s = buildVerdictSummaryFromDecisions([]);
    for (const v of VALID_VERDICTS) expect(s[v]).toBe(0);
  });
  it("counts verdicts correctly", () => {
    const s = buildVerdictSummaryFromDecisions([
      { verdict: "Supported", overriddenVerdict: null },
      { verdict: "Supported", overriddenVerdict: null },
      { verdict: "Contradicted", overriddenVerdict: null },
      { verdict: null, overriddenVerdict: null },
    ]);
    expect(s["Supported"]).toBe(2); expect(s["Contradicted"]).toBe(1); expect(s["Insufficient Evidence"]).toBe(1);
  });
  it("applies overriddenVerdict over verdict", () => {
    const s = buildVerdictSummaryFromDecisions([{ verdict: "Supported", overriddenVerdict: "Contradicted" }]);
    expect(s["Contradicted"]).toBe(1); expect(s["Supported"]).toBe(0);
  });
});

describe("computeDeterminismMetrics", () => {
  it("returns all-zero metrics for empty input", () => {
    const m = computeDeterminismMetrics([]);
    expect(m.total).toBe(0); expect(m.deterministic).toBe(0); expect(m.determinismRate).toBe(0);
  });
  it("counts deterministic_source methods correctly", () => {
    const m = computeDeterminismMetrics(["deterministic_source", "deterministic_source", "confidence_threshold"]);
    expect(m.deterministic).toBe(2); expect(m.heuristic).toBe(1); expect(m.determinismRate).toBeCloseTo(2/3);
  });
  it("counts completeness_gate methods correctly", () => {
    const m = computeDeterminismMetrics(["completeness_gate", "completeness_gate"]);
    expect(m.gated).toBe(2); expect(m.determinismRate).toBe(0);
  });
  it("handles null/undefined methods gracefully", () => {
    const m = computeDeterminismMetrics([null, undefined, "deterministic_source"]);
    expect(m.total).toBe(3); expect(m.deterministic).toBe(1);
  });
  it("determinismRate is 1.0 when all methods are deterministic", () => {
    const m = computeDeterminismMetrics(["deterministic_source", "deterministic_source"]);
    expect(m.determinismRate).toBe(1.0);
  });
});
