/**
 * dreamStagingRoute.test.ts — Sprint 0 Fix 3
 * Tests for POST /api/admin/dream-staging/:id/review
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockPublishEvent: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./autonomousLoop/eventBus", () => ({
  publishEvent: mocks.mockPublishEvent,
}));

import express from "express";
import request from "supertest";
import { registerDreamStagingRoute } from "./dreamStagingRoute";

function makeApp(user?: { openId: string }) {
  const app = express();
  app.use(express.json());
  // Fake auth middleware
  app.use(
    (req: express.Request & { user?: { openId: string } }, _res, next) => {
      if (user) req.user = user;
      next();
    }
  );
  const requireOwnerOrAdmin = (
    _req: express.Request,
    _res: express.Response,
    next: () => void
  ) => next();
  registerDreamStagingRoute(app as express.Express, requireOwnerOrAdmin);
  return app;
}

function makeDb(rows: object[] = []) {
  const db: Record<string, unknown> = {};
  db.select = vi.fn().mockReturnValue(db);
  db.from = vi.fn().mockReturnValue(db);
  db.where = vi.fn().mockResolvedValue(rows);
  db.update = vi.fn().mockReturnValue(db);
  db.set = vi.fn().mockReturnValue(db);
  // update().set().where() chain
  const updateChain: Record<string, unknown> = {};
  updateChain.set = vi.fn().mockReturnValue(updateChain);
  updateChain.where = vi.fn().mockResolvedValue({ affectedRows: 1 });
  db.update = vi.fn().mockReturnValue(updateChain);
  return db;
}

const pendingItem = {
  id: 1,
  sessionEventId: 99,
  hypothesis: { gapId: 10, confidence: 0.5 },
  confidence: 0.5,
  status: "pending",
  reviewedBy: null,
  reviewNote: null,
  createdAt: Date.now(),
  reviewedAt: null,
};

describe("dreamStagingRoute — POST /api/admin/dream-staging/:id/review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid id", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb());
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/dream-staging/abc/review")
      .send({ action: "approve" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid id/i);
  });

  it("returns 400 for missing or invalid action", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([pendingItem]));
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/dream-staging/1/review")
      .send({ action: "invalid" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action must be/i);
  });

  it("returns 503 when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/dream-staging/1/review")
      .send({ action: "approve" });
    expect(res.status).toBe(503);
  });

  it("returns 404 when item not found", async () => {
    mocks.mockGetDb.mockResolvedValue(makeDb([]));
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/dream-staging/999/review")
      .send({ action: "approve" });
    expect(res.status).toBe(404);
  });

  it("returns 409 when item is already approved", async () => {
    const approvedItem = { ...pendingItem, status: "approved" };
    mocks.mockGetDb.mockResolvedValue(makeDb([approvedItem]));
    const app = makeApp();
    const res = await request(app)
      .post("/api/admin/dream-staging/1/review")
      .send({ action: "approve" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already approved/i);
  });

  it("approves a pending item and publishes gap_closed when gapId present", async () => {
    const db = makeDb([pendingItem]);
    mocks.mockGetDb.mockResolvedValue(db);
    mocks.mockPublishEvent.mockResolvedValue(undefined);
    const app = makeApp({ openId: "admin-user" });
    const res = await request(app)
      .post("/api/admin/dream-staging/1/review")
      .send({ action: "approve", note: "Looks good" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, action: "approved", id: 1 });
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "gap_closed",
      expect.objectContaining({ gapId: 10, source: "dream_staging_approved" })
    );
  });

  it("rejects a pending item without publishing gap_closed", async () => {
    const db = makeDb([pendingItem]);
    mocks.mockGetDb.mockResolvedValue(db);
    const app = makeApp({ openId: "admin-user" });
    const res = await request(app)
      .post("/api/admin/dream-staging/1/review")
      .send({ action: "reject", note: "Not credible" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, action: "rejected", id: 1 });
    expect(mocks.mockPublishEvent).not.toHaveBeenCalled();
  });

  it("approves without publishing gap_closed when hypothesis has no gapId", async () => {
    const noGapItem = { ...pendingItem, hypothesis: { confidence: 0.5 } };
    const db = makeDb([noGapItem]);
    mocks.mockGetDb.mockResolvedValue(db);
    const app = makeApp({ openId: "admin-user" });
    const res = await request(app)
      .post("/api/admin/dream-staging/1/review")
      .send({ action: "approve" });
    expect(res.status).toBe(200);
    expect(mocks.mockPublishEvent).not.toHaveBeenCalled();
  });
});
