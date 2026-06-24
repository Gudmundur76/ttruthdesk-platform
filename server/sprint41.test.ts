/**
 * sprint41.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for Sprint 41 changes:
 *   1. Batch decompose-claim: POST /api/public/decompose-claim with claims[]
 *   2. citedPmids field in POST /v1/verify response
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mock questionDecomposer ──────────────────────────────────────────────────

vi.mock("./questionDecomposer", () => ({
  decomposeQuestion: vi.fn(async (text: string) => ({
    claims: [
      { index: 0, text, confidence: 0.9, method: "heuristic" },
    ],
    usedLlm: false,
    durationMs: 10,
  })),
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────

vi.mock("./logger", () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Batch decompose-claim tests ──────────────────────────────────────────────

describe("POST /api/public/decompose-claim — batch mode", () => {
  let app: ReturnType<typeof express>;

  beforeEach(async () => {
    vi.resetModules();
    const { registerPublicDecomposeClaimRoute, _resetRateLimitForTesting } = await import(
      "./publicDecomposeClaimRoute"
    );
    _resetRateLimitForTesting();
    app = express();
    app.use(express.json());
    registerPublicDecomposeClaimRoute(app);
  });

  it("returns batch results for claims[] array", async () => {
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({
        claims: [
          "Decahydroisoquinoline scaffold inhibits HIV-1 protease",
          "Predicted pIC50=8.7 for Compound X",
        ],
        vertical: "hiv_protease",
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.totalClaims).toBe(2);
    expect(typeof res.body.totalVerifiable).toBe("number");
    expect(typeof res.body.totalFiltered).toBe("number");
    expect(res.body.apiVersion).toBe("1.1");
  });

  it("each result has original, claims, usedLlm, durationMs", async () => {
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claims: ["Hydroxyethylamine isostere mimics HIV-1 protease transition state"] });

    expect(res.status).toBe(200);
    const first = res.body.results[0];
    expect(typeof first.original).toBe("string");
    expect(Array.isArray(first.claims)).toBe(true);
    expect(typeof first.usedLlm).toBe("boolean");
    expect(typeof first.durationMs).toBe("number");
  });

  it("filters non-verifiable claims in batch (predicted pIC50)", async () => {
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({
        claims: ["predicted pIC50=8.7 for Compound X"],
      });

    expect(res.status).toBe(200);
    // The claim itself is non-verifiable — totalFiltered should be 1
    const allClaims = res.body.results.flatMap((r: { claims: { verifiable: boolean }[] }) => r.claims);
    const nonVerifiable = allClaims.filter((c: { verifiable: boolean }) => !c.verifiable);
    expect(nonVerifiable.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects empty claims array with 400", async () => {
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claims: [] });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("rejects claims array exceeding max batch size with 400", async () => {
    const bigBatch = Array.from({ length: 51 }, (_, i) => `Claim ${i}`);
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claims: bigBatch });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/50/);
  });

  it("rejects non-string items in claims array with 400", async () => {
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claims: ["valid claim", 42, null] });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("single-claim mode still works alongside batch mode", async () => {
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claim: "Darunavir binds HIV-1 protease active site" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.input).toBe("string");
    expect(Array.isArray(res.body.claims)).toBe(true);
  });

  it("returns 400 with examples when neither claim nor claims is provided", async () => {
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ useLlm: false });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.examples).toBeDefined();
    expect(res.body.examples.batch).toBeDefined();
    expect(res.body.examples.single).toBeDefined();
  });
});

// ─── /v1/verify citedPmids tests ──────────────────────────────────────────────

const mockEnv = vi.hoisted(() => ({ citationApiKey: "test-key-sprint41" }));

vi.mock("./_core/env", () => ({ ENV: mockEnv }));

describe("POST /v1/verify — citedPmids field (Sprint 41)", () => {
  let app: ReturnType<typeof express>;

  beforeEach(async () => {
    vi.resetModules();
    mockEnv.citationApiKey = "test-key-sprint41";

    // Patch fetch to return a mock verify-claim response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        verdict: "Supported",
        confidenceScore: 0.87,
        pubmedResults: [
          { pmid: "18077363", title: "Darunavir SAR" },
          { pmid: "15615512", title: "Amprenavir SAR" },
        ],
        pdbId: null,
        apiVersion: "1.1",
      }),
    } as unknown as Response);

    const { registerV1VerifyRoute } = await import("./publicV1VerifyRoute");
    app = express();
    app.use(express.json());
    registerV1VerifyRoute(app);
  });

  it("includes citedPmids array in response", async () => {
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-key-sprint41")
      .send({ claim: "Darunavir binds HIV-1 protease active site", context: "molecular_evolution" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.citedPmids)).toBe(true);
    expect(res.body.citedPmids).toContain("18077363");
    expect(res.body.citedPmids).toContain("15615512");
  });

  it("returns empty citedPmids array when no pubmedResults", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        verdict: "Insufficient Evidence",
        confidenceScore: 0.1,
        pubmedResults: [],
        pdbId: null,
      }),
    } as unknown as Response);

    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-key-sprint41")
      .send({ claim: "Predicted pIC50=8.7 for unknown compound" });

    expect(res.status).toBe(200);
    expect(res.body.citedPmids).toEqual([]);
  });

  it("citedPmids and sources are consistent (sources prefixed, citedPmids raw)", async () => {
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-key-sprint41")
      .send({ claim: "Hydroxyethylamine isostere HIV-1 protease" });

    expect(res.status).toBe(200);
    // sources should be prefixed
    expect(res.body.sources).toContain("pubmed:18077363");
    // citedPmids should be raw
    expect(res.body.citedPmids).toContain("18077363");
    // lengths should match (no pdbId in this mock)
    expect(res.body.citedPmids.length).toBe(res.body.sources.length);
  });
});
