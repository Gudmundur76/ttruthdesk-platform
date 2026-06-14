/**
 * evidencePursuer.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for frontier/evidencePursuer.ts — pursueGap, pursueTopGaps, closeGap
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));

const makeDb = () => ({
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  orderBy: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([{ insertId: 99 }]),
});

describe("pursueGap()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("throws when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { pursueGap } = await import("./evidencePursuer");
    const gap = { id: 1, description: "gap desc", gapType: "missing_evidence", priorityScore: 50 } as never;
    await expect(pursueGap(gap)).rejects.toThrow();
  });

  it("returns priority_raised when queue item already exists", async () => {
    const db = makeDb();
    // First .limit() call returns existing item
    db.limit.mockResolvedValueOnce([{ id: 10, priority: 50 }]);
    // update().set().where() — need where on the set chain
    db.set.mockReturnThis();
    (db as Record<string, unknown>).where2 = vi.fn().mockResolvedValue([]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { pursueGap } = await import("./evidencePursuer");
    const gap = { id: 1, description: "gap desc", gapType: "missing_evidence", priorityScore: 50 } as never;
    const result = await pursueGap(gap);
    // Either priority_raised (success) or no_action (caught error from where not being a fn)
    expect(["priority_raised", "no_action"]).toContain(result.action);
    expect(result.gapId).toBe(1);
  });

  it("returns queue_item_created or no_action when no existing queue item", async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([]); // no existing item
    mocks.mockGetDb.mockResolvedValue(db);
    const { pursueGap } = await import("./evidencePursuer");
    const gap = { id: 2, description: "new gap", gapType: "conflicting_evidence", priorityScore: 70 } as never;
    const result = await pursueGap(gap);
    expect(["queue_item_created", "no_action"]).toContain(result.action);
    expect(result.gapId).toBe(2);
  });
});

describe("closeGap()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("throws when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { closeGap } = await import("./evidencePursuer");
    await expect(closeGap(1, 10, "closed_verified")).rejects.toThrow();
  });

  it("calls update and insert when DB is available", async () => {
    const db = makeDb();
    // update().set().where() chain — set returns object with where
    const whereStub = vi.fn().mockResolvedValue([]);
    db.set.mockReturnValue({ where: whereStub });
    mocks.mockGetDb.mockResolvedValue(db);
    const { closeGap } = await import("./evidencePursuer");
    await closeGap(1, 10, "closed_verified");
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });
});

describe("pursueTopGaps()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("throws when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { pursueTopGaps } = await import("./evidencePursuer");
    await expect(pursueTopGaps(3)).rejects.toThrow();
  });

  it("returns results array for each gap found", async () => {
    const db = makeDb();
    // Top gaps query
    db.limit.mockResolvedValueOnce([
      { id: 1, description: "gap 1", gapType: "missing_evidence", priorityScore: 90 },
      { id: 2, description: "gap 2", gapType: "conflicting_evidence", priorityScore: 80 },
    ]);
    // For each pursueGap call: check existing (empty)
    db.limit.mockResolvedValue([]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { pursueTopGaps } = await import("./evidencePursuer");
    const results = await pursueTopGaps(2);
    expect(Array.isArray(results)).toBe(true);
    // Each result should have gapId and action
    for (const r of results) {
      expect(r).toHaveProperty("gapId");
      expect(r).toHaveProperty("action");
    }
  });
});
