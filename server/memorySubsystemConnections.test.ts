/**
 * memorySubsystemConnections.test.ts
 *
 * Tests for the three gap connections between memory subsystems:
 *
 *   Gap A — mrAgentContradictionPersist: MRAgent real-time detections → contradiction_alerts DB
 *   Gap B — trainingExporter: routes through trainingBridge.emitVerdictEvent
 *   Gap C — claimSimilarityEngine: optional MRAgent episodic pass in findSimilarClaims
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./mrAgentClient", () => ({
  querySimilarVerdicts: vi.fn(),
  fetchPriorContext: vi.fn(),
  ingestVerifiedClaim: vi.fn(),
  getMemoryStats: vi.fn(),
}));

vi.mock("./trainingBridge", () => ({
  emitVerdictEvent: vi.fn(),
  getPipelineStats: vi.fn(),
}));

vi.mock("./_core/env", () => ({
  ENV: {
    mrAgentEnabled: true,
    mrAgentUrl: "http://localhost:8002",
    trainingExportMinConfidence: 0.85,
    clfCorpusPath: "",
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { persistMrAgentContradiction } from "./mrAgentContradictionPersist";
import { exportHighConfidenceVerdict } from "./trainingExporter";
import { findSimilarClaims } from "./claimSimilarityEngine";
import { getDb } from "./db";
import { querySimilarVerdicts, ingestVerifiedClaim } from "./mrAgentClient";
import { emitVerdictEvent } from "./trainingBridge";
import type { MrAgentContradictionResult } from "./mrAgentContradictionCheck";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeContradiction(overrides: Partial<MrAgentContradictionResult> = {}): MrAgentContradictionResult {
  return {
    detected: true,
    claimId: 42,
    newVerdict: "Supported",
    storedVerdict: "Contradicted",
    storedEpisodeId: "claim-7-1700000000000",
    similarityScore: 0.91,
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDbMock(existingRows: { id: number; status: string }[] = []) {
  const valuesFn = vi.fn().mockResolvedValue(undefined);
  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });

  const whereFn2 = vi.fn().mockResolvedValue(undefined);
  const setFn = vi.fn().mockReturnValue({ where: whereFn2 });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });

  const limitFn = vi.fn().mockResolvedValue(existingRows);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  return { insert: insertFn, update: updateFn, select: selectFn, _valuesFn: valuesFn };
}

// ─── Gap A Tests ─────────────────────────────────────────────────────────────

describe("Gap A — mrAgentContradictionPersist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a new contradiction_alert when none exists", async () => {
    const db = makeDbMock([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await persistMrAgentContradiction(makeContradiction({ similarityScore: 0.97 }));

    expect(db.insert).toHaveBeenCalledOnce();
    expect(db._valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        claimAId: 42,
        claimBId: 7,
        claimAVerdict: "Supported",
        claimBVerdict: "Contradicted",
        status: "open",
        severity: "high",
      })
    );
  });

  it("derives severity=high when score ≥ 0.95", async () => {
    const db = makeDbMock([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await persistMrAgentContradiction(makeContradiction({ similarityScore: 0.97 }));

    expect(db._valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "high" })
    );
  });

  it("derives severity=medium when 0.85 ≤ score < 0.95", async () => {
    const db = makeDbMock([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await persistMrAgentContradiction(makeContradiction({ similarityScore: 0.88 }));

    expect(db._valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "medium" })
    );
  });

  it("derives severity=low when score < 0.85", async () => {
    const db = makeDbMock([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await persistMrAgentContradiction(makeContradiction({ similarityScore: 0.75 }));

    expect(db._valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "low" })
    );
  });

  it("updates an existing open alert instead of inserting", async () => {
    const db = makeDbMock([{ id: 99, status: "open" }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await persistMrAgentContradiction(makeContradiction());

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledOnce();
  });

  it("skips a resolved alert without updating", async () => {
    const db = makeDbMock([{ id: 99, status: "resolved" }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await persistMrAgentContradiction(makeContradiction());

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("skips a dismissed alert without updating", async () => {
    const db = makeDbMock([{ id: 99, status: "dismissed" }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await persistMrAgentContradiction(makeContradiction());

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("does nothing when detected=false", async () => {
    const db = makeDbMock([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await persistMrAgentContradiction(makeContradiction({ detected: false }));

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("does nothing when storedEpisodeId is missing", async () => {
    const db = makeDbMock([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await persistMrAgentContradiction(makeContradiction({ storedEpisodeId: undefined }));

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("does nothing when storedEpisodeId cannot be parsed to a claimId", async () => {
    const db = makeDbMock([]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await persistMrAgentContradiction(makeContradiction({ storedEpisodeId: "unknown-episode-xyz" }));

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("never throws when DB is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);

    await expect(persistMrAgentContradiction(makeContradiction())).resolves.not.toThrow();
  });

  it("never throws when DB throws", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("DB connection refused"));

    await expect(persistMrAgentContradiction(makeContradiction())).resolves.not.toThrow();
  });
});

// ─── Gap B Tests ─────────────────────────────────────────────────────────────

describe("Gap B — trainingExporter routes through trainingBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ingestVerifiedClaim).mockResolvedValue({ success: true, episode_id: "ep-1" } as never);
  });

  it("calls emitVerdictEvent for high-confidence verdicts", async () => {
    const result = await exportHighConfidenceVerdict({
      claimId: 1,
      claimText: "Whey protein increases muscle protein synthesis",
      verdict: "Supported",
      confidenceScore: 0.92,
      citation: "https://pubmed.ncbi.nlm.nih.gov/12345",
      domain: "protein_supplement",
    });

    expect(emitVerdictEvent).toHaveBeenCalledOnce();
    expect(emitVerdictEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        claimText: "Whey protein increases muscle protein synthesis",
        verdict: "Supported",
        domain: "protein_supplement",
      })
    );
    expect(result.channels).toContain("trainingBridge");
  });

  it("does NOT call emitVerdictEvent below confidence threshold", async () => {
    const result = await exportHighConfidenceVerdict({
      claimId: 2,
      claimText: "Some low-confidence claim",
      verdict: "Insufficient Evidence",
      confidenceScore: 0.5,
      citation: "",
      domain: "general",
    });

    expect(emitVerdictEvent).not.toHaveBeenCalled();
    expect(result.exported).toBe(false);
    expect(result.channels).toHaveLength(0);
  });

  it("includes trainingBridge in channels alongside mrAgent", async () => {
    const result = await exportHighConfidenceVerdict({
      claimId: 3,
      claimText: "Creatine improves high-intensity exercise performance",
      verdict: "Supported",
      confidenceScore: 0.95,
      citation: "https://pubmed.ncbi.nlm.nih.gov/99999",
      domain: "sports_nutrition",
    });

    expect(result.channels).toContain("mrAgent");
    expect(result.channels).toContain("trainingBridge");
    expect(result.exported).toBe(true);
  });

  it("still exports to trainingBridge even when mrAgent ingest fails", async () => {
    vi.mocked(ingestVerifiedClaim).mockRejectedValue(new Error("MRAgent down"));

    const result = await exportHighConfidenceVerdict({
      claimId: 4,
      claimText: "Beta-alanine buffers muscle acidity",
      verdict: "Supported",
      confidenceScore: 0.88,
      citation: "",
      domain: "sports_nutrition",
    });

    expect(emitVerdictEvent).toHaveBeenCalledOnce();
    expect(result.channels).toContain("trainingBridge");
    expect(result.channels).not.toContain("mrAgent");
  });

  it("never throws when emitVerdictEvent throws", async () => {
    vi.mocked(emitVerdictEvent).mockImplementation(() => {
      throw new Error("trainingBridge exploded");
    });

    await expect(
      exportHighConfidenceVerdict({
        claimId: 5,
        claimText: "Protein timing matters",
        verdict: "Partially Supported",
        confidenceScore: 0.87,
        citation: "",
        domain: "nutrition",
      })
    ).resolves.not.toThrow();
  });
});

// ─── Gap C Tests ─────────────────────────────────────────────────────────────

function makeEmptyDbMock() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    }),
  };
}

function makeDbWithRows(rows: object[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      }),
    }),
  };
}

describe("Gap C — claimSimilarityEngine MRAgent episodic pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(makeEmptyDbMock() as never);
  });

  it("returns episodic results when DB is empty and MRAgent has matches", async () => {
    vi.mocked(querySimilarVerdicts).mockResolvedValue([
      {
        episode_id: "claim-10-1700000000000",
        text: "VERDICT: Supported\nCLAIM: Whey protein increases MPS",
        score: 0.88,
      },
    ] as never);

    const results = await findSimilarClaims("Whey protein increases muscle protein synthesis", {
      includeMrAgentEpisodic: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].claimText).toBe("Whey protein increases MPS");
    expect(results[0].verdict).toBe("Supported");
    expect(results[0].documentTitle).toBe("[episodic memory]");
    expect(results[0].claimId).toBe(10);
  });

  it("skips episodic pass when includeMrAgentEpisodic=false", async () => {
    vi.mocked(querySimilarVerdicts).mockResolvedValue([
      { episode_id: "claim-10-1700000000000", text: "VERDICT: Supported\nCLAIM: Whey protein", score: 0.88 },
    ] as never);

    const results = await findSimilarClaims("Whey protein increases MPS", {
      includeMrAgentEpisodic: false,
    });

    expect(querySimilarVerdicts).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });

  it("deduplicates episodic results already present in DB results", async () => {
    vi.mocked(getDb).mockResolvedValue(makeDbWithRows([
      {
        claimId: 10,
        documentId: 1,
        documentTitle: "Paper A",
        claimText: "Whey protein increases MPS",
        verdict: "Supported",
        confidenceScore: 0.9,
      },
    ]) as never);

    vi.mocked(querySimilarVerdicts).mockResolvedValue([
      { episode_id: "claim-10-1700000000000", text: "VERDICT: Supported\nCLAIM: Whey protein increases MPS", score: 0.92 },
    ] as never);

    const results = await findSimilarClaims("Whey protein MPS", {
      includeMrAgentEpisodic: true,
    });

    const ids = results.map(r => r.claimId);
    expect(ids.filter(id => id === 10)).toHaveLength(1);
  });

  it("skips malformed episode text that does not match VERDICT/CLAIM format", async () => {
    vi.mocked(querySimilarVerdicts).mockResolvedValue([
      { episode_id: "claim-11-1700000000000", text: "some random text without format", score: 0.9 },
    ] as never);

    const results = await findSimilarClaims("Whey protein", {
      includeMrAgentEpisodic: true,
    });

    expect(results).toHaveLength(0);
  });

  it("falls back to DB-only results when MRAgent throws", async () => {
    vi.mocked(querySimilarVerdicts).mockRejectedValue(new Error("ECONNREFUSED"));

    const results = await findSimilarClaims("Whey protein", {
      includeMrAgentEpisodic: true,
    });

    expect(results).toHaveLength(0);
  });

  it("re-sorts merged results by similarity descending", async () => {
    vi.mocked(getDb).mockResolvedValue(makeDbWithRows([
      {
        claimId: 20,
        documentId: 2,
        documentTitle: "Paper B",
        claimText: "Protein supplementation",
        verdict: "Partially Supported",
        confidenceScore: 0.7,
      },
    ]) as never);

    vi.mocked(querySimilarVerdicts).mockResolvedValue([
      { episode_id: "claim-30-1700000000000", text: "VERDICT: Supported\nCLAIM: Whey protein MPS boost", score: 0.95 },
    ] as never);

    const results = await findSimilarClaims("Whey protein increases MPS", {
      includeMrAgentEpisodic: true,
    });

    // Episodic result (score 0.95) should come first
    expect(results[0].claimId).toBe(30);
    expect(results[0].similarity).toBe(0.95);
  });
});
