/**
 * graphTraversal.test.ts — Phase 104
 *
 * Unit tests for the knowledge graph traversal helpers.
 * All DB calls are mocked — no real database connection required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the DB module ───────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../drizzle/schema", () => ({
  graphClaimEdges: {
    sourceClaimId: "sourceClaimId",
    targetClaimId: "targetClaimId",
    relationType: "relationType",
    weight: "weight",
    $inferSelect: {},
  },
}));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: "eq" })),
    or: vi.fn((...args: unknown[]) => ({ args, op: "or" })),
    desc: vi.fn((col: unknown) => ({ col, op: "desc" })),
    gte: vi.fn((col: unknown, val: unknown) => ({ col, val, op: "gte" })),
    and: vi.fn((...args: unknown[]) => ({ args, op: "and" })),
    inArray: vi.fn((col: unknown, vals: unknown) => ({ col, vals, op: "inArray" })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
      _tag: "sql",
    })),
  };
});

import {
  insertGraphClaimEdge,
  getGraphClaimEdgesBySource,
  findSimilarClaimsWithSignals,
  getCompositeSignalForClaim,
  buildClaimSubgraph,
  findClaimsByTextSimilarity,
} from "./graphTraversal";
import { getDb } from "./db";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(overrides: Record<string, unknown> = {}) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return chain;
}

// ─── insertGraphClaimEdge ─────────────────────────────────────────────────────

describe("insertGraphClaimEdge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls insert with correct values", async () => {
    const db = makeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);

    await insertGraphClaimEdge({
      sourceClaimId: 1,
      targetClaimId: 2,
      relationType: "semantic_similar",
      weight: 0.85,
    });

    expect(db.insert).toHaveBeenCalled();
    expect(db.values).toHaveBeenCalledWith({
      sourceClaimId: 1,
      targetClaimId: 2,
      relationType: "semantic_similar",
      weight: 0.85,
    });
  });

  it("is non-fatal when DB is null", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    await expect(
      insertGraphClaimEdge({ sourceClaimId: 1, targetClaimId: 2, relationType: "cites", weight: 1 })
    ).resolves.toBeUndefined();
  });

  it("is non-fatal when DB throws", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("DB error"));
    await expect(
      insertGraphClaimEdge({ sourceClaimId: 1, targetClaimId: 2, relationType: "supports", weight: 0.9 })
    ).resolves.toBeUndefined();
  });
});

// ─── getGraphClaimEdgesBySource ───────────────────────────────────────────────

describe("getGraphClaimEdgesBySource", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when DB is null", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const result = await getGraphClaimEdgesBySource(1);
    expect(result).toEqual([]);
  });

  it("returns edges from DB", async () => {
    const mockEdges = [
      { id: 1, sourceClaimId: 1, targetClaimId: 2, relationType: "semantic_similar", weight: 0.9, createdAt: new Date() },
    ];
    const db = makeDb({ limit: vi.fn().mockResolvedValue(mockEdges) });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await getGraphClaimEdgesBySource(1);
    expect(result).toEqual(mockEdges);
  });

  it("returns empty array on DB error", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("DB error"));
    const result = await getGraphClaimEdgesBySource(1);
    expect(result).toEqual([]);
  });
});

// ─── findSimilarClaimsWithSignals ─────────────────────────────────────────────

describe("findSimilarClaimsWithSignals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when DB is null", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const result = await findSimilarClaimsWithSignals(1);
    expect(result).toEqual([]);
  });

  it("maps raw DB rows to ClaimSignal objects", async () => {
    const mockRows = [
      {
        neighbourClaimId: 42,
        claimText: "Protein X has 3 binding sites",
        documentId: 10,
        documentTitle: "Study on Protein X",
        upstreamVerdict: "supported",
        compositeTruthLabel: "verified_faithful",
        compositeTruthScore: 0.92,
        provenanceScore: 0.88,
        relationType: "semantic_similar",
        weight: 0.85,
      },
    ];
    const db = makeDb({ execute: vi.fn().mockResolvedValue(mockRows) });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await findSimilarClaimsWithSignals(1);
    expect(result).toHaveLength(1);
    expect(result[0].claimId).toBe(42);
    expect(result[0].compositeTruthLabel).toBe("verified_faithful");
    expect(result[0].compositeTruthScore).toBe(0.92);
    expect(result[0].edgeWeight).toBe(0.85);
  });

  it("returns empty array on DB error", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("DB error"));
    const result = await findSimilarClaimsWithSignals(1);
    expect(result).toEqual([]);
  });

  it("handles null composite fields gracefully", async () => {
    const mockRows = [
      {
        neighbourClaimId: 5,
        claimText: "Some claim",
        documentId: 1,
        documentTitle: "Doc",
        upstreamVerdict: null,
        compositeTruthLabel: null,
        compositeTruthScore: null,
        provenanceScore: null,
        relationType: "semantic_similar",
        weight: 0.75,
      },
    ];
    const db = makeDb({ execute: vi.fn().mockResolvedValue(mockRows) });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await findSimilarClaimsWithSignals(1);
    expect(result[0].compositeTruthLabel).toBeNull();
    expect(result[0].compositeTruthScore).toBeNull();
    expect(result[0].upstreamVerdict).toBeNull();
  });
});

// ─── getCompositeSignalForClaim ───────────────────────────────────────────────

describe("getCompositeSignalForClaim", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when DB is null", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const result = await getCompositeSignalForClaim(1);
    expect(result).toBeNull();
  });

  it("returns null when no rows returned", async () => {
    const db = makeDb({ execute: vi.fn().mockResolvedValue([]) });
    vi.mocked(getDb).mockResolvedValue(db as never);
    const result = await getCompositeSignalForClaim(1);
    expect(result).toBeNull();
  });

  it("returns composite signal from DB row", async () => {
    const mockRows = [
      {
        compositeTruthLabel: "verified_faithful",
        compositeTruthScore: 0.91,
        upstreamVerdict: "supported",
        provenanceScore: 0.87,
      },
    ];
    const db = makeDb({ execute: vi.fn().mockResolvedValue(mockRows) });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await getCompositeSignalForClaim(42);
    expect(result).not.toBeNull();
    expect(result!.compositeTruthLabel).toBe("verified_faithful");
    expect(result!.compositeTruthScore).toBe(0.91);
    expect(result!.upstreamVerdict).toBe("supported");
    expect(result!.provenanceScore).toBe(0.87);
  });

  it("returns null on DB error", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("DB error"));
    const result = await getCompositeSignalForClaim(1);
    expect(result).toBeNull();
  });
});

// ─── buildClaimSubgraph ───────────────────────────────────────────────────────

describe("buildClaimSubgraph", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty subgraph when no neighbours found", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const result = await buildClaimSubgraph(1);
    expect(result.centreClaimId).toBe(1);
    expect(result.nodes).toEqual([]);
    expect(result.edgeCount).toBe(0);
    expect(result.dominantLabel).toBeNull();
    expect(result.averageCompositeScore).toBeNull();
  });

  it("computes dominant label correctly", async () => {
    const mockRows = [
      {
        neighbourClaimId: 2,
        claimText: "Claim A",
        documentId: 1,
        documentTitle: "Doc A",
        upstreamVerdict: "supported",
        compositeTruthLabel: "verified_faithful",
        compositeTruthScore: 0.9,
        provenanceScore: 0.8,
        relationType: "semantic_similar",
        weight: 0.85,
      },
      {
        neighbourClaimId: 3,
        claimText: "Claim B",
        documentId: 2,
        documentTitle: "Doc B",
        upstreamVerdict: "supported",
        compositeTruthLabel: "verified_faithful",
        compositeTruthScore: 0.8,
        provenanceScore: 0.75,
        relationType: "semantic_similar",
        weight: 0.78,
      },
      {
        neighbourClaimId: 4,
        claimText: "Claim C",
        documentId: 3,
        documentTitle: "Doc C",
        upstreamVerdict: "contradicted",
        compositeTruthLabel: "contradicted",
        compositeTruthScore: 0.2,
        provenanceScore: 0.6,
        relationType: "semantic_similar",
        weight: 0.72,
      },
    ];
    const db = makeDb({ execute: vi.fn().mockResolvedValue(mockRows) });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await buildClaimSubgraph(1);
    expect(result.dominantLabel).toBe("verified_faithful"); // 2 vs 1
    expect(result.edgeCount).toBe(3);
  });

  it("computes average composite score correctly", async () => {
    const mockRows = [
      {
        neighbourClaimId: 2,
        claimText: "A",
        documentId: 1,
        documentTitle: "D",
        upstreamVerdict: null,
        compositeTruthLabel: "verified_faithful",
        compositeTruthScore: 0.8,
        provenanceScore: null,
        relationType: "semantic_similar",
        weight: 0.9,
      },
      {
        neighbourClaimId: 3,
        claimText: "B",
        documentId: 2,
        documentTitle: "E",
        upstreamVerdict: null,
        compositeTruthLabel: "contested",
        compositeTruthScore: 0.4,
        provenanceScore: null,
        relationType: "semantic_similar",
        weight: 0.8,
      },
    ];
    const db = makeDb({ execute: vi.fn().mockResolvedValue(mockRows) });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await buildClaimSubgraph(1);
    expect(result.averageCompositeScore).toBeCloseTo(0.6, 5);
  });

  it("handles all-null composite scores", async () => {
    const mockRows = [
      {
        neighbourClaimId: 2,
        claimText: "A",
        documentId: 1,
        documentTitle: "D",
        upstreamVerdict: null,
        compositeTruthLabel: null,
        compositeTruthScore: null,
        provenanceScore: null,
        relationType: "semantic_similar",
        weight: 0.7,
      },
    ];
    const db = makeDb({ execute: vi.fn().mockResolvedValue(mockRows) });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await buildClaimSubgraph(1);
    expect(result.averageCompositeScore).toBeNull();
    expect(result.dominantLabel).toBeNull();
  });
});

// ─── findClaimsByTextSimilarity ───────────────────────────────────────────────

describe("findClaimsByTextSimilarity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when DB is null", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const result = await findClaimsByTextSimilarity("some claim text");
    expect(result).toEqual([]);
  });

  it("maps DB rows to ClaimSignal objects", async () => {
    const mockRows = [
      {
        claimId: 7,
        claimText: "Protein Y folds at pH 7",
        documentId: 3,
        documentTitle: "Protein Y Study",
        upstreamVerdict: "supported",
        compositeTruthLabel: "verified_faithful",
        compositeTruthScore: 0.88,
        provenanceScore: 0.82,
        relationType: "semantic_similar",
        weight: 0.8,
      },
    ];
    const db = makeDb({ execute: vi.fn().mockResolvedValue(mockRows) });
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await findClaimsByTextSimilarity("Protein Y pH folding");
    expect(result).toHaveLength(1);
    expect(result[0].claimId).toBe(7);
    expect(result[0].compositeTruthLabel).toBe("verified_faithful");
  });

  it("returns empty array on DB error", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("DB error"));
    const result = await findClaimsByTextSimilarity("some text");
    expect(result).toEqual([]);
  });
});
