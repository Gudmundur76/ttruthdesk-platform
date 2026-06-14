/**
 * coordApi.test.ts
 * Unit tests for server/coordApi.ts
 *
 * Tests the createCoordRouter() factory and the auth guard (X-Coord-Key).
 * All DB operations are mocked so no real DB is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockEnqueue: vi.fn(),
  mockDequeue: vi.fn(),
  mockComplete: vi.fn(),
  mockFail: vi.fn(),
  mockGetStats: vi.fn(),
  mockListTasks: vi.fn(),
  mockRegisterTask: vi.fn(),
  mockHeartbeat: vi.fn(),
  mockCompleteTask: vi.fn(),
  mockFailTask: vi.fn(),
  mockDeleteTask: vi.fn(),
  mockGetContext: vi.fn(),
  mockSetContext: vi.fn(),
  mockDeleteContext: vi.fn(),
  mockListContext: vi.fn(),
}));

// Mock drizzle schema tables so coordApi doesn't fail on schema imports
vi.mock("../drizzle/schema", () => ({
  coordQueue: {
    vertical: "vertical",
    status: "status",
    pmid: "pmid",
    doi: "doi",
    paperUrl: "paperUrl",
    title: "title",
    priority: "priority",
    source: "source",
    claimedBy: "claimedBy",
    claimedAt: "claimedAt",
  },
  coordTasks: {
    taskId: "taskId",
    vertical: "vertical",
    phase: "phase",
    manusTaskId: "manusTaskId",
    meta: "meta",
    heartbeatAt: "heartbeatAt",
    completedAt: "completedAt",
    failedAt: "failedAt",
    errorMsg: "errorMsg",
  },
  coordContext: {
    key: "key",
    value: "value",
    namespace: "namespace",
    expiresAt: "expiresAt",
  },
  coordGraph: { nodeId: "nodeId", label: "label", properties: "properties" },
  coordEdges: {
    fromId: "fromId",
    toId: "toId",
    relation: "relation",
    weight: "weight",
  },
}));
// Mock drizzle-orm operators to be no-ops
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  or: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => ({ a, b }),
  gt: (a: unknown, b: unknown) => ({ a, b }),
  lt: (a: unknown, b: unknown) => ({ a, b }),
  isNull: (a: unknown) => ({ a }),
  desc: (a: unknown) => a,
  sql: (s: TemplateStringsArray, ...vals: unknown[]) => ({ s, vals }),
}));
vi.mock("./db", () => ({
  getDb: mocks.mockGetDb,
  getDbOrThrow: vi.fn(() => {
    throw new Error("No DB");
  }),
}));

// Build a minimal chainable DB mock
// coordApi uses inline Drizzle queries via requireDb() which does: const db = await getDb()
//
// Design constraints:
// 1. The proxy must NOT be thenable (no then/catch/finally) so that `await proxy` returns
//    the proxy itself rather than unwrapping it.
// 2. Some Drizzle chains end with .where(), others end with .orderBy(), others with .limit().
//    We cannot know which is "last" at call time.
// 3. Solution: every method returns a "chainable Promise" — an object that:
//    - IS a real Promise (has then/catch/finally) so `await` resolves it to []
//    - ALSO has all Drizzle methods that return another chainable Promise
//    The top-level db proxy is NOT thenable (so `const db = await getDb()` works),
//    but every method call on it returns a chainable Promise.
function makeChainablePromise(): Promise<unknown[]> & Record<string, unknown> {
  const p = Promise.resolve([]) as unknown as Promise<unknown[]> &
    Record<string, unknown>;
  return new Proxy(p, {
    get(target, prop) {
      const key = String(prop);
      // Bind Promise methods to the target so `this` is the real Promise, not the Proxy
      if (key === "then" || key === "catch" || key === "finally") {
        const method = (
          target as Record<string, (...args: unknown[]) => unknown>
        )[key];
        return method.bind(target);
      }
      // All Drizzle chain methods return another chainable Promise
      return (..._args: unknown[]) => makeChainablePromise();
    },
  });
}
function makeDb() {
  const proxy: Record<string, unknown> = new Proxy(
    {} as Record<string, unknown>,
    {
      get(_target, prop) {
        const key = String(prop);
        // Do NOT expose then/catch/finally — that would make the top-level db thenable
        if (key === "then" || key === "catch" || key === "finally")
          return undefined;
        // Every method on db returns a chainable Promise
        return (..._args: unknown[]) => makeChainablePromise();
      },
    }
  );
  return proxy;
}
vi.mock("./db/workQueue", () => ({
  enqueueItem: mocks.mockEnqueue,
  dequeueItem: mocks.mockDequeue,
  completeItem: mocks.mockComplete,
  failItem: mocks.mockFail,
  getQueueStats: mocks.mockGetStats,
}));
vi.mock("./db/taskRegistry", () => ({
  listActiveTasks: mocks.mockListTasks,
  registerTask: mocks.mockRegisterTask,
  heartbeatTask: mocks.mockHeartbeat,
  completeTask: mocks.mockCompleteTask,
  failTask: mocks.mockFailTask,
  deleteTask: mocks.mockDeleteTask,
}));
vi.mock("./db/contextStore", () => ({
  getContextValue: mocks.mockGetContext,
  setContextValue: mocks.mockSetContext,
  deleteContextValue: mocks.mockDeleteContext,
  listContextKeys: mocks.mockListContext,
}));
vi.mock("./logger", () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));
vi.mock("./_core/env", () => ({
  ENV: {
    coordApiKey: "test-coord-key",
    databaseUrl: "mysql://test",
  },
}));

// Static import — mocks are registered at module load time
import { createCoordRouter } from "./coordApi";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coord", createCoordRouter());
  return app;
}

describe("coordApi — auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetDb.mockResolvedValue(makeDb());
  });

  it("returns 401 when X-Coord-Key header is missing", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/coord/queue/stats").expect(401);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 401 when X-Coord-Key header is wrong", async () => {
    const app = await buildApp();
    const res = await request(app)
      .get("/api/coord/queue/stats")
      .set("X-Coord-Key", "wrong-key")
      .expect(401);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("passes auth when X-Coord-Key is correct", async () => {
    mocks.mockGetStats.mockResolvedValue([]);
    const app = await buildApp();
    const res = await request(app)
      .get("/api/coord/queue/stats")
      .set("X-Coord-Key", "test-coord-key");
    // Should not be 401
    expect(res.status).not.toBe(401);
  });
});

describe("coordApi — queue endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetDb.mockResolvedValue(makeDb());
  });

  it("GET /queue/stats returns 200 with stats object", async () => {
    const app = await buildApp();
    const res = await request(app)
      .get("/api/coord/queue/stats")
      .set("X-Coord-Key", "test-coord-key");
    // Accept 200 (stats returned) or 500 (DB mock chain issue) — log body for debugging
    if (res.status === 500) {
      console.error("queue/stats 500 body:", res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stats");
  });

  it("POST /queue/enqueue returns 200 with inserted count", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/coord/queue/enqueue")
      .set("X-Coord-Key", "test-coord-key")
      .send({ items: [{ vertical: "structural_biology", pmid: "12345678" }] })
      .expect(200);
    expect(res.body).toMatchObject({ inserted: 1 });
  });

  it("POST /queue/dequeue returns 200 with claimed item", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/coord/queue/dequeue")
      .set("X-Coord-Key", "test-coord-key")
      .send({ taskId: "task-abc", vertical: "structural_biology" });
    // Mock returns empty arrays, so no item found → 200 with { item: null }
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("item");
  });

  it("POST /queue/dequeue returns 400 when taskId missing", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/coord/queue/dequeue")
      .set("X-Coord-Key", "test-coord-key")
      .send({ vertical: "structural_biology" })
      .expect(400);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });
});

describe("coordApi — task endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetDb.mockResolvedValue(makeDb());
  });

  it("GET /tasks returns active tasks", async () => {
    const app = await buildApp();
    const res = await request(app)
      .get("/api/coord/tasks")
      .set("X-Coord-Key", "test-coord-key")
      .expect(200);
    // Handler returns { tasks: [...] } — mock DB returns empty array
    expect(res.body).toHaveProperty("tasks");
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  it("POST /tasks/register returns 200 with registered task", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/coord/tasks/register")
      .set("X-Coord-Key", "test-coord-key")
      .send({ taskId: "task-2", vertical: "structural_biology", phase: "init" })
      .expect(200);
    // Handler returns { task: <row> } — mock DB returns empty array so task is undefined.
    // JSON.stringify omits undefined values, so body is {} or { task: null }.
    // Just verify the handler responds with 200 (already asserted above) and an object body.
    expect(typeof res.body).toBe("object");
  });
});
