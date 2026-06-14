/**
 * uncertaintyTracker.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Frontier uncertainty tracker — markStaleGaps(),
 * getFrontierMetrics(), and getGapTimeline().
 *
 * NOTE: getDbOrThrow() calls getDb() and throws if null — so when the DB is
 * unavailable, functions propagate the rejection (no internal catch at that
 * level). Tests that mock DB unavailability must expect rejection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../../server/db", () => ({ getDb: mockGetDb }));

import {
  markStaleGaps,
  getFrontierMetrics,
  getGapTimeline,
  type FrontierMetrics,
  type GapTimeline,
} from "./uncertaintyTracker";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeChain(rows: unknown[] = []) {
  const p = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.leftJoin = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue(rows);
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
    update: vi.fn().mockReturnValue(chain),
    execute: vi.fn().mockResolvedValue([rows]),
  };
}

// ─── markStaleGaps ────────────────────────────────────────────────────────────
describe("uncertaintyTracker — markStaleGaps()", () => {
  it("returns a non-negative integer when DB is available", async () => {
    const db = makeDb([]);
    const chain = makeChain([]);
    // update().set().where() → resolves to [{ affectedRows: 0 }]
    chain.where = vi.fn().mockResolvedValue([{ affectedRows: 0 }]);
    chain.set = vi.fn().mockReturnValue(chain);
    db.update = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const count = await markStaleGaps();

    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 when the DB query catches an error internally", async () => {
    const db = makeDb([]);
    const chain = makeChain([]);
    // Make the where() call throw — caught by the internal try/catch
    chain.where = vi.fn().mockRejectedValue(new Error("query failed"));
    chain.set = vi.fn().mockReturnValue(chain);
    db.update = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const count = await markStaleGaps();

    expect(count).toBe(0);
  });

  it("propagates rejection when DB is unavailable (getDbOrThrow throws)", async () => {
    mockGetDb.mockResolvedValue(null); // getDbOrThrow throws when db is null

    await expect(markStaleGaps()).rejects.toThrow();
  });
});

// ─── getFrontierMetrics ───────────────────────────────────────────────────────
describe("uncertaintyTracker — getFrontierMetrics()", () => {
  beforeEach(() => {
    const db = makeDb([]);
    // execute returns empty arrays for all SQL queries
    db.execute = vi.fn().mockResolvedValue([[]]);
    mockGetDb.mockResolvedValue(db);
  });

  it("returns a FrontierMetrics object with required fields", async () => {
    const metrics: FrontierMetrics = await getFrontierMetrics();

    expect(typeof metrics).toBe("object");
    expect(metrics).not.toBeNull();
    // Correct field names from FrontierMetrics interface
    expect(typeof metrics.totalGapsDetected).toBe("number");
    expect(typeof metrics.openGaps).toBe("number");
    expect(typeof metrics.pursuedGaps).toBe("number");
    expect(typeof metrics.closedVerified).toBe("number");
    expect(typeof metrics.closedResolved).toBe("number");
    expect(typeof metrics.staleGaps).toBe("number");
    expect(typeof metrics.hypothesesQueued).toBe("number");
    expect(typeof metrics.hypothesesVerified).toBe("number");
    expect(typeof metrics.hypothesesRefuted).toBe("number");
  });

  it("all gap counts are non-negative integers", async () => {
    const metrics = await getFrontierMetrics();

    for (const key of [
      "totalGapsDetected",
      "openGaps",
      "pursuedGaps",
      "closedVerified",
      "closedResolved",
      "staleGaps",
      "hypothesesQueued",
      "hypothesesVerified",
      "hypothesesRefuted",
    ] as const) {
      expect(metrics[key]).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(metrics[key])).toBe(true);
    }
  });

  it("returns zero counts when DB returns empty rows", async () => {
    const metrics = await getFrontierMetrics();

    expect(metrics.totalGapsDetected).toBe(0);
    expect(metrics.openGaps).toBe(0);
    expect(metrics.hypothesesQueued).toBe(0);
  });

  it("propagates rejection when DB is unavailable (getDbOrThrow throws)", async () => {
    mockGetDb.mockResolvedValue(null);

    await expect(getFrontierMetrics()).rejects.toThrow();
  });

  it("returns zero-filled metrics when internal query throws (caught by try/catch)", async () => {
    const db = makeDb([]);
    db.execute = vi.fn().mockRejectedValue(new Error("query failed"));
    mockGetDb.mockResolvedValue(db);

    const metrics = await getFrontierMetrics();

    // Internal catch returns zero-filled object
    expect(metrics.totalGapsDetected).toBe(0);
    expect(metrics.openGaps).toBe(0);
  });
});

// ─── getGapTimeline ───────────────────────────────────────────────────────────
describe("uncertaintyTracker — getGapTimeline()", () => {
  it("returns null for a non-existent gap id", async () => {
    const db = makeDb([]);
    const chain = makeChain([]);
    // select().from().where().limit() → empty array (gap not found)
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.where = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await getGapTimeline(99999);

    expect(result).toBeNull();
  });

  it("propagates rejection when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    await expect(getGapTimeline(1)).rejects.toThrow();
  });

  it("returns null when internal query throws", async () => {
    const db = makeDb([]);
    const chain = makeChain([]);
    chain.limit = vi.fn().mockRejectedValue(new Error("query failed"));
    chain.where = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await getGapTimeline(1);

    // getGapTimeline has a try/catch that returns null on error
    expect(result).toBeNull();
  });
});
