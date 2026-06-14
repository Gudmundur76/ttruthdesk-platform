/**
 * coordApi/tasksRouter.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for coordApi/tasksRouter.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mockGetDb }));
vi.mock("../_core/env", () => ({ ENV: { coordApiKey: "test-key" } }));

import { createTasksRouter } from "./tasksRouter";
import type { Request, Response } from "express";

type RouterStack = Array<{ route: { path: string; stack: Array<{ handle: (r: Request, s: Response) => void }> } }>;

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function makeReq(body: unknown = {}, params: unknown = {}) {
  return { body, params, query: {} } as unknown as Request;
}

function makeDb(selectResult: unknown[] = []) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(selectResult),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(selectResult),
    then: undefined,
  };
}

function getHandler(router: ReturnType<typeof createTasksRouter>, path: string, methodIdx = 0) {
  const stack = (router as unknown as { stack: RouterStack }).stack;
  const layer = stack.find((l) => l.route?.path === path);
  return layer?.route.stack[methodIdx].handle;
}

describe("coordApi/tasksRouter — GET /tasks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns tasks list when DB is available", async () => {
    const tasks = [{ taskId: "t1", status: "running", vertical: "pmc" }];
    const db = makeDb(tasks);
    mockGetDb.mockResolvedValue(db);
    const router = createTasksRouter();
    const req = makeReq();
    const res = makeRes();
    const handler = getHandler(router, "/");
    await handler?.(req, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith({ tasks });
  });

  it("returns 503 when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);
    const router = createTasksRouter();
    const req = makeReq();
    const res = makeRes();
    const handler = getHandler(router, "/");
    await handler?.(req, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe("coordApi/tasksRouter — POST /register", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when taskId or vertical is missing", async () => {
    mockGetDb.mockResolvedValue(makeDb());
    const router = createTasksRouter();
    const req = makeReq({ taskId: "t1" }); // missing vertical
    const res = makeRes();
    const handler = getHandler(router, "/register");
    await handler?.(req, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns the registered task on success", async () => {
    const taskRow = { taskId: "t1", vertical: "pmc", status: "running" };
    const db = {
      ...makeDb([taskRow]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([taskRow]),
      then: undefined,
    };
    mockGetDb.mockResolvedValue(db);
    const router = createTasksRouter();
    const req = makeReq({ taskId: "t1", vertical: "pmc" });
    const res = makeRes();
    const handler = getHandler(router, "/register");
    await handler?.(req, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith({ task: taskRow });
  });
});
