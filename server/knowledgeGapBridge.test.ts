/**
 * Phase 128 — Knowledge Gap Bridge
 * RED → GREEN → REFACTOR
 *
 * Tests for knowledgeGapBridge.ts:
 *   - bridgeOpenGapsToCoordQueue: reads open gaps, inserts coordQueue items,
 *     marks gaps as "pursued", updates pursuitQueueId
 *   - getGapBridgeStats: returns open/pursued/closed counts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({ getDb: vi.fn() }));
const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("./logger", () => ({
  logger: vi.fn().mockReturnValue(mockLog),
}));
vi.mock("../drizzle/schema", () => ({
  knowledgeGaps: { id: "id", status: "status", gapType: "gapType", description: "description" },
  coordQueue: { id: "id", vertical: "vertical", source: "source", priority: "priority" },
}));

import { getDb } from "./db";
import {
  bridgeOpenGapsToCoordQueue,
  getGapBridgeStats,
} from "./knowledgeGapBridge";

const mockGetDb = vi.mocked(getDb);

// ─── Mock DB builder ──────────────────────────────────────────────────────────
function makeSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockReturnThis(),
  };
}

function makeInsertChain(insertedId = 99) {
  return {
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([{ insertId: insertedId }]),
  };
}

function makeUpdateChain() {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
  };
}

function makeMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
}

// ─── bridgeOpenGapsToCoordQueue ───────────────────────────────────────────────
describe("bridgeOpenGapsToCoordQueue", () => {
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockDb = makeMockDb();
    mockGetDb.mockResolvedValue(mockDb as never);
  });

  it("returns zero stats when no open gaps exist", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([]));

    const result = await bridgeOpenGapsToCoordQueue();

    expect(result.gapsFound).toBe(0);
    expect(result.gapsBridged).toBe(0);
    expect(result.gapsFailed).toBe(0);
  });

  it("bridges each open gap to a coordQueue item", async () => {
    const openGaps = [
      {
        id: 1,
        gapType: "evidence",
        description: "No evidence for BRCA1 phosphorylation",
        priorityScore: 0.8,
        entityAId: 10,
        entityBId: null,
      },
      {
        id: 2,
        gapType: "structural",
        description: "Protein X has no graph relations",
        priorityScore: 0.5,
        entityAId: null,
        entityBId: null,
      },
    ];

    mockDb.select.mockReturnValueOnce(makeSelectChain(openGaps));
    // Two inserts + two updates
    mockDb.insert
      .mockReturnValueOnce(makeInsertChain(101))
      .mockReturnValueOnce(makeInsertChain(102));
    mockDb.update
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeUpdateChain());

    const result = await bridgeOpenGapsToCoordQueue();

    expect(result.gapsFound).toBe(2);
    expect(result.gapsBridged).toBe(2);
    expect(result.gapsFailed).toBe(0);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });

  it("marks gap as pursued with the new coordQueue item id", async () => {
    const openGaps = [
      {
        id: 5,
        gapType: "contradiction",
        description: "Contradicting claims about TP53",
        priorityScore: 0.9,
        entityAId: 20,
        entityBId: 21,
      },
    ];

    mockDb.select.mockReturnValueOnce(makeSelectChain(openGaps));
    mockDb.insert.mockReturnValueOnce(makeInsertChain(200));
    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValueOnce(updateChain);

    await bridgeOpenGapsToCoordQueue();

    // The update should set status="pursued" and pursuitQueueId=200
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pursued", pursuitQueueId: 200 })
    );
  });

  it("counts failed gaps when insert throws", async () => {
    const openGaps = [
      {
        id: 7,
        gapType: "temporal",
        description: "Stale temporal claim",
        priorityScore: 0.3,
        entityAId: null,
        entityBId: null,
      },
    ];

    mockDb.select.mockReturnValueOnce(makeSelectChain(openGaps));
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockImplementation(() => { throw new Error("DB insert failed"); }),
    });

    const result = await bridgeOpenGapsToCoordQueue();

    expect(result.gapsFound).toBe(1);
    expect(result.gapsBridged).toBe(0);
    expect(result.gapsFailed).toBe(1);
  });

  it("returns early with zero stats when db is unavailable", async () => {
    mockGetDb.mockResolvedValue(null as never);

    const result = await bridgeOpenGapsToCoordQueue();

    expect(result.gapsFound).toBe(0);
    expect(result.gapsBridged).toBe(0);
  });

  it("uses gap priorityScore to set coordQueue priority", async () => {
    const openGaps = [
      {
        id: 3,
        gapType: "hypothesis",
        description: "High-priority hypothesis",
        priorityScore: 0.95,
        entityAId: null,
        entityBId: null,
      },
    ];

    mockDb.select.mockReturnValueOnce(makeSelectChain(openGaps));
    const insertChain = makeInsertChain(300);
    mockDb.insert.mockReturnValueOnce(insertChain);
    mockDb.update.mockReturnValueOnce(makeUpdateChain());

    await bridgeOpenGapsToCoordQueue();

    // High priorityScore (>0.8) should map to priority=10 (high)
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 10 })
    );
  });

  it("sets source to 'knowledge_gap' on coordQueue items", async () => {
    const openGaps = [
      {
        id: 4,
        gapType: "evidence",
        description: "Evidence gap",
        priorityScore: 0.4,
        entityAId: null,
        entityBId: null,
      },
    ];

    mockDb.select.mockReturnValueOnce(makeSelectChain(openGaps));
    const insertChain = makeInsertChain(400);
    mockDb.insert.mockReturnValueOnce(insertChain);
    mockDb.update.mockReturnValueOnce(makeUpdateChain());

    await bridgeOpenGapsToCoordQueue();

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ source: "knowledge_gap" })
    );
  });
});

// ─── getGapBridgeStats ────────────────────────────────────────────────────────
describe("getGapBridgeStats", () => {
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockDb = makeMockDb();
    mockGetDb.mockResolvedValue(mockDb as never);
  });

  it("returns open, pursued, and closed counts", async () => {
    function makeCountChain(rows: unknown[]) {
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(rows),
      };
    }

    mockDb.select
      .mockReturnValueOnce(makeCountChain(new Array(12).fill({ id: 1 })))  // open
      .mockReturnValueOnce(makeCountChain(new Array(5).fill({ id: 2 })))   // pursued
      .mockReturnValueOnce(makeCountChain(new Array(3).fill({ id: 3 })));  // closed

    const stats = await getGapBridgeStats();

    expect(stats.openGaps).toBe(12);
    expect(stats.pursuedGaps).toBe(5);
    expect(stats.closedGaps).toBe(3);
  });

  it("returns zeros when db is unavailable", async () => {
    mockGetDb.mockResolvedValue(null as never);

    const stats = await getGapBridgeStats();

    expect(stats.openGaps).toBe(0);
    expect(stats.pursuedGaps).toBe(0);
    expect(stats.closedGaps).toBe(0);
  });
});
