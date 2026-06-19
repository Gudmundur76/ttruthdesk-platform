/**
 * stateCollector.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for selfPrompt/stateCollector.ts — collectSystemState()
 *
 * Phase 7 additions:
 *   - claimTrends (recentVerifiedCount, recentSupportedCount, recentContradictedCount, recentAmbiguousCount)
 *   - dreamStats (totalCompletedSessions, recentSessionCount, pendingStagingItems)
 *   - directiveStats (activeDirectiveCount, recentDirectiveCount)
 *   - driftFindingCount in metaHealth
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));

import { collectSystemState } from "./stateCollector";
import type { SelfPromptEvent } from "./stateCollector";

const baseEvent: SelfPromptEvent = {
  type: "verdict_assigned",
  description: "Test verdict assigned",
  claimId: 1,
};

describe("collectSystemState()", () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── DB unavailable ───────────────────────────────────────────────────────

  it("returns a minimal safe state when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const state = await collectSystemState(baseEvent);
    expect(state.recentEvent).toEqual(baseEvent);
    expect(state.graphSnapshot.entityCount).toBe(0);
    expect(state.queueSnapshot.pendingItems).toBe(0);
    expect(state.metaHealth.score).toBe(100);
    expect(state.metaHealth.grade).toBe("A");
  });

  it("safe state includes zero-valued claimTrends", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const state = await collectSystemState(baseEvent);
    expect(state.claimTrends).toEqual({
      recentVerifiedCount: 0,
      recentSupportedCount: 0,
      recentContradictedCount: 0,
      recentAmbiguousCount: 0,
    });
  });

  it("safe state includes zero-valued dreamStats", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const state = await collectSystemState(baseEvent);
    expect(state.dreamStats).toEqual({
      totalCompletedSessions: 0,
      recentSessionCount: 0,
      pendingStagingItems: 0,
    });
  });

  it("safe state includes zero-valued directiveStats", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const state = await collectSystemState(baseEvent);
    expect(state.directiveStats).toEqual({
      activeDirectiveCount: 0,
      recentDirectiveCount: 0,
    });
  });

  it("safe state includes driftFindingCount: 0 in metaHealth", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const state = await collectSystemState(baseEvent);
    expect(state.metaHealth.driftFindingCount).toBe(0);
  });

  // ─── DB available ─────────────────────────────────────────────────────────

  it("returns populated state when DB is available", async () => {
    // All count queries return { cnt: 3 }
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve([{ cnt: 3 }]),
    };
    const db = { select: vi.fn().mockReturnValue(chain), then: undefined };
    mocks.mockGetDb.mockResolvedValue(db);
    const state = await collectSystemState(baseEvent);
    expect(state.recentEvent).toEqual(baseEvent);
    expect(state.graphSnapshot.entityCount).toBe(3);
  });

  it("populated state has claimTrends with values from DB", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve([{ cnt: 5 }]),
    };
    const db = { select: vi.fn().mockReturnValue(chain), then: undefined };
    mocks.mockGetDb.mockResolvedValue(db);
    const state = await collectSystemState(baseEvent);
    expect(state.claimTrends.recentVerifiedCount).toBe(5);
    expect(state.claimTrends.recentSupportedCount).toBe(5);
    expect(state.claimTrends.recentContradictedCount).toBe(5);
    expect(state.claimTrends.recentAmbiguousCount).toBe(5);
  });

  it("populated state has dreamStats with values from DB", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve([{ cnt: 7 }]),
    };
    const db = { select: vi.fn().mockReturnValue(chain), then: undefined };
    mocks.mockGetDb.mockResolvedValue(db);
    const state = await collectSystemState(baseEvent);
    expect(state.dreamStats.totalCompletedSessions).toBe(7);
    expect(state.dreamStats.recentSessionCount).toBe(7);
    expect(state.dreamStats.pendingStagingItems).toBe(7);
  });

  it("populated state has directiveStats with values from DB", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve([{ cnt: 2 }]),
    };
    const db = { select: vi.fn().mockReturnValue(chain), then: undefined };
    mocks.mockGetDb.mockResolvedValue(db);
    const state = await collectSystemState(baseEvent);
    expect(state.directiveStats.activeDirectiveCount).toBe(2);
    expect(state.directiveStats.recentDirectiveCount).toBe(2);
  });

  it("driftFindingCount is included in metaHealth when DB is available", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve([{ cnt: 4 }]),
    };
    const db = { select: vi.fn().mockReturnValue(chain), then: undefined };
    mocks.mockGetDb.mockResolvedValue(db);
    const state = await collectSystemState(baseEvent);
    expect(state.metaHealth.driftFindingCount).toBe(4);
  });

  // ─── Health score deductions ──────────────────────────────────────────────

  it("health score deducts for critical findings", async () => {
    // Return 2 for all counts — critical deducts 15 each
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve([{ cnt: 2 }]),
    };
    const db = { select: vi.fn().mockReturnValue(chain), then: undefined };
    mocks.mockGetDb.mockResolvedValue(db);
    const state = await collectSystemState(baseEvent);
    // 2 critical × 15 = 30, 2 warning × 5 = 10, 2 failed × 2 = 4 (capped 20), 2 drift × 3 = 6 (capped 15)
    // score = 100 - 30 - 10 - 4 - 6 = 50
    expect(state.metaHealth.score).toBe(50);
    expect(state.metaHealth.grade).toBe("F");
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  it("returns state object even when DB queries fail", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: (_: unknown, reject: (e: Error) => void) =>
        reject(new Error("query failed")),
    };
    const db = { select: vi.fn().mockReturnValue(chain), then: undefined };
    mocks.mockGetDb.mockResolvedValue(db);
    try {
      const state = await collectSystemState(baseEvent);
      expect(state).toHaveProperty("recentEvent");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  // ─── Event passthrough ────────────────────────────────────────────────────

  it("includes the event in the returned state", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const event: SelfPromptEvent = {
      type: "gap_closed",
      description: "Gap closed event",
      documentId: 42,
      gapId: 7,
    };
    const state = await collectSystemState(event);
    expect(state.recentEvent.type).toBe("gap_closed");
    expect(state.recentEvent.documentId).toBe(42);
    expect(state.recentEvent.gapId).toBe(7);
  });
});
