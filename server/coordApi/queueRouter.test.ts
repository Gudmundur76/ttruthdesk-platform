/**
 * coordApi/queueRouter.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for coordApi/queueRouter.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mockGetDb }));
vi.mock("../_core/env", () => ({ ENV: { coordApiKey: "test-key" } }));

import { createQueueRouter } from "./queueRouter";
import type { Request, Response } from "express";

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function makeReq(body: unknown = {}, query: unknown = {}) {
  return { body, query, params: {} } as unknown as Request;
}

function makeDb() {
  const chain: Record<string, unknown> = {};
  const self = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
    then: undefined, // prevent being treated as thenable
  };
  Object.assign(chain, self);
  return self;
}

describe("coordApi/queueRouter — POST /enqueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when items is not provided", async () => {
    mockGetDb.mockResolvedValue(makeDb());
    const router = createQueueRouter();
    const req = makeReq({ items: [] });
    const res = makeRes();
    // Find the enqueue handler
    const layer = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ handle: (r: Request, s: Response) => void }> } }> }).stack.find(
      (l) => l.route?.path === "/enqueue"
    );
    await layer?.route.stack[0].handle(req, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns inserted count when valid items are provided", async () => {
    const db = makeDb();
    mockGetDb.mockResolvedValue(db);
    const router = createQueueRouter();
    const req = makeReq({
      items: [
        { vertical: "pmc", pmid: "12345", title: "Test Paper" },
        { vertical: "pmc", pmid: "67890", title: "Another Paper" },
      ],
    });
    const res = makeRes();
    const layer = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ handle: (r: Request, s: Response) => void }> } }> }).stack.find(
      (l) => l.route?.path === "/enqueue"
    );
    await layer?.route.stack[0].handle(req, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ inserted: 2 }));
  });

  it("deduplicates items with the same pmid", async () => {
    const db = makeDb();
    mockGetDb.mockResolvedValue(db);
    const router = createQueueRouter();
    const req = makeReq({
      items: [
        { vertical: "pmc", pmid: "12345" },
        { vertical: "pmc", pmid: "12345" }, // duplicate
      ],
    });
    const res = makeRes();
    const layer = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ handle: (r: Request, s: Response) => void }> } }> }).stack.find(
      (l) => l.route?.path === "/enqueue"
    );
    await layer?.route.stack[0].handle(req, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ inserted: 1 }));
  });
});

describe("coordApi/queueRouter — POST /dequeue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when taskId is missing", async () => {
    mockGetDb.mockResolvedValue(makeDb());
    const router = createQueueRouter();
    const req = makeReq({});
    const res = makeRes();
    const layer = (router as unknown as { stack: Array<{ route: { path: string; stack: Array<{ handle: (r: Request, s: Response) => void }> } }> }).stack.find(
      (l) => l.route?.path === "/dequeue"
    );
    await layer?.route.stack[0].handle(req, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
