/**
 * claimHistoryRoute.test.ts
 * Tests for GET /api/v2/claims/:id/history
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockGetClaimById: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: mocks.mockGetDb,
  getClaimById: mocks.mockGetClaimById,
}));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

import express from "express";
import request from "supertest";
import { registerClaimHistoryRoute } from "./claimHistoryRoute";

function makeApp() {
  const app = express();
  app.use(express.json());
  registerClaimHistoryRoute(app as express.Express);
  return app;
}

function makeDbChain(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockResolvedValue(resolveValue);
  return chain;
}

describe("GET /api/v2/claims/:id/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for non-numeric claim id", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/v2/claims/abc/history");
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/invalid claim id/i);
  });

  it("returns 404 when claim does not exist", async () => {
    mocks.mockGetClaimById.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app).get("/api/v2/claims/42/history");
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 503 when DB is unavailable", async () => {
    mocks.mockGetClaimById.mockResolvedValue({ id: 1, claimText: "test" });
    mocks.mockGetDb.mockResolvedValue(null);
    const app = makeApp();
    const res = await request(app).get("/api/v2/claims/1/history");
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/database unavailable/i);
  });

  it("returns 200 with empty history arrays when no history exists", async () => {
    mocks.mockGetClaimById.mockResolvedValue({ id: 5, claimText: "test claim" });
    const db = makeDbChain([]);
    mocks.mockGetDb.mockResolvedValue(db);
    const app = makeApp();
    const res = await request(app).get("/api/v2/claims/5/history");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.claimId).toBe(5);
    expect(res.body.data.scoreHistory).toEqual([]);
    expect(res.body.data.confidenceHistory).toEqual([]);
  });

  it("returns 200 with populated history arrays", async () => {
    mocks.mockGetClaimById.mockResolvedValue({ id: 7, claimText: "protein claim" });
    const scoreRows = [
      { claimId: 7, score: 0.9, snapshotAt: new Date("2024-01-02") },
      { claimId: 7, score: 0.7, snapshotAt: new Date("2024-01-01") },
    ];
    const confRows = [
      { claimId: 7, confidence: 0.85, recordedAt: new Date("2024-01-02") },
    ];
    let callCount = 0;
    const db: Record<string, unknown> = {};
    db.select = vi.fn().mockImplementation(() => {
      callCount++;
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockResolvedValue(
        callCount === 1 ? scoreRows : confRows
      );
      return chain;
    });
    mocks.mockGetDb.mockResolvedValue(db);
    const app = makeApp();
    const res = await request(app).get("/api/v2/claims/7/history");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.claimId).toBe(7);
    // Rows are reversed (oldest→newest)
    expect(res.body.data.scoreHistory).toHaveLength(2);
    expect(res.body.data.confidenceHistory).toHaveLength(1);
  });

  it("uses two separate DB connections in parallel", async () => {
    mocks.mockGetClaimById.mockResolvedValue({ id: 3, claimText: "claim" });
    const db = makeDbChain([]);
    mocks.mockGetDb.mockResolvedValue(db);
    const app = makeApp();
    await request(app).get("/api/v2/claims/3/history");
    // getDb called twice (db1 and db2)
    expect(mocks.mockGetDb).toHaveBeenCalledTimes(2);
  });

  it("returns scoreHistory in oldest-to-newest order (reversed from DESC query)", async () => {
    mocks.mockGetClaimById.mockResolvedValue({ id: 10, claimText: "test" });
    const scoreRows = [
      { claimId: 10, score: 0.9, snapshotAt: "2024-03-01" },
      { claimId: 10, score: 0.8, snapshotAt: "2024-02-01" },
      { claimId: 10, score: 0.7, snapshotAt: "2024-01-01" },
    ];
    let callCount = 0;
    const db: Record<string, unknown> = {};
    db.select = vi.fn().mockImplementation(() => {
      callCount++;
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockResolvedValue(
        callCount === 1 ? scoreRows : []
      );
      return chain;
    });
    mocks.mockGetDb.mockResolvedValue(db);
    const app = makeApp();
    const res = await request(app).get("/api/v2/claims/10/history");
    expect(res.status).toBe(200);
    // After .reverse(), oldest entry should be last in the DESC-sorted array
    // (DESC: [0.9, 0.8, 0.7] → reversed: [0.7, 0.8, 0.9])
    expect(res.body.data.scoreHistory[0].score).toBe(0.7);
    expect(res.body.data.scoreHistory[2].score).toBe(0.9);
  });
});
