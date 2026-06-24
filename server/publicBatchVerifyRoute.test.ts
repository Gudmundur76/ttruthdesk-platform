/**
 * publicBatchVerifyRoute.test.ts
 *
 * Tests for POST /api/public/batch-verify covering:
 *  - Input validation (missing claims, too many claims, invalid claim types)
 *  - Buffered JSON response (default mode)
 *  - Optional `concurrency` request parameter (1–5, clamped, default 5)
 *  - NDJSON streaming mode (Accept: application/x-ndjson)
 *  - CORS headers
 *
 * NOTE: The rate-limiter is a module-level Map. We reset it via the exported
 * `_resetRateLimitForTesting` helper before each test so tests are isolated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mock all heavy dependencies ─────────────────────────────────────────────

vi.mock("./claimExtractor", () => ({
  extractClaims: vi.fn().mockResolvedValue([]),
}));

vi.mock("./pdbAdapter", () => ({
  verdictForClaim: vi.fn().mockResolvedValue({
    verdict: "Insufficient Evidence",
    rationale: "No structural data found.",
    evidenceUrl: null,
    evidenceRaw: undefined,
  }),
}));

vi.mock("./discoveryLoopJob", () => ({
  computeSignalDensity: vi.fn().mockReturnValue(0),
}));

vi.mock("./verticalAdapters/types", () => ({
  getVertical: vi.fn().mockReturnValue(null),
}));

vi.mock("./verticalAdapters", () => ({}));

vi.mock("./_queryTranslator", () => ({
  translateQueryToClaims: vi.fn().mockResolvedValue([]),
}));

vi.mock("./autonomousIngest", () => ({
  triggerAutonomousIngest: vi.fn(),
}));

vi.mock("./ncbiAdapter", () => ({
  fetchNcbiResults: vi.fn().mockResolvedValue([]),
}));

vi.mock("./logger", () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  errData: (e: unknown) => e,
}));

import {
  registerPublicBatchVerifyRoute,
  _resetRateLimitForTesting,
} from "./publicBatchVerifyRoute";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  registerPublicBatchVerifyRoute(app);
  return app;
}

const VALID_CLAIMS = ["Salmon contains omega-3 fatty acids.", "Protein X inhibits enzyme Y."];

beforeEach(() => {
  _resetRateLimitForTesting();
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe("POST /api/public/batch-verify — input validation", () => {
  it("returns 400 when claims is missing", async () => {
    const res = await request(buildApp()).post("/api/public/batch-verify").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/claims/i);
  });

  it("returns 400 when claims is an empty array", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: [] });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 when claims exceeds 50", async () => {
    const claims = Array.from({ length: 51 }, (_, i) => `Claim ${i}`);
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50/);
  });

  it("returns 200 and marks oversized claim as error (not 400)", async () => {
    const longClaim = "x".repeat(2001);
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: [longClaim] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.results[0].error).toBeTruthy();
  });
});

// ─── Buffered JSON mode ───────────────────────────────────────────────────────

describe("POST /api/public/batch-verify — buffered JSON mode", () => {
  it("returns ok:true with results array", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: VALID_CLAIMS });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results).toHaveLength(2);
  });

  it("results are in input order (index field)", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: VALID_CLAIMS });
    expect(res.body.results[0].index).toBe(0);
    expect(res.body.results[1].index).toBe(1);
  });

  it("each result has required fields", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: [VALID_CLAIMS[0]] });
    const r = res.body.results[0];
    expect(r).toHaveProperty("index");
    expect(r).toHaveProperty("claim");
    expect(r).toHaveProperty("verdict");
    expect(r).toHaveProperty("rationale");
    expect(r).toHaveProperty("confidence");
    expect(r).toHaveProperty("evidenceUrl");
    expect(r).toHaveProperty("pubmedResults");
    expect(r).toHaveProperty("processedAt");
    expect(r).toHaveProperty("error");
  });

  it("returns apiVersion 1.1 in response", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: [VALID_CLAIMS[0]] });
    expect(res.body.apiVersion).toBe("1.1");
  });

  it("returns total matching claims count", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: VALID_CLAIMS });
    expect(res.body.total).toBe(2);
  });
});

// ─── concurrency parameter ────────────────────────────────────────────────────

describe("POST /api/public/batch-verify — concurrency parameter", () => {
  it("accepts concurrency=1 and still returns all results", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: VALID_CLAIMS, concurrency: 1 });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
  });

  it("accepts concurrency=5 (max) and returns all results", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: VALID_CLAIMS, concurrency: 5 });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
  });

  it("clamps concurrency > 5 to 5 and still succeeds", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: VALID_CLAIMS, concurrency: 99 });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
  });

  it("treats concurrency=0 as default (5) and still succeeds", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: VALID_CLAIMS, concurrency: 0 });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
  });

  it("treats non-numeric concurrency as default and still succeeds", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .send({ claims: VALID_CLAIMS, concurrency: "fast" });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
  });
});

// ─── NDJSON streaming mode ────────────────────────────────────────────────────

describe("POST /api/public/batch-verify — NDJSON streaming mode", () => {
  it("returns Content-Type application/x-ndjson when Accept header is set", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .set("Accept", "application/x-ndjson")
      .send({ claims: VALID_CLAIMS });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);
  });

  it("response body is valid NDJSON with one line per claim plus summary", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .set("Accept", "application/x-ndjson")
      .send({ claims: VALID_CLAIMS });

    const lines = (res.text as string)
      .split("\n")
      .filter(l => l.trim().length > 0);

    // 2 claim lines + 1 summary line
    expect(lines).toHaveLength(3);

    const claimLines = lines.slice(0, 2).map(l => JSON.parse(l));
    claimLines.forEach(r => {
      expect(r).toHaveProperty("index");
      expect(r).toHaveProperty("verdict");
    });

    const summary = JSON.parse(lines[2]);
    expect(summary.done).toBe(true);
    expect(summary.total).toBe(2);
    expect(summary.apiVersion).toBe("1.1");
  });

  it("NDJSON claim lines have required fields", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .set("Accept", "application/x-ndjson")
      .send({ claims: [VALID_CLAIMS[0]] });

    const lines = (res.text as string).split("\n").filter(l => l.trim().length > 0);
    const claimResult = JSON.parse(lines[0]);
    expect(claimResult).toHaveProperty("index");
    expect(claimResult).toHaveProperty("claim");
    expect(claimResult).toHaveProperty("verdict");
    expect(claimResult).toHaveProperty("rationale");
    expect(claimResult).toHaveProperty("confidence");
    expect(claimResult).toHaveProperty("processedAt");
  });

  it("NDJSON mode respects concurrency parameter", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .set("Accept", "application/x-ndjson")
      .send({ claims: VALID_CLAIMS, concurrency: 1 });

    expect(res.status).toBe(200);
    const lines = (res.text as string).split("\n").filter(l => l.trim().length > 0);
    expect(lines).toHaveLength(3); // 2 claims + summary
  });
});

// ─── CORS headers ─────────────────────────────────────────────────────────────

describe("POST /api/public/batch-verify — CORS", () => {
  it("sets Access-Control-Allow-Origin for allowed origin", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .set("Origin", "https://notus.is")
      .send({ claims: [VALID_CLAIMS[0]] });
    expect(res.headers["access-control-allow-origin"]).toBe("https://notus.is");
  });

  it("falls back to citation.manus.space for unknown origin", async () => {
    const res = await request(buildApp())
      .post("/api/public/batch-verify")
      .set("Origin", "https://unknown.example.com")
      .send({ claims: [VALID_CLAIMS[0]] });
    expect(res.headers["access-control-allow-origin"]).toBe("https://citation.manus.space");
  });

  it("OPTIONS preflight returns 204", async () => {
    const res = await request(buildApp())
      .options("/api/public/batch-verify")
      .set("Origin", "https://notus.is");
    expect(res.status).toBe(204);
  });

  it("Accept header is included in Access-Control-Allow-Headers", async () => {
    const res = await request(buildApp())
      .options("/api/public/batch-verify")
      .set("Origin", "https://notus.is");
    expect(res.headers["access-control-allow-headers"]).toMatch(/accept/i);
  });
});
