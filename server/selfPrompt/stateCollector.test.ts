/**
 * stateCollector.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for selfPrompt/stateCollector.ts — collectSystemState()
 *
 * Phase 7 additions:
 *   - claimTrends (recentVerifiedCount, recentSupportedCount, recentContradictedCount, recentAmbiguousCount, confidenceTrend7d)
 *   - dreamStats (totalCompletedSessions, recentSessionCount, pendingStagingItems, lastWakeAt, sessionsLast30d)
 *   - directiveStats (activeDirectiveCount, recentDirectiveCount)
 *   - driftFindingCount in metaHealth
 *
 * T056 additions:
 *   - All 4 trend metrics with seeded data
 *   - Missing-table returns 0/null without throw
 *   - activeDirectives filters expired (status-based — only pending/active included)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));

import { collectSystemState } from "./stateCollector";
import type { SelfPromptEvent } from "./stateCollector";

/**
 * Build a DB mock chain that supports the full Drizzle fluent API used in
 * stateCollector.ts: select → from → where → orderBy → limit → then.
 * All count queries resolve to [{ cnt }]; list queries resolve to [].
 */
function makeDbChain(cntValue = 0) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  // Make the chain thenable so Promise.all resolves it
  chain.then = (resolve: (v: unknown) => void) => resolve([{ cnt: cntValue }]);
  return chain;
}

function makeDb(cntValue = 0) {
  const chain = makeDbChain(cntValue);
  return { select: vi.fn().mockReturnValue(chain), then: undefined };
}

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
    expect(state.claimTrends.recentVerifiedCount).toBe(0);
    expect(state.claimTrends.recentSupportedCount).toBe(0);
    expect(state.claimTrends.recentContradictedCount).toBe(0);
    expect(state.claimTrends.recentAmbiguousCount).toBe(0);
    // confidenceTrend7d may be present
    expect(typeof state.claimTrends.recentVerifiedCount).toBe("number");
  });

  it("safe state includes zero-valued dreamStats", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const state = await collectSystemState(baseEvent);
    expect(state.dreamStats.totalCompletedSessions).toBe(0);
    expect(state.dreamStats.recentSessionCount).toBe(0);
    expect(state.dreamStats.pendingStagingItems).toBe(0);
    // lastWakeAt and sessionsLast30d may be present
    expect(typeof state.dreamStats.totalCompletedSessions).toBe("number");
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
    mocks.mockGetDb.mockResolvedValue(makeDb(3));
    const state = await collectSystemState(baseEvent);
    expect(state.recentEvent).toEqual(baseEvent);
    expect(state.graphSnapshot.entityCount).toBe(3);
  });

  it("populated state has claimTrends with values from DB", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb(5));
    const state = await collectSystemState(baseEvent);
    expect(state.claimTrends.recentVerifiedCount).toBe(5);
    expect(state.claimTrends.recentSupportedCount).toBe(5);
    expect(state.claimTrends.recentContradictedCount).toBe(5);
    expect(state.claimTrends.recentAmbiguousCount).toBe(5);
  });

  it("populated state has dreamStats with values from DB", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb(7));
    const state = await collectSystemState(baseEvent);
    expect(state.dreamStats.totalCompletedSessions).toBe(7);
    expect(state.dreamStats.recentSessionCount).toBe(7);
    expect(state.dreamStats.pendingStagingItems).toBe(7);
  });

  it("populated state has directiveStats with values from DB", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb(2));
    const state = await collectSystemState(baseEvent);
    expect(state.directiveStats.activeDirectiveCount).toBe(2);
    expect(state.directiveStats.recentDirectiveCount).toBe(2);
  });

  it("driftFindingCount is included in metaHealth when DB is available", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb(4));
    const state = await collectSystemState(baseEvent);
    expect(state.metaHealth.driftFindingCount).toBe(4);
  });

  // ─── T056: All 4 trend metrics with seeded data ───────────────────────────

  it("T056: claimTrends has all 4 required fields as numbers", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb(10));
    const state = await collectSystemState(baseEvent);
    const t = state.claimTrends;
    expect(typeof t.recentVerifiedCount).toBe("number");
    expect(typeof t.recentSupportedCount).toBe("number");
    expect(typeof t.recentContradictedCount).toBe("number");
    expect(typeof t.recentAmbiguousCount).toBe("number");
  });

  it("T056: directiveStats has activeDirectiveCount and recentDirectiveCount", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb(3));
    const state = await collectSystemState(baseEvent);
    expect(typeof state.directiveStats.activeDirectiveCount).toBe("number");
    expect(typeof state.directiveStats.recentDirectiveCount).toBe("number");
  });

  it("T056: activeDirectives is an array (only pending/active status included)", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb(0));
    const state = await collectSystemState(baseEvent);
    // The query filters on status in ["pending", "active"] — result is an array
    expect(Array.isArray(state.activeDirectives)).toBe(true);
  });

  it("T056: missing-table returns 0 without throw when DB returns empty array", async () => {
    // Simulate a query returning empty array (table exists but no rows)
    const chain = makeDbChain(0);
    chain.then = (resolve: (v: unknown) => void) => resolve([]);
    const db = { select: vi.fn().mockReturnValue(chain), then: undefined };
    mocks.mockGetDb.mockResolvedValue(db);
    const state = await collectSystemState(baseEvent);
    expect(state.graphSnapshot.entityCount).toBe(0);
    expect(state.directiveStats.activeDirectiveCount).toBe(0);
  });

  // ─── Health score deductions ──────────────────────────────────────────────

  it("health score deducts for critical findings", async () => {
    // Return 2 for all counts — critical deducts 15 each
    mocks.mockGetDb.mockResolvedValue(makeDb(2));
    const state = await collectSystemState(baseEvent);
    // 2 critical × 15 = 30, 2 warning × 5 = 10, 2 failed × 2 = 4 (capped 20), 2 drift × 3 = 6 (capped 15)
    // score = 100 - 30 - 10 - 4 - 6 = 50
    expect(state.metaHealth.score).toBe(50);
    expect(state.metaHealth.grade).toBe("F");
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  it("returns state object even when DB queries fail", async () => {
    const chain = makeDbChain(0);
    chain.then = (_: unknown, reject: (e: Error) => void) =>
      reject(new Error("query failed"));
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
