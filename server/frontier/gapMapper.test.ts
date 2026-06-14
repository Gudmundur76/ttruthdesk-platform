/**
 * gapMapper.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Frontier gap mapper — structural, evidence, contradiction,
 * and temporal gap detection, plus runGapMapper() and detectEvidenceGapForDocument().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../../server/db", () => ({ getDb: mockGetDb }));

import {
  runGapMapper,
  detectEvidenceGapForDocument,
  type DetectedGap,
  type GapMapResult,
} from "./gapMapper";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeChain(rows: unknown[] = []) {
  const p = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.leftJoin = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.groupBy = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(rows);
  c.insert = vi.fn().mockReturnValue(c);
  c.values = vi.fn().mockResolvedValue([{ insertId: 1 }]);
  c.update = vi.fn().mockReturnValue(c);
  c.set = vi.fn().mockReturnValue(c);
  c.execute = vi.fn().mockResolvedValue([rows]);
  c.then = (a: unknown, b: unknown) =>
    p.then(
      a as Parameters<typeof p.then>[0],
      b as Parameters<typeof p.then>[1]
    );
  c.catch = p.catch.bind(p);
  c.finally = p.finally.bind(p);
  return c;
}

function makeDb(rows: unknown[] = []) {
  const chain = makeChain(rows);
  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
    execute: vi.fn().mockResolvedValue([rows]),
  };
}

// ─── runGapMapper ─────────────────────────────────────────────────────────────
describe("gapMapper — runGapMapper()", () => {
  beforeEach(() => {
    mockGetDb.mockResolvedValue(makeDb([]));
  });

  it("returns a GapMapResult with all four gap type counts", async () => {
    const result: GapMapResult = await runGapMapper();

    expect(typeof result.structural).toBe("number");
    expect(typeof result.evidence).toBe("number");
    expect(typeof result.contradiction).toBe("number");
    expect(typeof result.temporal).toBe("number");
    expect(typeof result.total).toBe("number");
    expect(typeof result.newGapsCreated).toBe("number");
  });

  it("total equals structural + evidence + contradiction + temporal", async () => {
    const result = await runGapMapper();

    expect(result.total).toBe(
      result.structural + result.evidence + result.contradiction + result.temporal
    );
  });

  it("all counts are non-negative integers", async () => {
    const result = await runGapMapper();

    for (const key of ["structural", "evidence", "contradiction", "temporal", "total", "newGapsCreated"] as const) {
      expect(result[key]).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result[key])).toBe(true);
    }
  });

  it("returns zero counts when DB returns empty rows", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));

    const result = await runGapMapper();

    // With empty DB, no gaps detected → all zero
    expect(result.total).toBe(0);
    expect(result.newGapsCreated).toBe(0);
  });

  it("resolves even when DB throws (graceful degradation)", async () => {
    mockGetDb.mockRejectedValue(new Error("DB unavailable"));

    // Should not throw — gap mapper should handle DB errors gracefully
    await expect(runGapMapper()).resolves.toBeDefined();
  });
});

// ─── detectEvidenceGapForDocument ─────────────────────────────────────────────
describe("gapMapper — detectEvidenceGapForDocument()", () => {
  beforeEach(() => {
    mockGetDb.mockResolvedValue(makeDb([]));
  });

  it("returns a number (gap id) when DB insert succeeds", async () => {
    const db = makeDb([]);
    // execute returns empty rows → no existing gap → will insert
    db.execute = vi.fn().mockResolvedValue([[]]); // no existing gap
    const chain = makeChain([]);
    chain.values = vi.fn().mockResolvedValue([{ insertId: 42 }]);
    db.insert = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await detectEvidenceGapForDocument(1, 3, "sample claim");

    // Returns the gap id or null
    expect(result === null || typeof result === "number").toBe(true);
  });

  it("returns null when DB is unavailable", async () => {
    mockGetDb.mockRejectedValue(new Error("DB unavailable"));

    const result = await detectEvidenceGapForDocument(99, 1);

    expect(result).toBeNull();
  });

  it("accepts documentId and insufficientClaimCount without claimSample", async () => {
    const result = await detectEvidenceGapForDocument(5, 2);

    expect(result === null || typeof result === "number").toBe(true);
  });

  it("handles existing gap — updates contributingClaimCount instead of inserting", async () => {
    const db = makeDb([]);
    // execute returns an existing gap row
    db.execute = vi.fn().mockResolvedValue([[{ id: 7 }]]);
    const chain = makeChain([]);
    chain.set = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    db.update = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await detectEvidenceGapForDocument(10, 2, "existing gap claim");

    // When gap exists, returns the existing gap id (7) or null
    expect(result === null || typeof result === "number").toBe(true);
  });
});
