/**
 * coordQueueDrainer.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Coord Queue Drainer — drainCoordQueue() and
 * getCoordQueuePendingCount().
 *
 * NOTE: coordQueueDrainer uses getDb() (not getDbOrThrow()), so DB null →
 * graceful fallback (returns DrainerResult with error / returns 0).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mockGetDb }));

import {
  drainCoordQueue,
  getCoordQueuePendingCount,
  type DrainerResult,
} from "./coordQueueDrainer";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeChain(rows: unknown[] = []) {
  const p = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
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

// ─── drainCoordQueue ──────────────────────────────────────────────────────────
describe("coordQueueDrainer — drainCoordQueue()", () => {
  it("returns DrainerResult with error when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const result: DrainerResult = await drainCoordQueue();

    expect(result.itemsProcessed).toBe(0);
    expect(result.errors).toContain("Database unavailable");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns zero-count result when queue is empty", async () => {
    const db = makeDb([]);
    // claimNextBatch returns empty array → no items to process
    const chain = makeChain([]);
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    // update for claiming items — returns empty
    const updateChain = makeChain([]);
    updateChain.set = vi.fn().mockReturnValue(updateChain);
    updateChain.where = vi.fn().mockResolvedValue([{ affectedRows: 0 }]);
    db.update = vi.fn().mockReturnValue(updateChain);
    mockGetDb.mockResolvedValue(db);

    const result = await drainCoordQueue();

    expect(result.itemsProcessed).toBe(0);
    expect(result.itemsSucceeded).toBe(0);
    expect(result.itemsFailed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("DrainerResult has all required fields", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await drainCoordQueue();

    expect(typeof result.itemsProcessed).toBe("number");
    expect(typeof result.itemsSucceeded).toBe("number");
    expect(typeof result.itemsFailed).toBe("number");
    expect(typeof result.itemsSkipped).toBe("number");
    expect(typeof result.durationMs).toBe("number");
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("all counts are non-negative", async () => {
    mockGetDb.mockResolvedValue(null);

    const result = await drainCoordQueue();

    expect(result.itemsProcessed).toBeGreaterThanOrEqual(0);
    expect(result.itemsSucceeded).toBeGreaterThanOrEqual(0);
    expect(result.itemsFailed).toBeGreaterThanOrEqual(0);
    expect(result.itemsSkipped).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── getCoordQueuePendingCount ─────────────────────────────────────────────────
describe("coordQueueDrainer — getCoordQueuePendingCount()", () => {
  it("returns 0 when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const count = await getCoordQueuePendingCount();

    expect(count).toBe(0);
  });

  it("returns 0 when no pending items", async () => {
    const db = makeDb([]);
    const chain = makeChain([{ cnt: 0 }]);
    chain.where = vi.fn().mockResolvedValue([{ cnt: 0 }]);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const count = await getCoordQueuePendingCount();

    expect(count).toBe(0);
  });

  it("returns the count of pending items", async () => {
    const db = makeDb([]);
    const chain = makeChain([{ cnt: 7 }]);
    chain.where = vi.fn().mockResolvedValue([{ cnt: 7 }]);
    chain.from = vi.fn().mockReturnValue(chain);
    db.select = vi.fn().mockReturnValue(chain);
    mockGetDb.mockResolvedValue(db);

    const count = await getCoordQueuePendingCount();

    expect(count).toBe(7);
  });

  it("returns a non-negative integer", async () => {
    mockGetDb.mockResolvedValue(null);

    const count = await getCoordQueuePendingCount();

    expect(count).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(count)).toBe(true);
  });
});
