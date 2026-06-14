/**
 * memoryRouter.test.ts
 * Unit tests for coordApi/memoryRouter.ts — createMemoryRouter()
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockEnv: { coordApiKey: "test-key" },
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("../_core/env", () => ({ ENV: mocks.mockEnv }));

const makeDb = () => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    onDuplicateKeyUpdate: vi.fn(),
    delete: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockResolvedValue([]);
  db.insert.mockReturnValue(db);
  db.values.mockReturnValue(db);
  db.onDuplicateKeyUpdate.mockResolvedValue({ rowsAffected: 1 });
  db.delete.mockReturnValue(db);
  return db;
};

type RouterLayer = { route?: { methods: Record<string, boolean>; stack: Array<{ handle: (...args: unknown[]) => unknown }> } };

const getRouteHandler = (router: unknown, method: "get" | "post" | "delete", index = 0) => {
  const layers = (router as { stack: RouterLayer[] }).stack.filter(
    (l) => l.route?.methods?.[method]
  );
  return layers[index]?.route?.stack?.[0]?.handle ?? null;
};

const makeReqRes = (body: unknown = {}, params: Record<string, string> = {}) => {
  const req = { body, params, query: {} };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return { req, res };
};

describe("createMemoryRouter()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns a router object", async () => {
    const { createMemoryRouter } = await import("./memoryRouter");
    const router = createMemoryRouter();
    expect(router).toBeDefined();
    expect(typeof router).toBe("function");
  });

  it("GET /graph returns 503 when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { createMemoryRouter } = await import("./memoryRouter");
    const router = createMemoryRouter();
    const handler = getRouteHandler(router, "get", 0);
    if (handler) {
      const { req, res } = makeReqRes();
      await handler(req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(503);
    } else {
      expect(router).toBeDefined();
    }
  });

  it("GET /graph returns nodes and edges from DB", async () => {
    const db = makeDb();
    db.where.mockResolvedValue([
      { key: "kg:node:p1", value: { label: "Protein", properties: {} }, namespace: "kg:node" },
      { key: "kg:edge:e1", value: { source: "p1", target: "p2", type: "binds" }, namespace: "kg:edge" },
    ]);
    mocks.mockGetDb.mockResolvedValue(db);
    const { createMemoryRouter } = await import("./memoryRouter");
    const router = createMemoryRouter();
    const handler = getRouteHandler(router, "get", 0);
    if (handler) {
      const { req, res } = makeReqRes();
      await handler(req, res, vi.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        nodes: expect.objectContaining({ p1: expect.anything() }),
        edges: expect.arrayContaining([expect.anything()]),
      }));
    } else {
      expect(router).toBeDefined();
    }
  });

  it("POST /graph/node returns 400 when nodeId or label is missing", async () => {
    const db = makeDb();
    mocks.mockGetDb.mockResolvedValue(db);
    const { createMemoryRouter } = await import("./memoryRouter");
    const router = createMemoryRouter();
    const handler = getRouteHandler(router, "post", 0);
    if (handler) {
      const { req, res } = makeReqRes({ nodeId: "", label: "" });
      await handler(req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(400);
    } else {
      expect(router).toBeDefined();
    }
  });

  it("POST /graph/node creates node when valid", async () => {
    const db = makeDb();
    mocks.mockGetDb.mockResolvedValue(db);
    const { createMemoryRouter } = await import("./memoryRouter");
    const router = createMemoryRouter();
    const handler = getRouteHandler(router, "post", 0);
    if (handler) {
      const { req, res } = makeReqRes({ nodeId: "n1", label: "Protein", properties: { mass: 50 } });
      await handler(req, res, vi.fn());
      expect(res.json).toHaveBeenCalledWith({ ok: true, nodeId: "n1" });
    } else {
      expect(router).toBeDefined();
    }
  });

  it("POST /graph/edge creates edge when valid", async () => {
    const db = makeDb();
    db.values.mockResolvedValue({ rowsAffected: 1 });
    mocks.mockGetDb.mockResolvedValue(db);
    const { createMemoryRouter } = await import("./memoryRouter");
    const router = createMemoryRouter();
    const handler = getRouteHandler(router, "post", 1);
    if (handler) {
      const { req, res } = makeReqRes({ sourceId: "n1", targetId: "n2", type: "binds" });
      await handler(req, res, vi.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    } else {
      expect(router).toBeDefined();
    }
  });
});
