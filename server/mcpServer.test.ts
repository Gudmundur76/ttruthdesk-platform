/**
 * mcpServer.test.ts
 *
 * Tests for the MCP server implementation (Phase 112).
 * Covers:
 *   - Rate limiter logic (bucket creation, increment, reset, per-tool isolation)
 *   - buildCapabilities structure and protocol compliance
 *   - Tool registry completeness and schema validity
 *   - MCP error code constants
 *   - mcpServerFingerprint determinism
 *   - Tool input validation (invalid params → correct error codes)
 *   - Tool handler isolation (DB unavailable → graceful fallback)
 *   - Auth bypass for rate limiting
 */

import { createHash } from "crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkMcpRateLimit,
  buildCapabilities,
  TOOLS,
  MCP_ERRORS,
  ANON_LIMIT,
  ANON_WINDOW_MS,
  mcpServerFingerprint,
} from "./mcpServer";

// ─── Mock DB helpers ──────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getClaimById: vi.fn(),
  getPaginatedPublicClaims: vi.fn(),
  getSourceVersion: vi.fn(),
  insertQuestion: vi.fn(),
}));

vi.mock("./questionRouter", () => ({
  processQuestion: vi.fn(),
}));

vi.mock("./apiKeyService", () => ({
  validateApiKey: vi.fn(),
}));

// ─── Rate Limiter ─────────────────────────────────────────────────────────────
describe("checkMcpRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first request for a new IP+tool combination", () => {
    const result = checkMcpRateLimit("1.2.3.4", "verify_claim");
    expect(result.allowed).toBe(true);
  });

  it("tracks requests per IP per tool independently", () => {
    const ip = "10.0.0.1";
    // Use up the limit for verify_claim
    for (let i = 0; i < ANON_LIMIT; i++) {
      checkMcpRateLimit(ip, "verify_claim");
    }
    const blocked = checkMcpRateLimit(ip, "verify_claim");
    expect(blocked.allowed).toBe(false);

    // search_claims should still be allowed for the same IP
    const other = checkMcpRateLimit(ip, "search_claims");
    expect(other.allowed).toBe(true);
  });

  it("blocks after ANON_LIMIT requests within the window", () => {
    const ip = `rl-test-${Date.now()}`;
    for (let i = 0; i < ANON_LIMIT; i++) {
      const r = checkMcpRateLimit(ip, "ask_question");
      expect(r.allowed).toBe(true);
    }
    const blocked = checkMcpRateLimit(ip, "ask_question");
    expect(blocked.allowed).toBe(false);
  });

  it("resets after the window expires", () => {
    const ip = `rl-reset-${Date.now()}`;
    for (let i = 0; i < ANON_LIMIT; i++) {
      checkMcpRateLimit(ip, "get_claim");
    }
    expect(checkMcpRateLimit(ip, "get_claim").allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(ANON_WINDOW_MS + 1);

    const afterReset = checkMcpRateLimit(ip, "get_claim");
    expect(afterReset.allowed).toBe(true);
  });

  it("returns a resetAt timestamp in the future", () => {
    const before = Date.now();
    const result = checkMcpRateLimit(`ts-test-${Date.now()}`, "search_claims");
    expect(result.resetAt).toBeGreaterThan(before);
    expect(result.resetAt).toBeLessThanOrEqual(before + ANON_WINDOW_MS + 100);
  });

  it("ANON_LIMIT is 10 and ANON_WINDOW_MS is 1 hour", () => {
    expect(ANON_LIMIT).toBe(10);
    expect(ANON_WINDOW_MS).toBe(60 * 60 * 1000);
  });
});

