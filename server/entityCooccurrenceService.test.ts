/**
 * entityCooccurrenceService.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for entityCooccurrenceService.ts
 *
 * All DB calls are mocked so no real database is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildGraphData,
  type CooccurrenceRow,
} from "./entityCooccurrenceService";

// ─── Mock the DB module ───────────────────────────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// ─── buildGraphData ───────────────────────────────────────────────────────────

describe("buildGraphData", () => {
  it("returns empty nodes and links for empty input", () => {
    const result = buildGraphData([]);
    expect(result.nodes).toHaveLength(0);
    expect(result.links).toHaveLength(0);
  });

  it("creates nodes for each unique entity", () => {
    const rows: CooccurrenceRow[] = [
      {
        entityAId: 1,
        entityBId: 2,
        entityAName: "Protein A",
        entityBName: "Protein B",
        entityAType: "protein",
        entityBType: "protein",
        coCount: 3,
        documentId: 10,
      },
    ];
    const result = buildGraphData(rows);
    expect(result.nodes).toHaveLength(2);
    const ids = result.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it("creates one link per row", () => {
    const rows: CooccurrenceRow[] = [
      {
        entityAId: 1,
        entityBId: 2,
        entityAName: "A",
        entityBName: "B",
        entityAType: "protein",
        entityBType: "method",
        coCount: 5,
        documentId: 10,
      },
      {
        entityAId: 2,
        entityBId: 3,
        entityAName: "B",
        entityBName: "C",
        entityAType: "method",
        entityBType: "organism",
        coCount: 2,
        documentId: 10,
      },
    ];
    const result = buildGraphData(rows);
    expect(result.links).toHaveLength(2);
    expect(result.links[0]).toMatchObject({ source: 1, target: 2, value: 5 });
    expect(result.links[1]).toMatchObject({ source: 2, target: 3, value: 2 });
  });

  it("deduplicates nodes that appear in multiple rows", () => {
    const rows: CooccurrenceRow[] = [
      {
        entityAId: 1,
        entityBId: 2,
        entityAName: "A",
        entityBName: "B",
        entityAType: "protein",
        entityBType: "protein",
        coCount: 1,
        documentId: 1,
      },
      {
        entityAId: 1,
        entityBId: 3,
        entityAName: "A",
        entityBName: "C",
        entityAType: "protein",
        entityBType: "method",
        coCount: 2,
        documentId: 2,
      },
    ];
    const result = buildGraphData(rows);
    // Only 3 unique entities: 1, 2, 3
    expect(result.nodes).toHaveLength(3);
  });

  it("computes degree correctly", () => {
    const rows: CooccurrenceRow[] = [
      {
        entityAId: 1,
        entityBId: 2,
        entityAName: "A",
        entityBName: "B",
        entityAType: "protein",
        entityBType: "protein",
        coCount: 1,
        documentId: 1,
      },
      {
        entityAId: 1,
        entityBId: 3,
        entityAName: "A",
        entityBName: "C",
        entityAType: "protein",
        entityBType: "method",
        coCount: 1,
        documentId: 1,
      },
      {
        entityAId: 2,
        entityBId: 3,
        entityAName: "B",
        entityBName: "C",
        entityAType: "protein",
        entityBType: "method",
        coCount: 1,
        documentId: 1,
      },
    ];
    const result = buildGraphData(rows);
    const nodeA = result.nodes.find((n) => n.id === 1);
    const nodeB = result.nodes.find((n) => n.id === 2);
    const nodeC = result.nodes.find((n) => n.id === 3);
    // A appears in 2 rows → degree 2
    expect(nodeA?.degree).toBe(2);
    // B appears in 2 rows → degree 2
    expect(nodeB?.degree).toBe(2);
    // C appears in 2 rows → degree 2
    expect(nodeC?.degree).toBe(2);
  });

  it("preserves entity type on nodes", () => {
    const rows: CooccurrenceRow[] = [
      {
        entityAId: 10,
        entityBId: 20,
        entityAName: "MyProtein",
        entityBName: "MyMethod",
        entityAType: "protein",
        entityBType: "method",
        coCount: 1,
        documentId: 5,
      },
    ];
    const result = buildGraphData(rows);
    const p = result.nodes.find((n) => n.id === 10);
    const m = result.nodes.find((n) => n.id === 20);
    expect(p?.entityType).toBe("protein");
    expect(m?.entityType).toBe("method");
  });

  it("preserves documentId on links", () => {
    const rows: CooccurrenceRow[] = [
      {
        entityAId: 1,
        entityBId: 2,
        entityAName: "A",
        entityBName: "B",
        entityAType: "protein",
        entityBType: "protein",
        coCount: 7,
        documentId: 42,
      },
    ];
    const result = buildGraphData(rows);
    expect(result.links[0].documentId).toBe(42);
  });

  it("handles a single node pair with high coCount", () => {
    const rows: CooccurrenceRow[] = [
      {
        entityAId: 100,
        entityBId: 200,
        entityAName: "Alpha",
        entityBName: "Beta",
        entityAType: "concept",
        entityBType: "ligand",
        coCount: 999,
        documentId: 1,
      },
    ];
    const result = buildGraphData(rows);
    expect(result.links[0].value).toBe(999);
  });
});

// ─── computeCooccurrencesForDocument (mocked DB) ─────────────────────────────

describe("computeCooccurrencesForDocument", () => {
  it("returns 0 when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { computeCooccurrencesForDocument } = await import("./entityCooccurrenceService");
    const result = await computeCooccurrencesForDocument(1);
    expect(result).toBe(0);
  });

  it("returns 0 when fewer than 2 entities in document", async () => {
    const { getDb } = await import("./db");
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { sourceEntityId: 1, targetEntityId: 1 }, // same entity both sides
      ]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDb).mockResolvedValueOnce(mockDb as any);
    const { computeCooccurrencesForDocument } = await import("./entityCooccurrenceService");
    const result = await computeCooccurrencesForDocument(99);
    expect(result).toBe(0);
  });
});

// ─── getTopCooccurrences (mocked DB) ─────────────────────────────────────────

describe("getTopCooccurrences", () => {
  it("returns empty array when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getTopCooccurrences } = await import("./entityCooccurrenceService");
    const result = await getTopCooccurrences({ limit: 10 });
    expect(result).toEqual([]);
  });

  it("returns empty array when no co-occurrence rows exist", async () => {
    const { getDb } = await import("./db");
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockResolvedValueOnce(mockDb as any);
    const { getTopCooccurrences } = await import("./entityCooccurrenceService");
    const result = await getTopCooccurrences({ limit: 10 });
    expect(result).toEqual([]);
  });
});

// ─── getCooccurrencesForEntity (mocked DB) ────────────────────────────────────

describe("getCooccurrencesForEntity", () => {
  it("returns empty array when db is unavailable", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getCooccurrencesForEntity } = await import("./entityCooccurrenceService");
    const result = await getCooccurrencesForEntity(1, 10);
    expect(result).toEqual([]);
  });

  it("returns empty array when entity has no co-occurrences", async () => {
    const { getDb } = await import("./db");
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockResolvedValueOnce(mockDb as any);
    const { getCooccurrencesForEntity } = await import("./entityCooccurrenceService");
    const result = await getCooccurrencesForEntity(999, 10);
    expect(result).toEqual([]);
  });
});
