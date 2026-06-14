/**
 * completenessCheck.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Source Completeness Gate.
 *
 * checkPdbCompleteness, checkAdapterCompleteness, buildCompletenessSummary
 * are all pure/deterministic — no mocks needed.
 */
import { describe, it, expect } from "vitest";
import {
  checkPdbCompleteness,
  checkAdapterCompleteness,
  buildCompletenessSummary,
  type PdbCompletenessInput,
  type AdapterCompletenessInput,
} from "./completenessCheck";
import type { PdbEntry } from "./pdbAdapter";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeEntry(overrides: Partial<PdbEntry> = {}): PdbEntry {
  return {
    pdbId: "1AZM",
    title: "Lysozyme",
    experimentalMethod: "X-RAY DIFFRACTION",
    resolution: 1.8,
    releaseDate: "2020-01-01",
    organisms: ["Homo sapiens"],
    entities: ["Lysozyme C"],
    ligands: ["ATP"],
    url: "https://www.rcsb.org/structure/1AZM",
    ...overrides,
  };
}

function makePdbInput(overrides: Partial<PdbCompletenessInput> = {}): PdbCompletenessInput {
  return {
    pdbId: "1AZM",
    found: true,
    entry: makeEntry(),
    claimType: "pdb_id",
    ...overrides,
  };
}

