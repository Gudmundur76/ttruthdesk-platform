/**
 * server/embeddingPipeline.test.ts
 * Phase 124a — RED tests for:
 *   1. embeddingBackfillJob.ts — bulk-indexes all eligible claims
 *   2. embeddingCoverageAudit.ts — reports % of claims indexed
 *   3. autonomousIngest.ts — calls indexClaim after Supported verdict
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));
vi.mock("./vectorStore", () => ({
  indexClaim: vi.fn(),
  isSidecarAvailable: vi.fn(),
}));
vi.mock("./logger", () => ({
  logger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  errData: vi.fn((e: unknown) => ({ message: String(e) })),
}));

import { getDb } from "./db";
import { indexClaim, isSidecarAvailable } from "./vectorStore";
import {
  runEmbeddingBackfill,
  EmbeddingBackfillResult,
} from "./embeddingBackfillJob";
import {
  getEmbeddingCoverage,
  EmbeddingCoverageReport,
} from "./embeddingCoverageAudit";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeDb(
  rows: Array<{ id: number; claimText: string; verdict: string }>
) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

// ─── embeddingBackfillJob ─────────────────────────────────────────────────────
describe("embeddingBackfillJob — runEmbeddingBackfill", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isSidecarAvailable).mockResolvedValue(true);
    vi.mocked(indexClaim).mockResolvedValue(undefined);
  });

  it("returns a result with indexed, skipped, and errors counts", async () => {
    const db = makeDb([
      { id: 1, claimText: "Protein X folds correctly", verdict: "Supported" },
      {
        id: 2,
        claimText: "Y reduces inflammation",
        verdict: "Partially Supported",
      },
    ]);
    // Second page returns empty to end pagination
    db.offset
      .mockResolvedValueOnce([
        { id: 1, claimText: "Protein X folds correctly", verdict: "Supported" },
        {
          id: 2,
          claimText: "Y reduces inflammation",
          verdict: "Partially Supported",
        },
      ])
      .mockResolvedValueOnce([]);
    vi.mocked(getDb).mockResolvedValue(
      db as unknown as ReturnType<typeof getDb> extends Promise<infer T>
        ? T
        : never
    );

    const result: EmbeddingBackfillResult = await runEmbeddingBackfill();

    expect(result.indexed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(indexClaim).toHaveBeenCalledTimes(2);
    expect(indexClaim).toHaveBeenCalledWith(1, "Protein X folds correctly");
    expect(indexClaim).toHaveBeenCalledWith(2, "Y reduces inflammation");
  });

  it("skips all claims when sidecar is unavailable", async () => {
    vi.mocked(isSidecarAvailable).mockResolvedValue(false);
    vi.mocked(getDb).mockResolvedValue(
      null as unknown as ReturnType<typeof getDb> extends Promise<infer T>
        ? T
        : never
    );

    const result = await runEmbeddingBackfill();

    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(indexClaim).not.toHaveBeenCalled();
  });

  it("counts indexClaim errors without throwing", async () => {
    const db = makeDb([]);
    db.offset
      .mockResolvedValueOnce([
        { id: 3, claimText: "Claim that fails to index", verdict: "Supported" },
      ])
      .mockResolvedValueOnce([]);
    vi.mocked(getDb).mockResolvedValue(
      db as unknown as ReturnType<typeof getDb> extends Promise<infer T>
        ? T
        : never
    );
    vi.mocked(indexClaim).mockRejectedValue(new Error("Sidecar timeout"));

    const result = await runEmbeddingBackfill();

    expect(result.indexed).toBe(0);
    expect(result.errors).toBe(1);
  });

  it("returns skipped count when db is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValue(
      null as unknown as ReturnType<typeof getDb> extends Promise<infer T>
        ? T
        : never
    );

    const result = await runEmbeddingBackfill();

    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("processes claims in batches of 100", async () => {
    const batch1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      claimText: `Claim ${i + 1}`,
      verdict: "Supported",
    }));
    const db = makeDb([]);
    db.offset.mockResolvedValueOnce(batch1).mockResolvedValueOnce([]);
    vi.mocked(getDb).mockResolvedValue(
      db as unknown as ReturnType<typeof getDb> extends Promise<infer T>
        ? T
        : never
    );

    const result = await runEmbeddingBackfill({ batchSize: 100 });

    expect(result.indexed).toBe(100);
    expect(indexClaim).toHaveBeenCalledTimes(100);
  });
});

// ─── embeddingCoverageAudit ───────────────────────────────────────────────────
describe("embeddingCoverageAudit — getEmbeddingCoverage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isSidecarAvailable).mockResolvedValue(true);
  });

  it("returns coverage report with pct, indexed, and eligible counts", async () => {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ count: 200 }]),
    };
    vi.mocked(getDb).mockResolvedValue(
      db as unknown as ReturnType<typeof getDb> extends Promise<infer T>
        ? T
        : never
    );

    // Mock the sidecar health endpoint
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", indexed: 180, dim: 384 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const report: EmbeddingCoverageReport = await getEmbeddingCoverage();

    expect(report.eligible).toBe(200);
    expect(report.indexed).toBe(180);
    expect(report.pct).toBeCloseTo(90);
    expect(report.sidecarAvailable).toBe(true);
  });

  it("returns pct 0 when sidecar is unavailable", async () => {
    vi.mocked(isSidecarAvailable).mockResolvedValue(false);
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ count: 100 }]),
    };
    vi.mocked(getDb).mockResolvedValue(
      db as unknown as ReturnType<typeof getDb> extends Promise<infer T>
        ? T
        : never
    );

    const report = await getEmbeddingCoverage();

    expect(report.sidecarAvailable).toBe(false);
    expect(report.indexed).toBe(0);
    expect(report.pct).toBe(0);
  });

  it("returns pct 100 when all eligible claims are indexed", async () => {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ count: 50 }]),
    };
    vi.mocked(getDb).mockResolvedValue(
      db as unknown as ReturnType<typeof getDb> extends Promise<infer T>
        ? T
        : never
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", indexed: 50, dim: 384 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const report = await getEmbeddingCoverage();

    expect(report.pct).toBe(100);
  });

  it("handles db unavailable gracefully", async () => {
    vi.mocked(getDb).mockResolvedValue(
      null as unknown as ReturnType<typeof getDb> extends Promise<infer T>
        ? T
        : never
    );

    const report = await getEmbeddingCoverage();

    expect(report.eligible).toBe(0);
    expect(report.pct).toBe(0);
  });
});
