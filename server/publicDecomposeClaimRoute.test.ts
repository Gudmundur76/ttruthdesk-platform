/**
 * publicDecomposeClaimRoute.test.ts
 * Tests for POST /api/public/decompose-claim — single and batch modes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockDecomposeQuestion: vi.fn(),
}));

vi.mock("./questionDecomposer", () => ({
  decomposeQuestion: mocks.mockDecomposeQuestion,
}));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

import express from "express";
import request from "supertest";
import {
  registerPublicDecomposeClaimRoute,
  checkRateLimit,
  isVerifiable,
  _resetRateLimitForTesting,
} from "./publicDecomposeClaimRoute";

function makeApp() {
  const app = express();
  app.use(express.json());
  registerPublicDecomposeClaimRoute(app as express.Express);
  return app;
}

function makeDecomposeResult(
  claims: Array<{ text: string; confidence?: number; method?: string }>
) {
  return {
    input: "test input",
    claims: claims.map((c, i) => ({
      text: c.text,
      confidence: c.confidence ?? 0.9,
      method: c.method ?? "heuristic",
      index: i,
    })),
    durationMs: 5,
    usedLlm: false,
  };
}

// ─── isVerifiable() ────────────────────────────────────────────────────────────
describe("isVerifiable()", () => {
  it("returns true for a normal scientific claim", () => {
    expect(
      isVerifiable("Darunavir shows IC50 of 0.003 nM against HIV-1 protease")
    ).toBe(true);
  });

  it("returns false for predicted pIC50 claims", () => {
    expect(
      isVerifiable(
        "Compound X shows predicted pIC50=8.7 against HIV-1 protease"
      )
    ).toBe(false);
  });

  it("returns false for in silico claims", () => {
    expect(
      isVerifiable("In silico docking shows binding energy of -9.2 kcal/mol")
    ).toBe(false);
  });

  it("returns false for computational prediction claims", () => {
    expect(isVerifiable("Computational prediction of Ki = 0.5 nM")).toBe(false);
  });

  it("returns false for docking score claims", () => {
    expect(isVerifiable("Docking score of -8.5 was obtained")).toBe(false);
  });

  it("returns false for SMILES: prefix claims", () => {
    expect(isVerifiable("SMILES: CC1=CC=CC=C1 shows activity")).toBe(false);
  });

  it("returns false for pIC50 = value pattern", () => {
    expect(isVerifiable("pIC50 = 7.3 for compound A")).toBe(false);
  });

  it("returns false for Ki = value nM pattern", () => {
    expect(isVerifiable("Ki = 0.1 nM for the inhibitor")).toBe(false);
  });

  it("returns true for experimental IC50 without 'predicted' prefix", () => {
    expect(
      isVerifiable("IC50 of 5 nM was measured by fluorescence assay")
    ).toBe(true);
  });
});

// ─── checkRateLimit() ─────────────────────────────────────────────────────────
describe("checkRateLimit()", () => {
  beforeEach(() => {
    _resetRateLimitForTesting();
    vi.clearAllMocks();
  });

  it("allows first request from a new IP", () => {
    const result = checkRateLimit("192.168.1.1");
    expect(result.allowed).toBe(true);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it("allows up to 20 requests per IP", () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 20; i++) {
      const r = checkRateLimit(ip);
      expect(r.allowed).toBe(true);
    }
  });

  it("blocks the 21st request from the same IP", () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < 20; i++) {
      checkRateLimit(ip);
    }
    const blocked = checkRateLimit(ip);
    expect(blocked.allowed).toBe(false);
  });

  it("treats different IPs independently", () => {
    const ip1 = "10.0.1.1";
    const ip2 = "10.0.1.2";
    for (let i = 0; i < 20; i++) checkRateLimit(ip1);
    const blocked = checkRateLimit(ip1);
    const allowed = checkRateLimit(ip2);
    expect(blocked.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });

  it("returns a resetAt in the future", () => {
    const before = Date.now();
    const result = checkRateLimit("203.0.113.1");
    expect(result.resetAt).toBeGreaterThan(before);
  });
});

// ─── OPTIONS preflight ────────────────────────────────────────────────────────
describe("OPTIONS /api/public/decompose-claim", () => {
  it("returns 204 for CORS preflight", async () => {
    const app = makeApp();
    const res = await request(app)
      .options("/api/public/decompose-claim")
      .set("Origin", "https://notus.is");
    expect(res.status).toBe(204);
  });
});

// ─── Single-claim mode ────────────────────────────────────────────────────────
describe("POST /api/public/decompose-claim — single mode", () => {
  beforeEach(() => {
    _resetRateLimitForTesting();
    vi.clearAllMocks();
  });

  it("returns 400 when claim is missing", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/public/decompose-claim").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 when claim is empty string", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claim: "   " });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 200 with decomposed claims on success", async () => {
    mocks.mockDecomposeQuestion.mockResolvedValue(
      makeDecomposeResult([
        { text: "Darunavir has IC50 of 0.003 nM" },
        { text: "Darunavir is approved for HIV treatment" },
      ])
    );
    const app = makeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({
        claim:
          "Darunavir has IC50 of 0.003 nM and is approved for HIV treatment",
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.claims).toHaveLength(2);
    expect(res.body.apiVersion).toBe("1.1");
    expect(typeof res.body.durationMs).toBe("number");
  });

  it("marks non-verifiable claims with verifiable=false", async () => {
    mocks.mockDecomposeQuestion.mockResolvedValue(
      makeDecomposeResult([
        { text: "predicted pIC50=8.7 against HIV-1 protease" },
        { text: "IC50 of 5 nM measured experimentally" },
      ])
    );
    const app = makeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claim: "test claim" });
    expect(res.status).toBe(200);
    const claims = res.body.claims;
    expect(claims[0].verifiable).toBe(false);
    expect(claims[1].verifiable).toBe(true);
  });

  it("truncates input to 2000 characters", async () => {
    mocks.mockDecomposeQuestion.mockResolvedValue(makeDecomposeResult([]));
    const longClaim = "x".repeat(3000);
    const app = makeApp();
    await request(app)
      .post("/api/public/decompose-claim")
      .send({ claim: longClaim });
    const [calledWith] = mocks.mockDecomposeQuestion.mock.calls[0];
    expect(calledWith.length).toBeLessThanOrEqual(2000);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const app = makeApp();
    // Exhaust rate limit
    for (let i = 0; i < 20; i++) {
      mocks.mockDecomposeQuestion.mockResolvedValue(makeDecomposeResult([]));
      await request(app)
        .post("/api/public/decompose-claim")
        .set("X-Forwarded-For", "1.2.3.4")
        .send({ claim: "test" });
    }
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .set("X-Forwarded-For", "1.2.3.4")
      .send({ claim: "test" });
    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
    expect(res.body.retryAfterMs).toBeGreaterThan(0);
  });

  it("returns 500 when decomposeQuestion throws", async () => {
    mocks.mockDecomposeQuestion.mockRejectedValue(new Error("LLM error"));
    const app = makeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claim: "some claim" });
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it("sets CORS headers on response", async () => {
    mocks.mockDecomposeQuestion.mockResolvedValue(makeDecomposeResult([]));
    const app = makeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .set("Origin", "https://notus.is")
      .send({ claim: "test" });
    expect(res.headers["access-control-allow-origin"]).toBeTruthy();
  });
});

// ─── Batch mode ───────────────────────────────────────────────────────────────
describe("POST /api/public/decompose-claim — batch mode", () => {
  beforeEach(() => {
    _resetRateLimitForTesting();
    vi.clearAllMocks();
  });

  it("returns 400 when claims array is empty", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claims: [] });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 when claims array exceeds 50 items", async () => {
    const app = makeApp();
    const claims = Array.from({ length: 51 }, (_, i) => `claim ${i}`);
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claims });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/50/);
  });

  it("returns 400 when claims contains non-string items", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claims: ["valid claim", 42, "another claim"] });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 200 with results array for valid batch", async () => {
    mocks.mockDecomposeQuestion.mockResolvedValue(
      makeDecomposeResult([{ text: "Darunavir IC50 0.003 nM" }])
    );
    const app = makeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claims: ["Claim A", "Claim B"] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.results).toHaveLength(2);
    expect(typeof res.body.totalClaims).toBe("number");
    expect(typeof res.body.totalVerifiable).toBe("number");
    expect(typeof res.body.totalFiltered).toBe("number");
    expect(res.body.apiVersion).toBe("1.1");
  });

  it("counts totalClaims and totalVerifiable correctly", async () => {
    mocks.mockDecomposeQuestion
      .mockResolvedValueOnce(
        makeDecomposeResult([
          { text: "Darunavir IC50 0.003 nM" },
          { text: "predicted pIC50=8.7" },
        ])
      )
      .mockResolvedValueOnce(
        makeDecomposeResult([{ text: "HIV protease inhibitor approved 2006" }])
      );
    const app = makeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claims: ["Claim A", "Claim B"] });
    expect(res.body.totalClaims).toBe(3);
    expect(res.body.totalVerifiable).toBe(2); // "predicted pIC50" is not verifiable
    expect(res.body.totalFiltered).toBe(1);
  });

  it("returns 500 on batch decomposition error", async () => {
    mocks.mockDecomposeQuestion.mockRejectedValue(new Error("batch error"));
    const app = makeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claims: ["Claim A"] });
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it("batch counts as one rate-limit hit", async () => {
    mocks.mockDecomposeQuestion.mockResolvedValue(makeDecomposeResult([]));
    const app = makeApp();
    // Send 20 batch requests (each counts as 1 hit)
    for (let i = 0; i < 20; i++) {
      _resetRateLimitForTesting();
      const res = await request(app)
        .post("/api/public/decompose-claim")
        .set("X-Forwarded-For", "5.5.5.5")
        .send({ claims: ["Claim A", "Claim B", "Claim C"] });
      expect(res.status).toBe(200);
    }
  });
});
