/**
 * inference.test.ts
 * Unit tests for the inference module — LocalClaimVerifier, modelServer, mcpServerLocal.
 * PRD_SKILLOPT_AGENT2MODEL §3 — all tests run without a real local model server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LocalClaimVerifier, getLocalClaimVerifier } from "./claimVerifier";
import {
  toolVerifyClaimLocal,
  toolVerifyClaimsBatchLocal,
  toolModelCapabilities,
  dispatchLocalMcpTool,
} from "./mcpServerLocal";
import { createModelServer } from "./modelServer";
import request from "supertest";

// ─── Mock fetch globally ──────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── LocalClaimVerifier ───────────────────────────────────────────────────────

describe("LocalClaimVerifier.verify()", () => {
  it("returns a valid result when model server responds correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          verdict: "Supported",
          confidence: 0.92,
          reasoning: "PDB entry 1ABC confirms resolution of 2.1 angstroms.",
        }),
      }),
    });

    const verifier = new LocalClaimVerifier(
      "http://127.0.0.1:8080",
      "test-model"
    );
    const result = await verifier.verify(
      "Protein 1ABC has a resolution of 2.1 angstroms."
    );

    expect(result.verdict).toBe("Supported");
    expect(result.confidence).toBe(0.92);
    expect(result.source).toBe("local_model");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns fallback result when model server is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const verifier = new LocalClaimVerifier(
      "http://127.0.0.1:8080",
      "test-model"
    );
    const result = await verifier.verify("Some claim.");

    expect(result.verdict).toBe("Insufficient Evidence");
    expect(result.source).toBe("fallback");
    expect(result.confidence).toBe(0.1);
  });

  it("returns fallback result when model server returns non-JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: "not valid json at all" }),
    });

    const verifier = new LocalClaimVerifier(
      "http://127.0.0.1:8080",
      "test-model"
    );
    const result = await verifier.verify("Some claim.");

    expect(result.source).toBe("fallback");
  });

  it("clamps confidence to valid range [0, 1]", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          verdict: "Supported",
          confidence: 1.5, // out of range
          reasoning: "Test.",
        }),
      }),
    });

    const verifier = new LocalClaimVerifier(
      "http://127.0.0.1:8080",
      "test-model"
    );
    const result = await verifier.verify("Some claim.");

    // Parser falls back to 0.5 for out-of-range confidence
    expect(result.confidence).toBe(0.5);
  });

  it("normalises unknown verdict to Insufficient Evidence", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          verdict: "UNKNOWN_VERDICT",
          confidence: 0.7,
          reasoning: "Test.",
        }),
      }),
    });

    const verifier = new LocalClaimVerifier(
      "http://127.0.0.1:8080",
      "test-model"
    );
    const result = await verifier.verify("Some claim.");

    expect(result.verdict).toBe("Insufficient Evidence");
  });
});

describe("LocalClaimVerifier.ping()", () => {
  it("returns true when Ollama /api/tags responds ok with model listed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "test-model:latest" }] }),
    });
    const verifier = new LocalClaimVerifier(
      "http://127.0.0.1:8080",
      "test-model"
    );
    expect(await verifier.ping()).toBe(true);
  });

  it("returns false when Ollama /api/tags is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const verifier = new LocalClaimVerifier(
      "http://127.0.0.1:8080",
      "test-model"
    );
    expect(await verifier.ping()).toBe(false);
  });

  it("returns false when Ollama /api/tags returns non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const verifier = new LocalClaimVerifier(
      "http://127.0.0.1:8080",
      "test-model"
    );
    expect(await verifier.ping()).toBe(false);
  });
});

describe("LocalClaimVerifier.getCapabilities()", () => {
  it("returns available=true and domain list when server is up", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "test-model:latest" }] }),
    }); // isHealthy
    const verifier = new LocalClaimVerifier(
      "http://127.0.0.1:8080",
      "test-model"
    );
    const caps = await verifier.getCapabilities();

    expect(caps.available).toBe(true);
    expect(caps.domains).toContain("structural_biology");
    expect(caps.domains).toContain("clinical_medicine");
    expect(caps.modelSizeMb).toBe(3072);
  });

  it("returns available=false and empty domains when server is down", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const verifier = new LocalClaimVerifier(
      "http://127.0.0.1:8080",
      "test-model"
    );
    const caps = await verifier.getCapabilities();

    expect(caps.available).toBe(false);
    expect(caps.domains).toHaveLength(0);
  });
});

// ─── mcpServerLocal.ts ────────────────────────────────────────────────────────

describe("toolVerifyClaimLocal()", () => {
  it("returns error for missing claimText", async () => {
    const result = await toolVerifyClaimLocal({});
    expect(result.success).toBe(false);
    expect(result.error).toContain("claimText");
  });

  it("returns error for empty claimText", async () => {
    const result = await toolVerifyClaimLocal({ claimText: "   " });
    expect(result.success).toBe(false);
  });

  it("returns error for claimText exceeding 2000 chars", async () => {
    const result = await toolVerifyClaimLocal({ claimText: "x".repeat(2001) });
    expect(result.success).toBe(false);
    expect(result.error).toContain("2000");
  });

  it("returns success with verification result for valid input", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED")); // model server down → fallback
    const result = await toolVerifyClaimLocal({
      claimText: "A valid claim text.",
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });
});

describe("toolVerifyClaimsBatchLocal()", () => {
  it("returns error when claims is not an array", async () => {
    const result = await toolVerifyClaimsBatchLocal({ claims: "not an array" });
    expect(result.success).toBe(false);
  });

  it("returns empty array for empty claims array", async () => {
    const result = await toolVerifyClaimsBatchLocal({ claims: [] });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("returns error for batch exceeding 50 claims", async () => {
    const claims = Array.from({ length: 51 }, (_, i) => ({
      claimText: `Claim ${i}`,
    }));
    const result = await toolVerifyClaimsBatchLocal({ claims });
    expect(result.success).toBe(false);
    expect(result.error).toContain("50");
  });

  it("returns error when a claim in the batch has invalid claimText", async () => {
    const result = await toolVerifyClaimsBatchLocal({
      claims: [{ claimText: "Valid" }, { claimText: "" }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("claims[1]");
  });

  it("returns results array for valid batch", async () => {
    // Model server down → all fallback results
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await toolVerifyClaimsBatchLocal({
      claims: [{ claimText: "Claim A" }, { claimText: "Claim B" }],
    });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as unknown[]).length).toBe(2);
  });
});

describe("toolModelCapabilities()", () => {
  it("returns capabilities object", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED")); // server down
    const result = await toolModelCapabilities({});
    expect(result.success).toBe(true);
    const caps = result.data as { available: boolean; modelId: string };
    expect(typeof caps.available).toBe("boolean");
    expect(typeof caps.modelId).toBe("string");
  });
});

describe("dispatchLocalMcpTool()", () => {
  it("returns error for unknown tool name", async () => {
    const result = await dispatchLocalMcpTool("unknown_tool", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown_tool");
  });

  it("dispatches to verify_claim_local correctly", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await dispatchLocalMcpTool("verify_claim_local", {
      claimText: "Test claim.",
    });
    expect(result.success).toBe(true);
  });

  it("dispatches to model_capabilities correctly", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await dispatchLocalMcpTool("model_capabilities", {});
    expect(result.success).toBe(true);
  });
});

// ─── modelServer.ts ───────────────────────────────────────────────────────────

describe("createModelServer()", () => {
  it("GET /health returns status field", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED")); // ping fails
    const app = createModelServer();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("modelId");
  });

  it("GET /capabilities returns domains array", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const app = createModelServer();
    const res = await request(app).get("/capabilities");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("domains");
  });

  it("POST /verify returns 400 for missing claimText", async () => {
    const app = createModelServer();
    const res = await request(app).post("/verify").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("claimText");
  });

  it("POST /verify returns 400 for claimText exceeding 2000 chars", async () => {
    const app = createModelServer();
    const res = await request(app)
      .post("/verify")
      .send({ claimText: "x".repeat(2001) });
    expect(res.status).toBe(400);
  });

  it("POST /verify returns result for valid claimText", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED")); // model server down → fallback
    const app = createModelServer();
    const res = await request(app)
      .post("/verify")
      .send({ claimText: "A valid scientific claim." });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("verdict");
    expect(res.body).toHaveProperty("confidence");
  });

  it("POST /verify/batch returns 400 for non-array claims", async () => {
    const app = createModelServer();
    const res = await request(app)
      .post("/verify/batch")
      .send({ claims: "not an array" });
    expect(res.status).toBe(400);
  });

  it("POST /verify/batch returns empty array for empty claims", async () => {
    const app = createModelServer();
    const res = await request(app).post("/verify/batch").send({ claims: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("GET /unknown returns 404", async () => {
    const app = createModelServer();
    const res = await request(app).get("/unknown-route");
    expect(res.status).toBe(404);
  });
});
