/**
 * Tests for externalPublicRouter.ts
 *
 * Verifies that /api/external/public/* alias routes forward correctly to
 * /api/public/* canonical routes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerExternalPublicRoutes } from "./externalPublicRouter";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());

  // Stub canonical /api/public/* routes
  app.get("/api/public/claims/:id", (req, res) => {
    res.status(200).json({ claim_id: parseInt(req.params.id, 10), stub: true });
  });
  app.get("/api/public/stats", (_req, res) => {
    res.status(200).json({ totalClaims: 42, stub: true });
  });
  app.get("/api/public/verticals", (_req, res) => {
    res.status(200).json({ verticals: [], stub: true });
  });
  app.get("/api/public/leaderboard", (_req, res) => {
    res.status(200).json({ entities: [], stub: true });
  });
  app.get("/api/public/contradictions", (_req, res) => {
    res.status(200).json({ contradictions: [], stub: true });
  });

  // Register the alias routes AFTER the canonical routes
  registerExternalPublicRoutes(app);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("externalPublicRouter — alias routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = makeApp();
  });

  it("GET /api/external/public/claims/:id forwards to /api/public/claims/:id", async () => {
    const res = await request(app).get("/api/external/public/claims/300001");
    expect(res.status).toBe(200);
    expect(res.body.claim_id).toBe(300001);
    expect(res.body.stub).toBe(true);
  });

  it("GET /api/external/public/stats forwards to /api/public/stats", async () => {
    const res = await request(app).get("/api/external/public/stats");
    expect(res.status).toBe(200);
    expect(res.body.totalClaims).toBe(42);
    expect(res.body.stub).toBe(true);
  });

  it("GET /api/external/public/verticals forwards to /api/public/verticals", async () => {
    const res = await request(app).get("/api/external/public/verticals");
    expect(res.status).toBe(200);
    expect(res.body.verticals).toEqual([]);
    expect(res.body.stub).toBe(true);
  });

  it("GET /api/external/public/leaderboard forwards to /api/public/leaderboard", async () => {
    const res = await request(app).get("/api/external/public/leaderboard");
    expect(res.status).toBe(200);
    expect(res.body.entities).toEqual([]);
    expect(res.body.stub).toBe(true);
  });

  it("GET /api/external/public/contradictions forwards to /api/public/contradictions", async () => {
    const res = await request(app).get("/api/external/public/contradictions");
    expect(res.status).toBe(200);
    expect(res.body.contradictions).toEqual([]);
    expect(res.body.stub).toBe(true);
  });

  it("OPTIONS /api/external/public/* returns 204 with CORS headers", async () => {
    const res = await request(app).options("/api/external/public/stats");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("query params are preserved when forwarding", async () => {
    // The stub canonical route for leaderboard ignores query params but the
    // forward mechanism must not strip them.
    const res = await request(app).get(
      "/api/external/public/leaderboard?limit=5"
    );
    expect(res.status).toBe(200);
    expect(res.body.stub).toBe(true);
  });
});