// ─── checkPdbCompleteness ─────────────────────────────────────────────────────
describe("completenessCheck — checkPdbCompleteness()", () => {
  it("returns passed:true for a pdb_id claim with a found entry", () => {
    const result = checkPdbCompleteness(makePdbInput({ claimType: "pdb_id" }));

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("returns passed:false when entry is not found", () => {
    const result = checkPdbCompleteness(
      makePdbInput({ found: false, entry: null })
    );

    expect(result.passed).toBe(false);
    expect(result.flags).toContain("Primary source not found");
  });

  it("deducts score for resolution claim when resolution is null (fieldPresent:false)", () => {
    // COMPLETENESS_GATE_THRESHOLD = 0.40; missing field = -0.30 → score 0.70 → still passes
    // But the flag is recorded.
    const result = checkPdbCompleteness(
      makePdbInput({ claimType: "resolution", entry: makeEntry({ resolution: null }) })
    );

    expect(result.flags.some((f) => f.includes("absent"))).toBe(true);
    // Score is reduced but still above 0.40 threshold
    expect(result.score).toBeCloseTo(0.70);
  });

  it("returns full score for resolution claim when resolution is present", () => {
    const result = checkPdbCompleteness(
      makePdbInput({ claimType: "resolution", entry: makeEntry({ resolution: 2.1 }) })
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("deducts score for experimental_method claim when method is null", () => {
    const result = checkPdbCompleteness(
      makePdbInput({ claimType: "experimental_method", entry: makeEntry({ experimentalMethod: null }) })
    );

    expect(result.flags.some((f) => f.includes("absent"))).toBe(true);
    expect(result.score).toBeCloseTo(0.70);
  });

  it("returns full score for experimental_method claim when method is present", () => {
    const result = checkPdbCompleteness(
      makePdbInput({ claimType: "experimental_method" })
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("deducts score for organism claim when organisms array is empty", () => {
    const result = checkPdbCompleteness(
      makePdbInput({ claimType: "organism", entry: makeEntry({ organisms: [] }) })
    );

    expect(result.flags.some((f) => f.includes("absent"))).toBe(true);
    expect(result.score).toBeCloseTo(0.70);
  });

  it("returns full score for organism claim when organisms are present", () => {
    const result = checkPdbCompleteness(
      makePdbInput({ claimType: "organism" })
    );

    expect(result.passed).toBe(true);
  });

  it("deducts score for ligand claim when ligands array is empty", () => {
    const result = checkPdbCompleteness(
      makePdbInput({ claimType: "ligand", entry: makeEntry({ ligands: [] }) })
    );

    expect(result.flags.some((f) => f.includes("absent"))).toBe(true);
    expect(result.score).toBeCloseTo(0.70);
  });

  it("returns full score for ligand claim when ligands are present", () => {
    const result = checkPdbCompleteness(
      makePdbInput({ claimType: "ligand" })
    );

    expect(result.passed).toBe(true);
  });

  it("considers data stale when checkedAt is more than 30 days ago", () => {
    const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const result = checkPdbCompleteness(
      makePdbInput({ checkedAt: staleDate })
    );

    expect(result.flags.some((f) => f.toLowerCase().includes("stale"))).toBe(true);
    // Stale data alone doesn't block the gate (only -0.10 deduction)
    expect(result.passed).toBe(true);
  });

  it("considers data fresh when checkedAt is recent", () => {
    const freshDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const result = checkPdbCompleteness(
      makePdbInput({ checkedAt: freshDate })
    );

    expect(result.flags).not.toContain("Source data may be stale");
  });

  it("result always has score, passed, flags", () => {
    const result = checkPdbCompleteness(makePdbInput());

    expect(typeof result.score).toBe("number");
    expect(typeof result.passed).toBe("boolean");
    expect(Array.isArray(result.flags)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ─── checkAdapterCompleteness ─────────────────────────────────────────────────
describe("completenessCheck — checkAdapterCompleteness()", () => {
  function makeAdapterInput(overrides: Partial<AdapterCompletenessInput> = {}): AdapterCompletenessInput {
    return {
      found: true,
      confidenceScore: 0.8,
      confidenceFlags: [],
      sourceId: "pubmed",
      sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/12345",
      ...overrides,
    };
  }

  it("returns passed:true for a healthy adapter result", () => {
    const result = checkAdapterCompleteness(makeAdapterInput());

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("returns passed:false when found:false", () => {
    const result = checkAdapterCompleteness(makeAdapterInput({ found: false, confidenceScore: 0 }));

    expect(result.passed).toBe(false);
  });

  it("blocks when confidenceFlags contain 'not found'", () => {
    const result = checkAdapterCompleteness(
      makeAdapterInput({ found: true, confidenceFlags: ["not found in database"] })
    );

    expect(result.passed).toBe(false);
  });

  it("blocks when confidenceFlags contain 'timeout'", () => {
    const result = checkAdapterCompleteness(
      makeAdapterInput({ found: true, confidenceFlags: ["timeout after 10s"] })
    );

    expect(result.passed).toBe(false);
  });

  it("merges adapter flags into result flags with [adapter] prefix", () => {
    const result = checkAdapterCompleteness(
      makeAdapterInput({ confidenceFlags: ["low sample size"] })
    );

    expect(result.flags.some((f) => f.startsWith("[adapter]"))).toBe(true);
    expect(result.flags.some((f) => f.includes("low sample size"))).toBe(true);
  });

  it("deducts score when confidenceScore is 0 (fieldPresent:false)", () => {
    // fieldPresent = found && confidenceScore > 0 → false → -0.30 deduction
    // score = 1.0 - 0.30 = 0.70 → still above 0.40 threshold → passed:true
    const result = checkAdapterCompleteness(
      makeAdapterInput({ confidenceScore: 0 })
    );

    expect(result.flags.some((f) => f.includes("absent"))).toBe(true);
    expect(result.score).toBeCloseTo(0.70);
    // Gate still passes at 0.70 (threshold is 0.40)
    expect(result.passed).toBe(true);
  });
});

// ─── buildCompletenessSummary ─────────────────────────────────────────────────
describe("completenessCheck — buildCompletenessSummary()", () => {
  it("returns correct summary for a mix of gated and passed claims", () => {
    const scores = [0.9, 0.2, 0.8, 0.1, 0.7];
    const gated = [false, true, false, true, false];

    const summary = buildCompletenessSummary(scores, gated);

    expect(summary.totalClaims).toBe(5);
    expect(summary.gatedClaims).toBe(2);
    expect(summary.passedClaims).toBe(3);
    expect(summary.averageScore).toBeCloseTo((0.9 + 0.2 + 0.8 + 0.1 + 0.7) / 5);
    expect(summary.gateRate).toBeCloseTo(2 / 5);
  });

  it("returns zeroed summary for empty input", () => {
    const summary = buildCompletenessSummary([], []);

    expect(summary.totalClaims).toBe(0);
    expect(summary.gatedClaims).toBe(0);
    expect(summary.passedClaims).toBe(0);
    expect(summary.averageScore).toBe(0);
    expect(summary.gateRate).toBe(0);
  });

  it("returns gateRate:0 when no claims are gated", () => {
    const summary = buildCompletenessSummary([0.9, 0.8], [false, false]);

    expect(summary.gateRate).toBe(0);
    expect(summary.gatedClaims).toBe(0);
    expect(summary.passedClaims).toBe(2);
  });

  it("returns gateRate:1 when all claims are gated", () => {
    const summary = buildCompletenessSummary([0.1, 0.2], [true, true]);

    expect(summary.gateRate).toBe(1);
    expect(summary.gatedClaims).toBe(2);
    expect(summary.passedClaims).toBe(0);
  });
});
