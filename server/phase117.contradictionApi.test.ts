/**
 * phase117.contradictionApi.test.ts
 * RED → GREEN tests for Phase 117: GET /api/v2/claims/:id/contradictions
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mock dependencies ────────────────────────────────────────────────────────
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./_core/rateLimit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("./contradictionDetector", () => ({
  scanLocalContradictions: vi.fn(),
}));

import { scanLocalContradictions } from "./contradictionDetector";
import { createApiV2Router } from "./apiV2Router";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v2", createApiV2Router());
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Phase 117 — GET /api/v2/claims/:id/contradictions", () => {
  it("returns 200 with contradiction pairs when scan finds results", async () => {
    vi.mocked(scanLocalContradictions).mockResolvedValue({
      claimId: 42,
      pairsScanned: 3,
      newAlerts: 1,
      durationMs: 12,
    });

    const app = makeApp();
    const res = await request(app).get("/api/v2/claims/42/contradictions");

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.claimId).toBe(42);
    expect(res.body.data.pairsScanned).toBe(3);
    expect(res.body.data.newAlerts).toBe(1);
    expect(typeof res.body.data.durationMs).toBe("number");
  });

  it("returns 400 for non-numeric claim ID", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/v2/claims/not-a-number/contradictions");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid claim id/i);
  });

  it("returns 200 with zero pairs when no contradictions found", async () => {
    vi.mocked(scanLocalContradictions).mockResolvedValue({
      claimId: 99,
      pairsScanned: 0,
      newAlerts: 0,
      durationMs: 5,
    });

    const app = makeApp();
    const res = await request(app).get("/api/v2/claims/99/contradictions");

    expect(res.status).toBe(200);
    expect(res.body.data.pairsScanned).toBe(0);
    expect(res.body.data.newAlerts).toBe(0);
  });

  it("returns 503 when scanLocalContradictions throws", async () => {
    vi.mocked(scanLocalContradictions).mockRejectedValue(new Error("DB unavailable"));

    const app = makeApp();
    const res = await request(app).get("/api/v2/claims/42/contradictions");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/contradiction scan failed/i);
  });

  it("calls scanLocalContradictions with the correct claimId", async () => {
    vi.mocked(scanLocalContradictions).mockResolvedValue({
      claimId: 7,
      pairsScanned: 1,
      newAlerts: 0,
      durationMs: 8,
    });

    const app = makeApp();
    await request(app).get("/api/v2/claims/7/contradictions");

    expect(scanLocalContradictions).toHaveBeenCalledWith(7);
  });
});
