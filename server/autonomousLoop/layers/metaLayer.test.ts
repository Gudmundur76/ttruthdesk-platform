/**
 * metaLayer.test.ts
 * Unit tests for autonomousLoop/layers/metaLayer.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockEvaluateHealth: vi.fn(),
  mockPublishEvent: vi.fn(),
}));

vi.mock("../../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("../safeModeController", () => ({
  evaluateHealthAndTriggerSafeMode: mocks.mockEvaluateHealth,
}));
vi.mock("../eventBus", () => ({
  publishEvent: mocks.mockPublishEvent,
}));

const makeDb = () => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
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
});
