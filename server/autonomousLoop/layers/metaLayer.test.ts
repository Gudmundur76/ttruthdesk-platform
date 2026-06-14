/**
 * metaLayer.test.ts
 * Unit tests for autonomousLoop/layers/metaLayer.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockEvaluateHealth: vi.fn(),
  mockPublishEvent: vi.fn(),
  mockSpawnDevTask: vi.fn(),
}));

vi.mock("../../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("../safeModeController", () => ({
  evaluateHealthAndTriggerSafeMode: mocks.mockEvaluateHealth,
}));
vi.mock("../eventBus", () => ({
  publishEvent: mocks.mockPublishEvent,
}));
vi.mock("../../manusOrchestrator", () => ({
  spawnDevTask: mocks.mockSpawnDevTask,
}));

const makeDb = () => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockReturnValue(db);
  db.orderBy.mockReturnValue(db);
  db.limit.mockResolvedValue([]);
  return db;
};

describe("runMetaLayer()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns healthScore=100 and meta_health_check action when DB is null", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    mocks.mockEvaluateHealth.mockResolvedValue(false);
    mocks.mockPublishEvent.mockResolvedValue(undefined);
    const { runMetaLayer } = await import("./metaLayer");
    const result = await runMetaLayer(
      { eventType: "scheduled_tick", payload: {} } as never,
      []
    );
    expect(result.healthScore).toBe(100);
    expect(result.safeModeTriggered).toBe(false);
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("meta_health_check");
  });

  it("returns healthScore=100 when no checks exist in DB", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([]); // no rows
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockEvaluateHealth.mockResolvedValue(false);
    mocks.mockPublishEvent.mockResolvedValue(undefined);
    const { runMetaLayer } = await import("./metaLayer");
    const result = await runMetaLayer(
      { eventType: "scheduled_tick", payload: {} } as never,
      []
    );
    expect(result.healthScore).toBe(100);
    expect(result.actions[0].type).toBe("meta_health_check");
  });

  it("returns healthScore=30 and triggers safe mode when latest check is critical", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([{ severity: "critical" }]);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockEvaluateHealth.mockResolvedValue(true);
    mocks.mockPublishEvent.mockResolvedValue(undefined);
    const { runMetaLayer } = await import("./metaLayer");
    const result = await runMetaLayer(
      { eventType: "scheduled_tick", payload: {} } as never,
      []
    );
    expect(result.healthScore).toBe(30);
    expect(result.safeModeTriggered).toBe(true);
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("meta_safe_mode_triggered");
  });

  it("returns healthScore=70 and meta_health_check when latest check is warning (70 >= 60)", async () => {
    // healthScore=70 from 'warning' severity. 70 >= 60 → meta_health_check (not warning)
    // The warning branch is only triggered for 40 <= score < 60
    const db = makeDb();
    db.limit.mockResolvedValue([{ severity: "warning" }]);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockEvaluateHealth.mockResolvedValue(false);
    mocks.mockPublishEvent.mockResolvedValue(undefined);
    const { runMetaLayer } = await import("./metaLayer");
    const result = await runMetaLayer(
      { eventType: "scheduled_tick", payload: {} } as never,
      []
    );
    expect(result.healthScore).toBe(70);
    const types = result.actions.map((a) => a.type);
    // 70 >= 60 → health_check (not warning)
    expect(types).toContain("meta_health_check");
  });

  it("logs system_health_change event when event type matches", async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([{ severity: "info" }]);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockEvaluateHealth.mockResolvedValue(false);
    mocks.mockPublishEvent.mockResolvedValue(undefined);
    const { runMetaLayer } = await import("./metaLayer");
    const result = await runMetaLayer(
      { eventType: "system_health_change", payload: { score: 100 } } as never,
      []
    );
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("meta_health_change_logged");
  });

  // ── Regression: fix(unknown): autonomous repair [sprint-1] ──────────────────
  // Root cause: when healthScore ≤ 30 and getLatestCriticalCheck() returns null
  // (because the DB mock was missing the .where() chain method), adapterName
  // fell back to "unknown" and spawnDevTask was called with adapterName="unknown",
  // producing a misleading repair prompt targeting a non-existent adapter file.
  // Fix: guard spawnDevTask so it is only called when adapterName !== "unknown".

  it("regression: does NOT call spawnDevTask when no critical check row exists (adapterName would be 'unknown')", async () => {
    // Simulate: health is critical (severity=critical → score=30) but
    // getLatestCriticalCheck returns null (no matching row in the where-filtered query).
    const db = makeDb();
    // getLatestHealthScore call → returns critical severity
    db.limit
      .mockResolvedValueOnce([{ severity: "critical" }]) // first limit() call: health score query
      .mockResolvedValueOnce([]); // second limit() call: critical check query (no row)
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockEvaluateHealth.mockResolvedValue(true);
    mocks.mockPublishEvent.mockResolvedValue(undefined);
    mocks.mockSpawnDevTask.mockResolvedValue(null);

    const { runMetaLayer } = await import("./metaLayer");
    const result = await runMetaLayer(
      { eventType: "scheduled_tick", payload: {} } as never,
      []
    );

    // spawnDevTask must NOT be called when adapterName is "unknown"
    expect(mocks.mockSpawnDevTask).not.toHaveBeenCalled();

    // system_capability_required event IS still published (with adapterName="unknown")
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "system_capability_required",
      expect.objectContaining({ adapterName: "unknown" })
    );

    // meta_dev_repair_spawned action is still pushed (event published, task skipped)
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("meta_dev_repair_spawned");
    const repairAction = result.actions.find(
      (a) => a.type === "meta_dev_repair_spawned"
    );
    expect(repairAction?.description).toContain("unknown");
  });

  it("regression: DOES call spawnDevTask when a critical check row with a real checkType exists", async () => {
    const db = makeDb();
    // getLatestHealthScore → critical
    db.limit
      .mockResolvedValueOnce([{ severity: "critical" }])
      // getLatestCriticalCheck → returns a real adapter name
      .mockResolvedValueOnce([
        { checkType: "openAlex", finding: { error: "timeout" } },
      ]);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockEvaluateHealth.mockResolvedValue(true);
    mocks.mockPublishEvent.mockResolvedValue(undefined);
    mocks.mockSpawnDevTask.mockResolvedValue({ ok: true, manusTaskId: "m-001" });

    const { runMetaLayer } = await import("./metaLayer");
    await runMetaLayer(
      { eventType: "scheduled_tick", payload: {} } as never,
      []
    );

    // spawnDevTask MUST be called with the real adapter name
    expect(mocks.mockSpawnDevTask).toHaveBeenCalledOnce();
    expect(mocks.mockSpawnDevTask).toHaveBeenCalledWith(
      expect.objectContaining({ adapterName: "openAlex" })
    );
  });
});