// ─── buildCapabilities ────────────────────────────────────────────────────────
describe("buildCapabilities", () => {
  it("returns a valid MCP capabilities object", () => {
    const caps = buildCapabilities();
    expect(caps.protocolVersion).toBe("2025-03-26");
    expect(caps.serverInfo.name).toBe("citation.is");
    expect(caps.capabilities.tools).toBeDefined();
    expect(Array.isArray(caps.tools)).toBe(true);
  });

  it("includes all 5 tools in the capabilities response", () => {
    const caps = buildCapabilities();
    const names = caps.tools.map(t => t.name);
    expect(names).toContain("verify_claim");
    expect(names).toContain("search_claims");
    expect(names).toContain("get_claim");
    expect(names).toContain("get_source_version");
    expect(names).toContain("ask_question");
    expect(names).toHaveLength(5);
  });

  it("every tool has a description and inputSchema", () => {
    const caps = buildCapabilities();
    for (const tool of caps.tools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it("authentication section is present", () => {
    const caps = buildCapabilities();
    expect(caps.authentication).toBeDefined();
    expect(caps.authentication.schemes).toContain("Bearer");
  });
});

// ─── Tool Registry ────────────────────────────────────────────────────────────
describe("TOOLS registry", () => {
  it("contains exactly 5 tools", () => {
    expect(Object.keys(TOOLS)).toHaveLength(5);
  });

  it("every tool has a handler function", () => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      expect(typeof tool.handler, `${name}.handler`).toBe("function");
    }
  });

  it("every tool inputSchema has required as an array", () => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      expect(Array.isArray(tool.inputSchema.required), `${name}.inputSchema.required`).toBe(true);
    }
  });

  it("verify_claim requires 'claim' parameter", () => {
    const schema = TOOLS["verify_claim"].inputSchema;
    expect((schema.required as string[])).toContain("claim");
  });

  it("search_claims requires 'query' parameter", () => {
    const schema = TOOLS["search_claims"].inputSchema;
    expect((schema.required as string[])).toContain("query");
  });

  it("get_claim requires 'claim_id' parameter", () => {
    const schema = TOOLS["get_claim"].inputSchema;
    expect((schema.required as string[])).toContain("claim_id");
  });

  it("get_source_version requires 'source_id' parameter", () => {
    const schema = TOOLS["get_source_version"].inputSchema;
    expect((schema.required as string[])).toContain("source_id");
  });

  it("ask_question requires 'question' parameter", () => {
    const schema = TOOLS["ask_question"].inputSchema;
    expect((schema.required as string[])).toContain("question");
  });
});

// ─── MCP Error Codes ──────────────────────────────────────────────────────────
describe("MCP_ERRORS", () => {
  it("follows JSON-RPC 2.0 standard error codes", () => {
    expect(MCP_ERRORS.PARSE_ERROR).toBe(-32700);
    expect(MCP_ERRORS.INVALID_REQUEST).toBe(-32600);
    expect(MCP_ERRORS.METHOD_NOT_FOUND).toBe(-32601);
    expect(MCP_ERRORS.INVALID_PARAMS).toBe(-32602);
    expect(MCP_ERRORS.INTERNAL_ERROR).toBe(-32603);
  });

  it("uses application-defined codes for domain errors", () => {
    expect(MCP_ERRORS.RATE_LIMITED).toBe(-32000);
    expect(MCP_ERRORS.NOT_FOUND).toBe(-32001);
  });
});

// ─── mcpServerFingerprint ─────────────────────────────────────────────────────
describe("mcpServerFingerprint", () => {
  it("returns a 16-character hex string", () => {
    const fp = mcpServerFingerprint();
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic across calls", () => {
    expect(mcpServerFingerprint()).toBe(mcpServerFingerprint());
  });

  it("changes if tool names change (structural integrity check)", () => {
    // The fingerprint is a hash of sorted tool names
    // If we add/remove tools, the fingerprint must change
    const fp = mcpServerFingerprint();
    expect(fp).toBeTruthy();
    // Verify it encodes the 5 known tools
    const expected = createHash("sha256")
      .update(["ask_question", "get_claim", "get_source_version", "search_claims", "verify_claim"].join(","))
      .digest("hex")
      .slice(0, 16);
    expect(fp).toBe(expected);
  });
});

