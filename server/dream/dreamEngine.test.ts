/**
 * dreamEngine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Dream State engine — checkDreamEligibility(),
 * getDreamStats(), getRecentDreamSessions(), getDreamSession().
 *
 * NOTE: dreamEngine uses getDb() (not getDbOrThrow()), so DB null → graceful
 * fallback (returns { eligible: false } / null / []).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb, mockGetPendingEventCount } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockGetPendingEventCount: vi.fn(),
}));
vi.mock("../../server/db", () => ({ getDb: mockGetDb }));
vi.mock("../../server/autonomousLoop/eventBus", () => ({
  getPendingEventCount: mockGetPendingEventCount,
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  checkDreamEligibility,
  getDreamStats,
  getRecentDreamSessions,
  getDreamSession,
  type DreamEligibility,
} from "./dreamEngine";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeChain(rows: unknown[] = []) {
  const p = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
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

// ─── checkDreamEligibility ────────────────────────────────────────────────────
describe("dreamEngine — checkDreamEligibility()", () => {
  beforeEach(() => {
    mockGetPendingEventCount.mockResolvedValue(0);
    const db = makeDb([]);
    // No previous sessions → first dream
    const chain = makeChain([]);
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);
  });

  it("returns { eligible: false } when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const result: DreamEligibility = await checkDreamEligibility(100);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Database");
  });

  it("returns { eligible: false } when there are pending events", async () => {
    mockGetPendingEventCount.mockResolvedValue(5);

    const result = await checkDreamEligibility(100);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("pending events");
  });

  it("returns { eligible: false } when health score is below minimum", async () => {
    // DREAM_MIN_HEALTH is 40 — use score of 30 to trigger the check
    const result = await checkDreamEligibility(30);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Health score");
  });

  it("returns { eligible: true } when all conditions met and no previous sessions", async () => {
    const result = await checkDreamEligibility(100);

    expect(result.eligible).toBe(true);
    expect(result.reason).toContain("first dream");
  });

  it("returns { eligible: true } when cooldown has passed", async () => {
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    const db = makeDb([]);
    const chain = makeChain([{ id: 1, startedAt: longAgo }]);
    chain.limit = vi.fn().mockResolvedValue([{ id: 1, startedAt: longAgo }]);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await checkDreamEligibility(100);

    expect(result.eligible).toBe(true);
    expect(result.lastSessionId).toBe(1);
  });

  it("returns { eligible: false } when within cooldown period", async () => {
    const recentSession = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    const db = makeDb([]);
    const chain = makeChain([{ id: 2, startedAt: recentSession }]);
    chain.limit = vi.fn().mockResolvedValue([{ id: 2, startedAt: recentSession }]);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await checkDreamEligibility(100);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Cooldown");
  });
});

// ─── getDreamStats ────────────────────────────────────────────────────────────
describe("dreamEngine — getDreamStats()", () => {
  it("returns null when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await getDreamStats();

    expect(result).toBeNull();
  });

  it("returns null when no completed sessions exist", async () => {
    const db = makeDb([]);
    db.execute = vi.fn().mockResolvedValue([[]]); // empty result
    mockGetDb.mockResolvedValue(db);

    const result = await getDreamStats();

    expect(result).toBeNull();
  });

  it("returns stats object with correct fields when sessions exist", async () => {
    const db = makeDb([]);
    db.execute = vi.fn().mockResolvedValue([[{
      totalSessions: 5,
      totalPatterns: 42,
      totalHypotheses: 10,
      totalRecalibrations: 3,
      totalSimulations: 7,
      avgDurationMs: 12000,
      lastSessionAt: new Date().toISOString(),
    }]]);
    mockGetDb.mockResolvedValue(db);

    const result = await getDreamStats();

    expect(result).not.toBeNull();
    expect(result!.totalSessions).toBe(5);
    expect(result!.totalPatterns).toBe(42);
    expect(result!.totalHypotheses).toBe(10);
    expect(typeof result!.avgDurationMs).toBe("number");
  });
});

// ─── getRecentDreamSessions ───────────────────────────────────────────────────
describe("dreamEngine — getRecentDreamSessions()", () => {
  it("returns empty array when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await getRecentDreamSessions();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when no sessions exist", async () => {
    const db = makeDb([]);
    const chain = makeChain([]);
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await getRecentDreamSessions(20);

    expect(result).toHaveLength(0);
  });
});

// ─── getDreamSession ──────────────────────────────────────────────────────────
describe("dreamEngine — getDreamSession()", () => {
  it("returns null when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await getDreamSession(1);

    expect(result).toBeNull();
  });

  it("returns null for non-existent session id", async () => {
    const db = makeDb([]);
    const chain = makeChain([]);
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const result = await getDreamSession(99999);

    expect(result).toBeNull();
  });
});
