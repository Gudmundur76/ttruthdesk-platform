/**
 * orchestratorTickJob.test.ts
 * Unit tests for server/orchestratorTickJob.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockRunOrchestratorTick: vi.fn(),
  mockSpawnVerticalTask: vi.fn(),
  mockGetDb: vi.fn(),
}));

vi.mock("./manusOrchestrator", () => ({
  runOrchestratorTick: mocks.mockRunOrchestratorTick,
  spawnVerticalTask: mocks.mockSpawnVerticalTask,
}));
vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

const makeDb = () => {
  const db: Record<string, ReturnType<typeof vi.fn>> = {};
  // All chained methods return db itself; groupBy resolves (it's the terminal in getRunning/getPending)
  for (const method of ["select", "from", "where", "orderBy", "limit"]) {
    db[method] = vi.fn().mockReturnValue(db);
  }
  // groupBy is terminal in getRunningTasksByVertical and getPendingQueueDepthByVertical
  db.groupBy = vi.fn().mockResolvedValue([]);
  // Make db itself thenable so `await db.select(...).from(...).where(...).groupBy(...)` works
  return db;
};

type ReqLike = { headers?: Record<string, string>; url?: string };
type ResLike = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

const makeReqRes = (): { req: ReqLike; res: ResLike } => ({
  req: { headers: {}, url: "/api/scheduled/orchestrator-tick" },
  res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() },
});

describe("orchestratorTickHandler()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockGetDb.mockResolvedValue(makeDb());
    mocks.mockRunOrchestratorTick.mockResolvedValue({
      checked: 5,
      stalled: 1,
      synced: 1,
      errors: 0,
    });
    mocks.mockSpawnVerticalTask.mockResolvedValue({ ok: true, taskId: "task-123" });
  });

  it("returns 200 with ok:true and orchestratorTick report on success", async () => {
    const { orchestratorTickHandler } = await import("./orchestratorTickJob");
    const { req, res } = makeReqRes();
    await orchestratorTickHandler(req as never, res as never);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      orchestratorTick: expect.objectContaining({ checked: 5, stalled: 1 }),
    }));
  });

  it("returns 500 when runOrchestratorTick throws", async () => {
    mocks.mockRunOrchestratorTick.mockRejectedValue(new Error("Orchestrator failed"));
    const { orchestratorTickHandler } = await import("./orchestratorTickJob");
    const { req, res } = makeReqRes();
    await orchestratorTickHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("includes totalSpawned and totalSkipped in response", async () => {
    const { orchestratorTickHandler } = await import("./orchestratorTickJob");
    const { req, res } = makeReqRes();
    await orchestratorTickHandler(req as never, res as never);
    const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
    expect(jsonArg).toHaveProperty("totalSpawned");
    expect(jsonArg).toHaveProperty("totalSkipped");
  });
});