// ─── Tool: get_source_version (DB unavailable) ───────────────────────────────
describe("get_source_version tool", () => {
  it("returns neverChecked=true when DB returns null", async () => {
    const { getSourceVersion } = await import("./db");
    vi.mocked(getSourceVersion).mockResolvedValueOnce(null);

    const handler = TOOLS["get_source_version"].handler;
    const result = await handler({ source_id: "pubmed" }, {} as never) as Record<string, unknown>;

    expect(result["neverChecked"]).toBe(true);
    expect(result["sourceId"]).toBe("pubmed");
    expect(result["currentVersionHash"]).toBeNull();
  });

  it("throws INVALID_PARAMS when source_id is missing", async () => {
    const handler = TOOLS["get_source_version"].handler;
    await expect(handler({}, {} as never)).rejects.toMatchObject({
      code: MCP_ERRORS.INVALID_PARAMS,
    });
  });

  it("throws INVALID_PARAMS when source_id is empty string", async () => {
    const handler = TOOLS["get_source_version"].handler;
    await expect(handler({ source_id: "" }, {} as never)).rejects.toMatchObject({
      code: MCP_ERRORS.INVALID_PARAMS,
    });
  });

  it("returns structured version data when DB has a record", async () => {
    const { getSourceVersion } = await import("./db");
    vi.mocked(getSourceVersion).mockResolvedValueOnce({
      id: 1,
      sourceId: "opencitations",
      versionHash: "abc123def456",
      versionLabel: "v2024-12",
      detectedAt: 1700000000,
      changeType: "major",
      affectedClaimCount: 42,
    });

    const handler = TOOLS["get_source_version"].handler;
    const result = await handler({ source_id: "opencitations" }, {} as never) as Record<string, unknown>;

    expect(result["sourceId"]).toBe("opencitations");
    expect(result["currentVersionHash"]).toBe("abc123def456");
    expect(result["changeType"]).toBe("major");
    expect(result["affectedClaimCount"]).toBe(42);
    expect(result["neverChecked"]).toBe(false);
    expect(typeof result["lastChecked"]).toBe("string");
  });
});

// ─── Tool: get_claim ──────────────────────────────────────────────────────────
describe("get_claim tool", () => {
  it("throws NOT_FOUND when claim does not exist", async () => {
    const { getClaimById } = await import("./db");
    vi.mocked(getClaimById).mockResolvedValueOnce(null);

    const handler = TOOLS["get_claim"].handler;
    await expect(handler({ claim_id: 99999 }, {} as never)).rejects.toMatchObject({
      code: MCP_ERRORS.NOT_FOUND,
    });
  });

  it("throws INVALID_PARAMS for non-numeric claim_id", async () => {
    const handler = TOOLS["get_claim"].handler;
    await expect(handler({ claim_id: "not-a-number" }, {} as never)).rejects.toMatchObject({
      code: MCP_ERRORS.INVALID_PARAMS,
    });
  });

  it("throws INVALID_PARAMS for zero claim_id", async () => {
    const handler = TOOLS["get_claim"].handler;
    await expect(handler({ claim_id: 0 }, {} as never)).rejects.toMatchObject({
      code: MCP_ERRORS.INVALID_PARAMS,
    });
  });

  it("accepts numeric string claim_id", async () => {
    const { getClaimById } = await import("./db");
    // Cast to avoid specifying all 30+ schema fields — we only care about the fields
    // the handler reads (id, verdict, confidenceScore, claimText, etc.)
    vi.mocked(getClaimById).mockResolvedValueOnce({
      id: 42,
      claimText: "Salmon PAX7 binds muscle-specific enhancers",
      claimType: "protein_name" as const,
      extractedValue: "PAX7",
      verdict: "Supported" as const,
      verdictRationale: "Supported by PubMed:12345",
      confidenceScore: 0.87,
      verdictMethod: "deterministic_source" as const,
      pdbId: null,
      pdbEvidenceUrl: null,
      documentId: 1,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-06-01"),
      // Required nullable fields
      proteinName: null,
      experimentalMethod: null,
      resolution: null,
      organism: null,
      ligand: null,
      pdbEvidenceRaw: null,
      pdbEvidenceCheckedAt: null,
      confidenceFlags: null,
      sourceCompletenessScore: null,
      sourcePassage: null,
      passageConfidence: null,
      compositeLabel: null,
      compositeLabelUpdatedAt: null,
      compositeLabelMethod: null,
      reEvalQueuedAt: null,
      reEvalReason: null,
      reEvalCount: 0,
      lastReEvalAt: null,
      verticalDomain: null,
      verticalScore: null,
      verticalEvidence: null,
      verticalCheckedAt: null,
      passageStartChar: null,
      passageEndChar: null,
      misrepresentationType: null,
      compositeTruthScore: null,
    } as unknown as NonNullable<Awaited<ReturnType<typeof getClaimById>>>);

    const handler = TOOLS["get_claim"].handler;
    const result = await handler({ claim_id: "42" }, {} as never) as Record<string, unknown>;

    expect(result["claimId"]).toBe("42");
    expect(result["verdict"]).toBe("Supported");
    expect(result["confidence"]).toBe(0.87);
  });
});

