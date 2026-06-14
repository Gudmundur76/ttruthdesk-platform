/**
 * embeddingBackfillJob.test.ts
 * Unit tests for server/embeddingBackfillJob.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockIndexClaim: vi.fn(),
  mockIsSidecarAvailable: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./vectorStore", () => ({
  indexClaim: mocks.mockIndexClaim,
  isSidecarAvailable: mocks.mockIsSidecarAvailable,
}));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

const makeDb = (rows: Array<{ id: number; claimText: string; verdict: string }> = []) => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockReturnValue(db);
  db.limit.mockReturnValue(db);
  db.offset.mockResolvedValue(rows);
  return db;
};

describe("runEmbeddingBackfill()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockIsSidecarAvailable.mockResolvedValue(true);
    mocks.mockIndexClaim.mockResolvedValue(undefined);
  });

  it("returns all-zero result when sidecar is unavailable", async () => {
    mocks.mockIsSidecarAvailable.mockResolvedValue(false);
    const { runEmbeddingBackfill } = await import("./embeddingBackfillJob");
    const result = await runEmbeddingBackfill();
    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(mocks.mockGetDb).not.toHaveBeenCalled();
  });

  it("returns all-zero result when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { runEmbeddingBackfill } = await import("./embeddingBackfillJob");
    const result = await runEmbeddingBackfill();
    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("indexes all eligible claims and returns correct counts", async () => {
    const rows = [
      { id: 1, claimText: "Claim one", verdict: "Supported" },
      { id: 2, claimText: "Claim two", verdict: "Partially Supported" },
    ];
    const db = makeDb(rows);
    db.offset
      .mockResolvedValueOnce(rows) // first page
      .mockResolvedValueOnce([]); // empty second page
    mocks.mockGetDb.mockResolvedValue(db);
    const { runEmbeddingBackfill } = await import("./embeddingBackfillJob");
    const result = await runEmbeddingBackfill();
    expect(result.indexed).toBe(2);
    expect(result.errors).toBe(0);
    expect(mocks.mockIndexClaim).toHaveBeenCalledTimes(2);
  });

  it("skips claims with empty claimText", async () => {
    const rows = [
      { id: 1, claimText: "", verdict: "Supported" },
      { id: 2, claimText: "Valid claim", verdict: "Supported" },
    ];
    const db = makeDb(rows);
    db.offset
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { runEmbeddingBackfill } = await import("./embeddingBackfillJob");
    const result = await runEmbeddingBackfill();
    expect(result.skipped).toBe(1);
    expect(result.indexed).toBe(1);
  });

  it("counts errors when indexClaim throws", async () => {
    const rows = [
      { id: 1, claimText: "Claim one", verdict: "Supported" },
    ];
    const db = makeDb(rows);
    db.offset
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([]);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockIndexClaim.mockRejectedValue(new Error("Sidecar error"));
    const { runEmbeddingBackfill } = await import("./embeddingBackfillJob");
    const result = await runEmbeddingBackfill();
    expect(result.errors).toBe(1);
    expect(result.indexed).toBe(0);
  });

  it("processes multiple pages when batch is full", async () => {
    const page1 = Array.from({ length: 2 }, (_, i) => ({ id: i + 1, claimText: `Claim ${i + 1}`, verdict: "Supported" }));
    const page2 = [{ id: 3, claimText: "Claim 3", verdict: "Supported" }];
    const db = makeDb([]);
    db.offset
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockResolvedValueOnce([]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { runEmbeddingBackfill } = await import("./embeddingBackfillJob");
    const result = await runEmbeddingBackfill({ batchSize: 2 });
    expect(result.indexed).toBe(3);
  });
});
