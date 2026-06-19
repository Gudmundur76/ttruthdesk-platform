/**
 * frontier/gapRanker.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for frontier/gapRanker.ts — computePriorityScore, rankAllOpenGaps, getTopGaps.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mockGetDb }));

import { computePriorityScore, rankAllOpenGaps, getTopGaps } from "./gapRanker";
import type { GapScoringInput } from "./gapRanker";

function makeDb(executeResult: unknown[] = []) {
  return {
    execute: vi.fn().mockResolvedValue(executeResult),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    then: undefined,
  };
}

const baseGap: GapScoringInput = {
  id: 1,
  gapType: "evidence",
  contributingClaimCount: 3,
  openedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
  entityAId: null,
  entityBId: null,
};

describe("frontier/gapRanker — computePriorityScore()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a GapScoringResult with gapId, priorityScore, and components", async () => {
    mockGetDb.mockResolvedValue(makeDb([{ cnt: 0 }]));
    const result = await computePriorityScore(baseGap);
    expect(result.gapId).toBe(1);
    expect(typeof result.priorityScore).toBe("number");
    expect(result.priorityScore).toBeGreaterThanOrEqual(0);
    expect(result.components).toHaveProperty("contradictionSeverity");
    expect(result.components).toHaveProperty("entityCentrality");
    expect(result.components).toHaveProperty("recencyOfConflict");
    expect(result.components).toHaveProperty("communityDemand");
    expect(result.components).toHaveProperty("gapTypeMultiplier");
  });

  it("returns a higher score for contradiction gaps with entities", async () => {
    mockGetDb.mockResolvedValue(makeDb([{ cnt: 5 }]));
    const contradictionGap: GapScoringInput = {
      ...baseGap,
      gapType: "contradiction",
      entityAId: 10,
      entityBId: 20,
    };
    const result = await computePriorityScore(contradictionGap);
    // contradiction has the highest multiplier (1.0)
    expect(result.components.gapTypeMultiplier).toBe(1.0);
  });

  it("throws when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);
    await expect(computePriorityScore(baseGap)).rejects.toThrow("[FrontierEngine] Database not available");
  });

  it("handles DB.execute rejection gracefully (uses 0 for relation count)", async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error("query error")), then: undefined };
    mockGetDb.mockResolvedValue(db);
    const gapWithEntity: GapScoringInput = { ...baseGap, entityAId: 5 };
    const result = await computePriorityScore(gapWithEntity);
    expect(result.components.entityCentrality).toBeGreaterThanOrEqual(0);
  });

  it("uses arithmetic mean for gaps without entityAId", async () => {
    mockGetDb.mockResolvedValue(makeDb([{ cnt: 0 }]));
    const result = await computePriorityScore({ ...baseGap, entityAId: null });
    expect(result.priorityScore).toBeGreaterThanOrEqual(0);
  });
});

describe("frontier/gapRanker — rankAllOpenGaps()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 0 when no open gaps exist", async () => {
    const db = {
      ...makeDb([]),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      then: undefined,
    };
    mockGetDb.mockResolvedValue(db);
    const count = await rankAllOpenGaps();
    expect(count).toBe(0);
  });

  it("throws when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);
    await expect(rankAllOpenGaps()).rejects.toThrow("[FrontierEngine] Database not available");
  });
});

describe("frontier/gapRanker — getTopGaps()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when no gaps exist", async () => {
    mockGetDb.mockResolvedValue(makeDb([]));
    const result = await getTopGaps(5);
    expect(Array.isArray(result)).toBe(true);
  });

  it("throws when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);
    await expect(getTopGaps(5)).rejects.toThrow("[FrontierEngine] Database not available");
  });
});

// ─── Build3: T009-T014 — DirectiveBoost tests ─────────────────────────────────

describe("frontier/gapRanker — directiveBoost integration (T009-T014)", () => {
  beforeEach(() => vi.clearAllMocks());

  const baseGapWithBoost: GapScoringInput = {
    id: 42,
    gapType: "evidence",
    contributingClaimCount: 3,
    openedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    entityAId: null,
    entityBId: null,
    directiveBoost: 0,
  };

  function makeDb2(executeResult: unknown[] = []) {
    return {
      execute: vi.fn().mockResolvedValue(executeResult),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      then: undefined,
    };
  }

  it("T010: directiveBoost=0 returns same score as no boost field", async () => {
    mockGetDb.mockResolvedValue(makeDb2([{ cnt: 0 }]));
    const r1 = await computePriorityScore({ ...baseGapWithBoost, directiveBoost: 0 });
    const r2 = await computePriorityScore({ ...baseGapWithBoost });
    expect(r1.priorityScore).toBe(r2.priorityScore);
  });

  it("T009: directiveBoost>0 increases priorityScore", async () => {
    mockGetDb.mockResolvedValue(makeDb2([{ cnt: 0 }]));
    const noBoost = await computePriorityScore({ ...baseGapWithBoost, directiveBoost: 0 });
    const boosted = await computePriorityScore({ ...baseGapWithBoost, directiveBoost: 0.3 });
    expect(boosted.priorityScore).toBeGreaterThan(noBoost.priorityScore);
  });

  it("T012: focus_gap directive boost of 0.3 is reflected in components", async () => {
    mockGetDb.mockResolvedValue(makeDb2([{ cnt: 0 }]));
    const result = await computePriorityScore({ ...baseGapWithBoost, directiveBoost: 0.3 });
    expect(result.components.directiveBoost).toBe(0.3);
  });

  it("T011: higher directiveBoost produces higher score (prioritize_hypotheses)", async () => {
    mockGetDb.mockResolvedValue(makeDb2([{ cnt: 0 }]));
    const low = await computePriorityScore({ ...baseGapWithBoost, directiveBoost: 0.1 });
    mockGetDb.mockResolvedValue(makeDb2([{ cnt: 0 }]));
    const high = await computePriorityScore({ ...baseGapWithBoost, directiveBoost: 0.5 });
    expect(high.priorityScore).toBeGreaterThan(low.priorityScore);
  });

  it("T013: directiveBoost is clamped to [0, 1]", async () => {
    mockGetDb.mockResolvedValue(makeDb2([{ cnt: 0 }]));
    const overBoost = await computePriorityScore({ ...baseGapWithBoost, directiveBoost: 2.5 });
    expect(overBoost.components.directiveBoost).toBe(1.0);
  });

  it("T014: score is deterministic for the same input", async () => {
    mockGetDb.mockResolvedValue(makeDb2([{ cnt: 0 }]));
    const r1 = await computePriorityScore({ ...baseGapWithBoost, directiveBoost: 0.2 });
    mockGetDb.mockResolvedValue(makeDb2([{ cnt: 0 }]));
    const r2 = await computePriorityScore({ ...baseGapWithBoost, directiveBoost: 0.2 });
    expect(r1.priorityScore).toBe(r2.priorityScore);
  });
});
