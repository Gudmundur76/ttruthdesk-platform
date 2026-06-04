/**
 * confidenceTrendService.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vitest unit tests for confidenceTrendService.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockSelect = vi.fn();

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    insert: mockInsert,
    select: mockSelect,
  })),
}));

vi.mock("../drizzle/schema", () => ({
  confidenceHistory: { claimId: "claimId", documentId: "documentId", recordedAt: "recordedAt" },
  claims: { id: "id", documentId: "documentId", confidenceScore: "confidenceScore", confidenceFlags: "confidenceFlags" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: "eq" })),
  desc: vi.fn((col: unknown) => ({ col, order: "desc" })),
  asc: vi.fn((col: unknown) => ({ col, order: "asc" })),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  recordConfidence,
  getConfidenceTrend,
  getLatestConfidence,
  backfillFromClaims,
} from "./confidenceTrendService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  // Make the chain itself awaitable (for non-limited queries)
  Object.defineProperty(chain, Symbol.iterator, { value: undefined });
  // Allow `await chain` to resolve rows for non-limited select
  const thenFn = (resolve: (v: unknown) => void) => resolve(rows);
  chain.then = thenFn;
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("recordConfidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a confidence history row and returns insertId", async () => {
    const valuesChain = { values: vi.fn(async () => ({ insertId: 42 })) };
    mockInsert.mockReturnValue(valuesChain);

    const id = await recordConfidence({
      claimId: 1,
      documentId: 10,
      score: 0.85,
      trigger: "quality_pass",
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(valuesChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ claimId: 1, documentId: 10, score: 0.85, trigger: "quality_pass" })
    );
    expect(id).toBe(42);
  });

  it("clamps score above 1 to 1", async () => {
    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    await recordConfidence({ claimId: 1, documentId: 10, score: 1.5 });

    expect(valuesChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ score: 1 })
    );
  });

  it("clamps score below 0 to 0", async () => {
    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    await recordConfidence({ claimId: 1, documentId: 10, score: -0.2 });

    expect(valuesChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ score: 0 })
    );
  });

  it("defaults trigger to 'initial' when not provided", async () => {
    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    await recordConfidence({ claimId: 1, documentId: 10, score: 0.5 });

    expect(valuesChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "initial" })
    );
  });

  it("passes flags array when provided", async () => {
    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    await recordConfidence({
      claimId: 1,
      documentId: 10,
      score: 0.3,
      flags: ["low_evidence", "single_source"],
    });

    expect(valuesChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ flags: ["low_evidence", "single_source"] })
    );
  });

  it("returns 0 when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    const id = await recordConfidence({ claimId: 1, documentId: 10, score: 0.5 });
    expect(id).toBe(0);
  });
});

describe("getConfidenceTrend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    const result = await getConfidenceTrend(1);
    expect(result).toEqual([]);
  });

  it("returns empty array when no history rows exist", async () => {
    const chain = makeSelectChain([]);
    mockSelect.mockReturnValue(chain);

    const result = await getConfidenceTrend(1);
    expect(result).toEqual([]);
  });

  it("returns mapped trend points in ascending order", async () => {
    const now = new Date();
    const rows = [
      { id: 1, claimId: 5, documentId: 10, score: 0.6, trigger: "initial", flags: null, recordedAt: now },
      { id: 2, claimId: 5, documentId: 10, score: 0.8, trigger: "quality_pass", flags: ["flag1"], recordedAt: now },
    ];
    const chain = makeSelectChain(rows);
    mockSelect.mockReturnValue(chain);

    const result = await getConfidenceTrend(5);

    expect(result).toHaveLength(2);
    expect(result[0].score).toBe(0.6);
    expect(result[0].trigger).toBe("initial");
    expect(result[1].score).toBe(0.8);
    expect(result[1].flags).toEqual(["flag1"]);
  });

  it("returns null flags when flags is not an array", async () => {
    const now = new Date();
    const rows = [
      { id: 1, claimId: 5, documentId: 10, score: 0.7, trigger: "initial", flags: "not-an-array", recordedAt: now },
    ];
    const chain = makeSelectChain(rows);
    mockSelect.mockReturnValue(chain);

    const result = await getConfidenceTrend(5);
    expect(result[0].flags).toBeNull();
  });
});

describe("getLatestConfidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    const result = await getLatestConfidence(1);
    expect(result).toBeNull();
  });

  it("returns null when no history rows exist", async () => {
    const chain = makeSelectChain([]);
    mockSelect.mockReturnValue(chain);

    const result = await getLatestConfidence(1);
    expect(result).toBeNull();
  });

  it("returns the most recent row", async () => {
    const now = new Date();
    const rows = [
      { id: 7, claimId: 3, documentId: 10, score: 0.92, trigger: "human_review", flags: null, recordedAt: now },
    ];
    const chain = makeSelectChain(rows);
    mockSelect.mockReturnValue(chain);

    const result = await getLatestConfidence(3);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(7);
    expect(result!.score).toBe(0.92);
    expect(result!.trigger).toBe("human_review");
  });
});

describe("backfillFromClaims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);

    const count = await backfillFromClaims(10);
    expect(count).toBe(0);
  });

  it("returns 0 when no claims exist for document", async () => {
    const chain = makeSelectChain([]);
    mockSelect.mockReturnValue(chain);

    const count = await backfillFromClaims(10);
    expect(count).toBe(0);
  });

  it("skips claims with null confidenceScore", async () => {
    const chain = makeSelectChain([
      { id: 1, documentId: 10, confidenceScore: null, confidenceFlags: null },
      { id: 2, documentId: 10, confidenceScore: undefined, confidenceFlags: null },
    ]);
    mockSelect.mockReturnValue(chain);

    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    const count = await backfillFromClaims(10);
    expect(count).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("inserts one row per claim with a score", async () => {
    const chain = makeSelectChain([
      { id: 1, documentId: 10, confidenceScore: 0.7, confidenceFlags: ["flag1"] },
      { id: 2, documentId: 10, confidenceScore: 0.5, confidenceFlags: null },
    ]);
    mockSelect.mockReturnValue(chain);

    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    const count = await backfillFromClaims(10);
    expect(count).toBe(2);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("uses 'backfill' as the trigger for all inserted rows", async () => {
    const chain = makeSelectChain([
      { id: 1, documentId: 10, confidenceScore: 0.8, confidenceFlags: null },
    ]);
    mockSelect.mockReturnValue(chain);

    const valuesChain = { values: vi.fn(async () => ({ insertId: 1 })) };
    mockInsert.mockReturnValue(valuesChain);

    await backfillFromClaims(10);

    expect(valuesChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "backfill" })
    );
  });
});
