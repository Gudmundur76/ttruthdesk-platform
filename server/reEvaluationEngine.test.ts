/**
 * reEvaluationEngine.test.ts — Phase 105
 *
 * Unit tests for the autonomous re-evaluation loop.
 *
 * Test coverage:
 *  - getAffectedDocumentIds: returns doc IDs from recent citation_edges rows
 *  - getEligibleClaimsForDocument: returns claims with verdicts on complete docs
 *  - reScoreClaim: idempotency, updated path, error path, skipped (no verdict)
 *  - runReEvaluationLoop: empty run, batch limit, multi-doc, error isolation
 *
 * All DB and external module calls are mocked — no real database required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
  updateClaimVerdict: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock citationChainAnalyzer (getCitationChainStats) ───────────────────────

vi.mock("./citationChainAnalyzer", () => ({
  getCitationChainStats: vi.fn().mockResolvedValue({
    totalCitingPapers: 3,
    maxDistortionScore: 0.4,
    dominantType: "amplification",
  }),
}));

// ─── Mock drizzle-orm sql tag ─────────────────────────────────────────────────

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
      _tag: "sql",
    })),
  };
});

import {
  getAffectedDocumentIds,
  getEligibleClaimsForDocument,
  reScoreClaim,
  runReEvaluationLoop,
  type ReEvalClaimInput,
} from "./reEvaluationEngine";
import { getDb, updateClaimVerdict } from "./db";
import { getCitationChainStats } from "./citationChainAnalyzer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(executeResult: unknown[] = []) {
  return {
    execute: vi.fn().mockResolvedValue(executeResult),
  };
}

function makeClaim(overrides: Partial<ReEvalClaimInput> = {}): ReEvalClaimInput {
  return {
    claimId: 1,
    documentId: 10,
    upstreamVerdict: "Supported",
    provenanceScore: 0.8,
    compositeTruthScore: null,
    compositeTruthLabel: null,
    ...overrides,
  };
}

// ─── getAffectedDocumentIds ───────────────────────────────────────────────────

describe("getAffectedDocumentIds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns document IDs from recent citation_edges rows", async () => {
    const db = makeDb([
      { sourceDocId: 5 },
      { sourceDocId: 12 },
      { sourceDocId: 99 },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const ids = await getAffectedDocumentIds(24);
    expect(ids).toEqual([5, 12, 99]);
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it("returns empty array when no recent citation edges", async () => {
    const db = makeDb([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const ids = await getAffectedDocumentIds(6);
    expect(ids).toEqual([]);
  });

  it("returns empty array when DB is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const ids = await getAffectedDocumentIds(24);
    expect(ids).toEqual([]);
  });

  it("returns empty array and does not throw on DB error", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("connection refused"));
    const ids = await getAffectedDocumentIds(24);
    expect(ids).toEqual([]);
  });

  it("filters out NaN values from malformed rows", async () => {
    const db = makeDb([
      { sourceDocId: 7 },
      { sourceDocId: "not-a-number" },
      { sourceDocId: 42 },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const ids = await getAffectedDocumentIds(24);
    expect(ids).toEqual([7, 42]);
  });
});

// ─── getEligibleClaimsForDocument ─────────────────────────────────────────────

describe("getEligibleClaimsForDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns claims with all fields mapped correctly", async () => {
    const db = makeDb([
      {
        claimId: 1,
        documentId: 10,
        upstreamVerdict: "Supported",
        provenanceScore: 0.75,
        compositeTruthScore: 0.85,
        compositeTruthLabel: "verified_faithful",
      },
      {
        claimId: 2,
        documentId: 10,
        upstreamVerdict: "Contradicted",
        provenanceScore: null,
        compositeTruthScore: null,
        compositeTruthLabel: null,
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const claims = await getEligibleClaimsForDocument(10);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({
      claimId: 1,
      documentId: 10,
      upstreamVerdict: "Supported",
      provenanceScore: 0.75,
      compositeTruthScore: 0.85,
      compositeTruthLabel: "verified_faithful",
    });
    expect(claims[1]).toMatchObject({
      claimId: 2,
      upstreamVerdict: "Contradicted",
      provenanceScore: null,
      compositeTruthScore: null,
      compositeTruthLabel: null,
    });
  });

  it("returns empty array when document has no eligible claims", async () => {
    const db = makeDb([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const claims = await getEligibleClaimsForDocument(999);
    expect(claims).toEqual([]);
  });

  it("returns empty array when DB is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const claims = await getEligibleClaimsForDocument(10);
    expect(claims).toEqual([]);
  });

  it("returns empty array and does not throw on DB error", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("timeout"));
    const claims = await getEligibleClaimsForDocument(10);
    expect(claims).toEqual([]);
  });
});

// ─── reScoreClaim ─────────────────────────────────────────────────────────────

describe("reScoreClaim", () => {
  beforeEach(() => vi.clearAllMocks());

  const chainStats = { totalCitingPapers: 3, maxDistortionScore: 0.4 };

  it("writes updated composite signal when label changes", async () => {
    const claim = makeClaim({
      upstreamVerdict: "Supported",
      provenanceScore: 0.8,
      compositeTruthScore: null,
      compositeTruthLabel: null,
    });

    const outcome = await reScoreClaim(claim, chainStats);

    // Supported + distortion 0.4 (>= 0.25) → verified_distorted
    expect(outcome.status).toBe("updated");
    expect(outcome.newLabel).toBe("verified_distorted");
    expect(outcome.newScore).toBeGreaterThan(0);
    expect(outcome.newScore).toBeLessThanOrEqual(1);
    expect(updateClaimVerdict).toHaveBeenCalledWith(1, {
      compositeTruthScore: outcome.newScore,
      compositeTruthLabel: "verified_distorted",
    });
  });

  it("marks outcome as unchanged when label and score are identical (idempotency)", async () => {
    // Pre-compute what the engine will produce for this input
    const { computeCompositeTruth } = await import("./compositeTruthEngine");
    const expected = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: 0.8,
      chainDistortionScore: 0.4,
      chainHopCount: 3,
    });

    const claim = makeClaim({
      upstreamVerdict: "Supported",
      provenanceScore: 0.8,
      compositeTruthScore: expected.score,
      compositeTruthLabel: expected.label,
    });

    const outcome = await reScoreClaim(claim, chainStats);

    expect(outcome.status).toBe("unchanged");
    expect(outcome.newLabel).toBe(expected.label);
    // No DB write should happen
    expect(updateClaimVerdict).not.toHaveBeenCalled();
  });

  it("uses null chainDistortionScore when totalCitingPapers is 0", async () => {
    const claim = makeClaim({
      upstreamVerdict: "Supported",
      provenanceScore: 0.9,
      compositeTruthScore: null,
      compositeTruthLabel: null,
    });
    const noChainStats = { totalCitingPapers: 0, maxDistortionScore: 0 };

    const outcome = await reScoreClaim(claim, noChainStats);

    // Supported + no chain data → verified_faithful (distortion treated as null/low)
    expect(outcome.status).toBe("updated");
    expect(outcome.newLabel).toBe("verified_faithful");
  });

  it("produces contradicted label for Contradicted verdict with low distortion", async () => {
    const claim = makeClaim({
      upstreamVerdict: "Contradicted",
      provenanceScore: 0.7,
      compositeTruthScore: null,
      compositeTruthLabel: null,
    });
    const lowChain = { totalCitingPapers: 1, maxDistortionScore: 0.1 };

    const outcome = await reScoreClaim(claim, lowChain);

    expect(outcome.status).toBe("updated");
    expect(outcome.newLabel).toBe("contradicted");
    expect(outcome.newScore).toBeLessThan(0.2);
  });

  it("produces contradicted_amplified for Contradicted + high distortion", async () => {
    const claim = makeClaim({
      upstreamVerdict: "Contradicted",
      provenanceScore: 0.6,
      compositeTruthScore: null,
      compositeTruthLabel: null,
    });
    const highChain = { totalCitingPapers: 5, maxDistortionScore: 0.8 };

    const outcome = await reScoreClaim(claim, highChain);

    expect(outcome.status).toBe("updated");
    expect(outcome.newLabel).toBe("contradicted_amplified");
    expect(outcome.newScore).toBeLessThan(0.1);
  });

  it("returns error outcome when updateClaimVerdict throws", async () => {
    vi.mocked(updateClaimVerdict).mockRejectedValueOnce(
      new Error("DB write failed")
    );

    const claim = makeClaim({
      upstreamVerdict: "Supported",
      provenanceScore: 0.8,
      compositeTruthScore: null,
      compositeTruthLabel: null,
    });

    const outcome = await reScoreClaim(claim, chainStats);

    expect(outcome.status).toBe("error");
    expect(outcome.errorMessage).toContain("DB write failed");
    expect(outcome.newLabel).toBeNull();
  });

  it("handles null upstreamVerdict gracefully", async () => {
    const claim = makeClaim({
      upstreamVerdict: null,
      provenanceScore: null,
      compositeTruthScore: null,
      compositeTruthLabel: null,
    });

    const outcome = await reScoreClaim(claim, chainStats);

    // null verdict → insufficient_evidence or out_of_scope
    expect(["updated", "unchanged", "error"]).toContain(outcome.status);
    if (outcome.status === "updated") {
      expect(outcome.newLabel).toBeTruthy();
    }
  });

  it("score tolerance prevents micro-drift updates (< 0.001 difference)", async () => {
    const { computeCompositeTruth } = await import("./compositeTruthEngine");
    const expected = computeCompositeTruth({
      upstreamVerdict: "Partially Supported",
      provenanceScore: 0.6,
      chainDistortionScore: 0.3,
      chainHopCount: 2,
    });

    // Simulate a stored score that differs by less than 0.001 (floating point drift)
    const claim = makeClaim({
      upstreamVerdict: "Partially Supported",
      provenanceScore: 0.6,
      compositeTruthScore: expected.score + 0.0005,
      compositeTruthLabel: expected.label,
    });
    const stats = { totalCitingPapers: 2, maxDistortionScore: 0.3 };

    const outcome = await reScoreClaim(claim, stats);

    expect(outcome.status).toBe("unchanged");
    expect(updateClaimVerdict).not.toHaveBeenCalled();
  });
});

// ─── runReEvaluationLoop ──────────────────────────────────────────────────────

describe("runReEvaluationLoop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zero-result when no affected documents found", async () => {
    // getAffectedDocumentIds returns empty
    const db = makeDb([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await runReEvaluationLoop({ lookbackHours: 24 });

    expect(result.affectedDocuments).toBe(0);
    expect(result.claimsExamined).toBe(0);
    expect(result.claimsUpdated).toBe(0);
    expect(result.outcomes).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("processes explicit documentIds when provided (bypasses discovery)", async () => {
    // getEligibleClaimsForDocument will be called with the explicit IDs
    const db = makeDb([
      {
        claimId: 1,
        documentId: 42,
        upstreamVerdict: "Supported",
        provenanceScore: 0.85,
        compositeTruthScore: null,
        compositeTruthLabel: null,
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getCitationChainStats).mockResolvedValue({
      totalCitingPapers: 2,
      maxDistortionScore: 0.1,
      dominantType: "faithful",
    });

    const result = await runReEvaluationLoop({ documentIds: [42] });

    expect(result.affectedDocuments).toBe(1);
    expect(result.claimsExamined).toBe(1);
    expect(result.claimsUpdated + result.claimsUnchanged).toBe(1);
  });

  it("respects batchSize limit and stops early", async () => {
    // Return 3 claims per document, but batchSize = 2
    const db = makeDb([
      { claimId: 1, documentId: 10, upstreamVerdict: "Supported", provenanceScore: 0.8, compositeTruthScore: null, compositeTruthLabel: null },
      { claimId: 2, documentId: 10, upstreamVerdict: "Supported", provenanceScore: 0.7, compositeTruthScore: null, compositeTruthLabel: null },
      { claimId: 3, documentId: 10, upstreamVerdict: "Supported", provenanceScore: 0.6, compositeTruthScore: null, compositeTruthLabel: null },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getCitationChainStats).mockResolvedValue({
      totalCitingPapers: 1,
      maxDistortionScore: 0.1,
      dominantType: "faithful",
    });

    const result = await runReEvaluationLoop({
      documentIds: [10],
      batchSize: 2,
    });

    expect(result.claimsExamined).toBe(2);
    expect(result.claimsExamined).toBeLessThanOrEqual(2);
  });

  it("isolates per-claim errors — other claims still process", async () => {
    const db = makeDb([
      { claimId: 1, documentId: 10, upstreamVerdict: "Supported", provenanceScore: 0.8, compositeTruthScore: null, compositeTruthLabel: null },
      { claimId: 2, documentId: 10, upstreamVerdict: "Contradicted", provenanceScore: 0.5, compositeTruthScore: null, compositeTruthLabel: null },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getCitationChainStats).mockResolvedValue({
      totalCitingPapers: 2,
      maxDistortionScore: 0.3,
      dominantType: "amplification",
    });

    // Make the first updateClaimVerdict call fail, second succeed
    vi.mocked(updateClaimVerdict)
      .mockRejectedValueOnce(new Error("write error"))
      .mockResolvedValue(undefined);

    const result = await runReEvaluationLoop({ documentIds: [10] });

    expect(result.claimsExamined).toBe(2);
    expect(result.claimsErrored).toBe(1);
    // Second claim should still have been processed
    expect(result.claimsUpdated + result.claimsUnchanged + result.claimsErrored).toBe(2);
  });

  it("handles getCitationChainStats failure gracefully (uses zero chain stats)", async () => {
    const db = makeDb([
      { claimId: 5, documentId: 20, upstreamVerdict: "Supported", provenanceScore: 0.9, compositeTruthScore: null, compositeTruthLabel: null },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getCitationChainStats).mockRejectedValue(
      new Error("PubMed timeout")
    );

    const result = await runReEvaluationLoop({ documentIds: [20] });

    // Should still process the claim with zero chain stats
    expect(result.claimsExamined).toBe(1);
    // Supported + no chain → verified_faithful
    const outcome = result.outcomes[0];
    expect(outcome).toBeDefined();
    expect(["updated", "unchanged"]).toContain(outcome.status);
    if (outcome.status === "updated") {
      expect(outcome.newLabel).toBe("verified_faithful");
    }
  });

  it("counts updated, unchanged, and errored claims correctly in summary", async () => {
    const { computeCompositeTruth } = await import("./compositeTruthEngine");
    const alreadyComputed = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: 0.8,
      chainDistortionScore: 0.1,
      chainHopCount: 1,
    });

    const db = makeDb([
      // Claim 1: will be updated (no prior label)
      { claimId: 1, documentId: 30, upstreamVerdict: "Supported", provenanceScore: 0.8, compositeTruthScore: null, compositeTruthLabel: null },
      // Claim 2: already has the correct label → unchanged
      { claimId: 2, documentId: 30, upstreamVerdict: "Supported", provenanceScore: 0.8, compositeTruthScore: alreadyComputed.score, compositeTruthLabel: alreadyComputed.label },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getCitationChainStats).mockResolvedValue({
      totalCitingPapers: 1,
      maxDistortionScore: 0.1,
      dominantType: "faithful",
    });

    const result = await runReEvaluationLoop({ documentIds: [30] });

    expect(result.claimsExamined).toBe(2);
    expect(result.claimsUpdated).toBe(1);
    expect(result.claimsUnchanged).toBe(1);
    expect(result.claimsErrored).toBe(0);
  });

  it("returns durationMs as a non-negative number", async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb([]) as never);

    const result = await runReEvaluationLoop({ documentIds: [] });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe("number");
  });
});
