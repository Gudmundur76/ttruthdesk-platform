/**
 * publicV1VerifyRoute.test.ts
 *
 * Tests for POST /v1/verify — the cognitive-loop-framework integration endpoint.
 * Covers: auth gating, 503 when key unset, verdict normalisation, sources array,
 * bad input rejection, and upstream error propagation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mock ENV using vi.hoisted so the object is available before vi.mock runs ─
const mockEnv = vi.hoisted(() => ({ citationApiKey: "test-secret-key-abc123" }));
vi.mock("./_core/env", () => ({ ENV: mockEnv }));

// ─── Mock global fetch ────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Import under test (after mocks are in place) ─────────────────────────────
import { registerV1VerifyRoute } from "./publicV1VerifyRoute";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  registerV1VerifyRoute(app);
  return app;
}

function mockUpstream(
  verdict: string,
  confidenceScore: number,
  pubmedResults: Array<{ pmid?: string }> = [],
  pdbId: string | null = null
): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      ok: true,
      verdict,
      confidenceScore,
      pubmedResults,
      pdbId,
      apiVersion: "1.3",
    }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /v1/verify", () => {
  let app: express.Express;

  beforeEach(() => {
    mockEnv.citationApiKey = "test-secret-key-abc123";
    mockFetch.mockReset();
    app = makeApp();
  });

  // ── 503 when key unset ──────────────────────────────────────────────────────
  it("returns 503 when CITATION_API_KEY is not configured", async () => {
    mockEnv.citationApiKey = "";
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer anything")
      .send({ claim: "test claim" });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/CITATION_API_KEY/);
  });

  // ── Auth gating ─────────────────────────────────────────────────────────────
  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/v1/verify")
      .send({ claim: "test claim" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer token is wrong", async () => {
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer wrong-token")
      .send({ claim: "test claim" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization scheme is not Bearer", async () => {
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Basic dXNlcjpwYXNz")
      .send({ claim: "test claim" });
    expect(res.status).toBe(401);
  });

  // ── Input validation ────────────────────────────────────────────────────────
  it("returns 400 when claim is missing", async () => {
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-secret-key-abc123")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/claim/i);
  });

  it("returns 400 when claim is empty string", async () => {
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-secret-key-abc123")
      .send({ claim: "   " });
    expect(res.status).toBe(400);
  });

  // ── Verdict normalisation ───────────────────────────────────────────────────
  const verdictCases: [string, string][] = [
    ["Supported", "Supported"],
    ["Partially Supported", "Supported"],
    ["Contradicted", "Contradicted"],
    ["Ambiguous", "Ambiguous"],
    ["Insufficient Evidence", "Ambiguous"],
    ["Needs Expert Review", "Ambiguous"],
    ["Out of Scope", "Ambiguous"],
    ["UnknownVerdict", "Ambiguous"],
  ];

  it.each(verdictCases)(
    "normalises internal verdict '%s' to '%s'",
    async (internal, expected) => {
      mockUpstream(internal, 0.8);
      const res = await request(app)
        .post("/v1/verify")
        .set("Authorization", "Bearer test-secret-key-abc123")
        .send({ claim: "BRCA1 forms a heterodimer with BARD1" });
      expect(res.status).toBe(200);
      expect(res.body.verdict).toBe(expected);
    }
  );

  // ── Sources array ───────────────────────────────────────────────────────────
  it("builds sources array from pubmedResults and pdbId", async () => {
    mockUpstream(
      "Supported",
      0.9,
      [{ pmid: "12345678" }, { pmid: "23456789" }],
      "1ABC"
    );
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-secret-key-abc123")
      .send({ claim: "HIV-1 protease is a homodimeric aspartyl protease" });
    expect(res.status).toBe(200);
    expect(res.body.sources).toContain("pubmed:12345678");
    expect(res.body.sources).toContain("pubmed:23456789");
    expect(res.body.sources).toContain("pdb:1ABC");
  });

  it("returns empty sources array when no pubmedResults and no pdbId", async () => {
    mockUpstream("Ambiguous", 0.4, [], null);
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-secret-key-abc123")
      .send({ claim: "Some obscure claim with no evidence" });
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([]);
  });

  // ── confidenceScore passthrough ─────────────────────────────────────────────
  it("passes confidenceScore through from upstream", async () => {
    mockUpstream("Supported", 0.87);
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-secret-key-abc123")
      .send({ claim: "PCSK9 inhibitors reduce LDL cholesterol" });
    expect(res.status).toBe(200);
    expect(res.body.confidenceScore).toBe(0.87);
  });

  // ── context → vertical routing ──────────────────────────────────────────────
  it("routes molecular_evolution context to hiv_protease vertical", async () => {
    mockUpstream("Supported", 0.9);
    await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-secret-key-abc123")
      .send({
        claim: "C[C@H](NC(=O)C1CC1) shows inhibition of HIV-1 protease",
        context: "molecular_evolution",
      });
    const callBody = JSON.parse(
      mockFetch.mock.calls[0][1].body as string
    ) as Record<string, unknown>;
    expect(callBody["vertical"]).toBe("hiv_protease");
  });

  it("routes non-molecular_evolution context to structural_biology vertical", async () => {
    mockUpstream("Supported", 0.85);
    await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-secret-key-abc123")
      .send({ claim: "BRCA1 localises to the nucleus", context: "general" });
    const callBody = JSON.parse(
      mockFetch.mock.calls[0][1].body as string
    ) as Record<string, unknown>;
    expect(callBody["vertical"]).toBe("structural_biology");
  });

  // ── Upstream error propagation ──────────────────────────────────────────────
  it("returns 429 when upstream rate-limits", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "Rate limit exceeded", retryAfterMs: 5000 }),
    });
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-secret-key-abc123")
      .send({ claim: "test claim" });
    expect(res.status).toBe(429);
  });

  it("returns 502 when upstream fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
    const res = await request(app)
      .post("/v1/verify")
      .set("Authorization", "Bearer test-secret-key-abc123")
      .send({ claim: "test claim" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Connection refused/);
  });

  // ── CORS preflight ──────────────────────────────────────────────────────────
  it("responds 204 to OPTIONS preflight", async () => {
    const res = await request(app)
      .options("/v1/verify")
      .set("Origin", "https://notus.is")
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});