// ─── Tool: search_claims ──────────────────────────────────────────────────────
describe("search_claims tool", () => {
  it("throws INVALID_PARAMS when query is empty", async () => {
    const handler = TOOLS["search_claims"].handler;
    await expect(handler({ query: "" }, {} as never)).rejects.toMatchObject({
      code: MCP_ERRORS.INVALID_PARAMS,
    });
  });

  it("throws INVALID_PARAMS when query is missing", async () => {
    const handler = TOOLS["search_claims"].handler;
    await expect(handler({}, {} as never)).rejects.toMatchObject({
      code: MCP_ERRORS.INVALID_PARAMS,
    });
  });

  it("returns paginated results from DB", async () => {
    const { getPaginatedPublicClaims } = await import("./db");
    vi.mocked(getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          claimText: "PAX7 is expressed in satellite cells",
          claimType: "gene_expression",
          extractedValue: "PAX7",
          pdbId: null,
          verdict: "Supported" as const,
          verdictRationale: "Multiple PubMed papers confirm",
          confidenceScore: 0.9,
          verdictMethod: "deterministic_source" as const,
          pdbEvidenceUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          documentId: 1,
          documentTitle: "Test Doc",
          verticalDomain: "biotech",
        },
      ],
      total: 1,
      totalPages: 1,
    });

    const handler = TOOLS["search_claims"].handler;
    const result = await handler({ query: "PAX7 satellite cells" }, {} as never) as Record<string, unknown>;

    expect(result["total"]).toBe(1);
    const claims = result["claims"] as Array<Record<string, unknown>>;
    expect(claims).toHaveLength(1);
    expect(claims[0]["verdict"]).toBe("Supported");
  });

  it("applies min_confidence filter", async () => {
    const { getPaginatedPublicClaims } = await import("./db");
    vi.mocked(getPaginatedPublicClaims).mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          claimText: "Low confidence claim",
          claimType: "general_molecular" as const,
          extractedValue: null,
          pdbId: null,
          verdict: "Insufficient Evidence" as const,
          verdictRationale: null,
          confidenceScore: 0.3,
          verdictMethod: null,
          pdbEvidenceUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          documentId: 1,
          documentTitle: "Test",
          verticalDomain: "biotech",
        },
      ],
      total: 1,
      totalPages: 1,
    });

    const handler = TOOLS["search_claims"].handler;
    const result = await handler({ query: "test", min_confidence: 0.7 }, {} as never) as Record<string, unknown>;

    // The low-confidence claim should be filtered out
    const claims = result["claims"] as Array<Record<string, unknown>>;
    expect(claims).toHaveLength(0);
  });
});

// ─── Tool: ask_question ───────────────────────────────────────────────────────
describe("ask_question tool", () => {
  it("throws INVALID_PARAMS when question is empty", async () => {
    const handler = TOOLS["ask_question"].handler;
    await expect(handler({ question: "" }, {} as never)).rejects.toMatchObject({
      code: MCP_ERRORS.INVALID_PARAMS,
    });
  });

  it("throws INVALID_PARAMS when question exceeds 1000 chars", async () => {
    const handler = TOOLS["ask_question"].handler;
    await expect(handler({ question: "x".repeat(1001) }, {} as never)).rejects.toMatchObject({
      code: MCP_ERRORS.INVALID_PARAMS,
    });
  });

  it("returns structured answer from processQuestion", async () => {
    const { processQuestion } = await import("./questionRouter");
    vi.mocked(processQuestion).mockResolvedValueOnce({
      questionText: "Does salmon PAX7 bind muscle enhancers?",
      derivedClaim: "Salmon PAX7 protein binds to muscle-specific enhancers",
      verdict: "Supported" as const,
      confidence: 0.82,
      rationale: "Supported by 3 PubMed papers",
      sources: [{ pmid: "12345", url: "https://pubmed.ncbi.nlm.nih.gov/12345/" }],
      loopTriggered: false,
      processedAt: "2024-06-13T00:00:00.000Z",
    });

    const handler = TOOLS["ask_question"].handler;
    const result = await handler(
      { question: "Does salmon PAX7 bind muscle enhancers?" },
      {} as never
    ) as Record<string, unknown>;

    expect(result["verdict"]).toBe("Supported");
    expect(result["confidence"]).toBe(0.82);
    expect(result["loopTriggered"]).toBe(false);
    expect(result["derivedClaim"]).toContain("PAX7");
  });
});
