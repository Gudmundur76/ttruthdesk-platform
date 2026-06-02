/**
 * Unit tests for verdict logic and claim processing utilities.
 * Tests the core business logic without requiring a live database or external APIs.
 */

import { describe, it, expect } from "vitest";

// ─── Verdict classification logic (extracted from claimExtractor.ts) ──────────

type VerdictType =
  | "Supported"
  | "Contradicted"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Out of Scope"
  | "Needs Expert Review";

const VALID_VERDICTS: VerdictType[] = [
  "Supported",
  "Contradicted",
  "Partially Supported",
  "Ambiguous",
  "Insufficient Evidence",
  "Out of Scope",
  "Needs Expert Review",
];

function isValidVerdict(v: string): v is VerdictType {
  return VALID_VERDICTS.includes(v as VerdictType);
}

function computeFinalVerdict(
  verdict: VerdictType | null,
  overriddenVerdict: VerdictType | null
): VerdictType {
  return overriddenVerdict ?? verdict ?? "Insufficient Evidence";
}

function classifyResolutionClaim(
  claimedResolution: number,
  actualResolution: number | null
): VerdictType {
  if (actualResolution === null) return "Insufficient Evidence";
  const diff = Math.abs(claimedResolution - actualResolution);
  if (diff <= 0.05) return "Supported";
  if (diff <= 0.2) return "Partially Supported";
  if (diff <= 0.5) return "Ambiguous";
  return "Contradicted";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Verdict validation", () => {
  it("accepts all seven valid verdict strings", () => {
    for (const v of VALID_VERDICTS) {
      expect(isValidVerdict(v)).toBe(true);
    }
  });

  it("rejects invalid verdict strings", () => {
    expect(isValidVerdict("Unknown")).toBe(false);
    expect(isValidVerdict("")).toBe(false);
    expect(isValidVerdict("supported")).toBe(false); // case-sensitive
    expect(isValidVerdict("Partially_Supported")).toBe(false);
  });
});

describe("computeFinalVerdict", () => {
  it("returns overriddenVerdict when present", () => {
    expect(computeFinalVerdict("Contradicted", "Supported")).toBe("Supported");
    expect(computeFinalVerdict(null, "Needs Expert Review")).toBe("Needs Expert Review");
  });

  it("returns verdict when no override", () => {
    expect(computeFinalVerdict("Ambiguous", null)).toBe("Ambiguous");
    expect(computeFinalVerdict("Supported", null)).toBe("Supported");
  });

  it("returns Insufficient Evidence when both are null", () => {
    expect(computeFinalVerdict(null, null)).toBe("Insufficient Evidence");
  });
});

describe("classifyResolutionClaim", () => {
  it("returns Supported for exact match", () => {
    expect(classifyResolutionClaim(1.8, 1.8)).toBe("Supported");
  });

  it("returns Supported for very small difference (≤0.05 Å)", () => {
    expect(classifyResolutionClaim(1.8, 1.82)).toBe("Supported");
    expect(classifyResolutionClaim(2.0, 2.05)).toBe("Supported");
  });

  it("returns Partially Supported for moderate difference (≤0.2 Å)", () => {
    expect(classifyResolutionClaim(1.8, 1.95)).toBe("Partially Supported");
    expect(classifyResolutionClaim(2.0, 2.15)).toBe("Partially Supported");
  });

  it("returns Ambiguous for larger difference (≤0.5 Å)", () => {
    expect(classifyResolutionClaim(1.8, 2.1)).toBe("Ambiguous");
    expect(classifyResolutionClaim(2.0, 2.45)).toBe("Ambiguous");
  });

  it("returns Contradicted for large discrepancy (>0.5 Å)", () => {
    expect(classifyResolutionClaim(1.8, 3.0)).toBe("Contradicted");
    expect(classifyResolutionClaim(2.0, 5.0)).toBe("Contradicted");
  });

  it("returns Insufficient Evidence when actual resolution is null", () => {
    expect(classifyResolutionClaim(1.8, null)).toBe("Insufficient Evidence");
  });
});

// ─── PDB ID format validation ─────────────────────────────────────────────────

function isValidPdbId(id: string): boolean {
  // PDB IDs are 4 characters: digit + 3 alphanumeric
  return /^[0-9][A-Za-z0-9]{3}$/.test(id);
}

describe("PDB ID format validation", () => {
  it("accepts valid PDB IDs", () => {
    expect(isValidPdbId("1LYZ")).toBe(true);
    expect(isValidPdbId("4HHB")).toBe(true);
    expect(isValidPdbId("2ABC")).toBe(true);
    expect(isValidPdbId("1abc")).toBe(true); // lowercase also valid
  });

  it("rejects invalid PDB IDs", () => {
    expect(isValidPdbId("ABCD")).toBe(false); // must start with digit
    expect(isValidPdbId("1AB")).toBe(false);  // too short
    expect(isValidPdbId("1ABCD")).toBe(false); // too long
    expect(isValidPdbId("")).toBe(false);
    expect(isValidPdbId("1AB!")).toBe(false); // special char
  });
});

// ─── Verdict summary counting ─────────────────────────────────────────────────

function buildVerdictSummary(
  claims: Array<{ verdict: VerdictType | null; overriddenVerdict: VerdictType | null }>
): Record<VerdictType, number> {
  const summary: Record<VerdictType, number> = {
    Supported: 0,
    Contradicted: 0,
    "Partially Supported": 0,
    Ambiguous: 0,
    "Insufficient Evidence": 0,
    "Out of Scope": 0,
    "Needs Expert Review": 0,
  };
  for (const claim of claims) {
    const v = computeFinalVerdict(claim.verdict, claim.overriddenVerdict);
    summary[v]++;
  }
  return summary;
}

describe("buildVerdictSummary", () => {
  it("counts verdicts correctly", () => {
    const claims = [
      { verdict: "Supported" as VerdictType, overriddenVerdict: null },
      { verdict: "Supported" as VerdictType, overriddenVerdict: null },
      { verdict: "Contradicted" as VerdictType, overriddenVerdict: null },
      { verdict: null, overriddenVerdict: null },
    ];
    const summary = buildVerdictSummary(claims);
    expect(summary.Supported).toBe(2);
    expect(summary.Contradicted).toBe(1);
    expect(summary["Insufficient Evidence"]).toBe(1);
  });

  it("respects overriddenVerdict", () => {
    const claims = [
      { verdict: "Contradicted" as VerdictType, overriddenVerdict: "Supported" as VerdictType },
    ];
    const summary = buildVerdictSummary(claims);
    expect(summary.Supported).toBe(1);
    expect(summary.Contradicted).toBe(0);
  });

  it("handles empty claims array", () => {
    const summary = buildVerdictSummary([]);
    for (const v of VALID_VERDICTS) {
      expect(summary[v]).toBe(0);
    }
  });
});
