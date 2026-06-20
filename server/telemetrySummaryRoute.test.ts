/**
 * telemetrySummaryRoute.test.ts
 *
 * Tests for GET /api/telemetry/summary.
 * Uses a lightweight express app — no DB required.
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerTelemetrySummaryRoute } from "./telemetrySummaryRoute";
import { verificationEventStore } from "./verificationEventStore";

function makeApp() {
  const app = express();
  app.use(express.json());
  registerTelemetrySummaryRoute(app);
  return app;
}

describe("GET /api/telemetry/summary", () => {
  beforeEach(() => {
    verificationEventStore.clear();
  });

  it("returns ok:true with empty summary when no events", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/telemetry/summary");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.summary.totalVerifications).toBe(0);
    expect(res.body.summary.lastVerifiedAt).toBeNull();
  });

  it("returns correct counts after pushing events", async () => {
    verificationEventStore.push({
      inputId: "id-1",
      verdict: "Supported",
      adapter: "pubmed",
      confidence: 0.9,
      timestamp: new Date().toISOString(),
    });
    verificationEventStore.push({
      inputId: "id-2",
      verdict: "Contradicted",
      adapter: "pdb",
      confidence: 0.05,
      timestamp: new Date().toISOString(),
    });
    const app = makeApp();
    const res = await request(app).get("/api/telemetry/summary");
    expect(res.status).toBe(200);
    expect(res.body.summary.totalVerifications).toBe(2);
    expect(res.body.summary.supportedCount).toBe(1);
    expect(res.body.summary.contradictedCount).toBe(1);
  });

  it("accepts windowHours query param and clamps to max 168", async () => {
    const app = makeApp();
    const res = await request(app).get(
      "/api/telemetry/summary?windowHours=999"
    );
    expect(res.status).toBe(200);
    expect(res.body.windowHours).toBe(168);
  });

  it("defaults to windowHours=24 when not specified", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/telemetry/summary");
    expect(res.status).toBe(200);
    expect(res.body.windowHours).toBe(24);
  });

  it("includes generatedAt timestamp", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/telemetry/summary");
    expect(res.body.generatedAt).toBeTruthy();
    expect(new Date(res.body.generatedAt).getTime()).toBeGreaterThan(0);
  });
});
