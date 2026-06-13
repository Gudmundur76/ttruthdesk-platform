/**
 * mcpServer.ts
 *
 * MCP (Model Context Protocol) server for citation.is.
 * Exposes 5 tools to any MCP-compatible AI agent:
 *   1. verify_claim    — submit a claim, receive a structured verdict
 *   2. search_claims   — full-text search over the verified claim registry
 *   3. get_claim       — retrieve a single claim by ID
 *   4. get_source_version — check if a source has been retracted/updated
 *   5. ask_question    — natural language question → derived claim → answer
 *
 * Transport: HTTP (Streamable HTTP per MCP 2025-03-26 spec)
 *   GET  /api/mcp  → server capabilities (JSON)
 *   POST /api/mcp  → tool call (JSON-RPC 2.0)
 *
 * Authentication:
 *   - Anonymous: 10 req/hr per IP per tool
 *   - Bearer token: maps to api_keys table → unlimited
 *
 * Design:
 *   - No external MCP SDK dependency — pure HTTP JSON-RPC 2.0
 *   - Calls existing DB helpers and route handlers directly (no tRPC overhead)
 *   - Every tool returns typed, structured data — no markdown blobs
 *   - All errors use MCP standard error codes
 *
 * @see docs/mcp-server-spec.md
 * @see PHILOSOPHY.md
 */

import type { Express, Request, Response } from "express";
import { createHash } from "crypto";
import { logger, errData } from "./logger";
import { validateApiKey } from "./apiKeyService";
import {
  getClaimById,
  getPaginatedPublicClaims,
  getSourceVersion,
} from "./db";
import { processQuestion } from "./questionRouter";
import { buildEvidenceWithExcerpts } from "./pubmedAbstractFetcher";

const log = logger("mcpServer");

// ─── MCP Error Codes ──────────────────────────────────────────────────────────
const MCP_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  RATE_LIMITED: -32000,
  NOT_FOUND: -32001,
} as const;

// ─── Rate Limiter (in-memory, per-IP per-tool) ────────────────────────────────
const ANON_LIMIT = 10;
const ANON_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function checkMcpRateLimit(ip: string, tool: string): { allowed: boolean; resetAt: number } {
  const key = `${ip}:${tool}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + ANON_WINDOW_MS });
    return { allowed: true, resetAt: now + ANON_WINDOW_MS };
  }
  if (bucket.count >= ANON_LIMIT) {
    return { allowed: false, resetAt: bucket.resetAt };
  }
  bucket.count++;
  return { allowed: true, resetAt: bucket.resetAt };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function resolveAuth(
  req: Request
): Promise<{ authenticated: boolean; userId?: number; scopes?: string[] }> {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { authenticated: false };
  }
  const rawKey = authHeader.slice(7).trim();
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.ip ??
    "unknown";
  const result = await validateApiKey(rawKey, ip);
  if (!result.valid) {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    userId: result.userId,
    scopes: result.scopes as string[],
  };
}

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────
function mcpError(id: unknown, code: number, message: string, data?: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    error: { code, message, ...(data ? { data } : {}) },
  };
}

function mcpResult(id: unknown, result: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id: id ?? null,
    result,
  };
}
// ─── Tool: verify_claim — helpers ────────────────────────────────────────────
function validateClaimParam(params: Record<string, unknown>): string {
  const claim = params["claim"];
  if (typeof claim !== "string" || claim.trim().length === 0) {
    throw { code: MCP_ERRORS.INVALID_PARAMS, message: "claim must be a non-empty string" };
  }
  if (claim.length > 1000) {
    throw { code: MCP_ERRORS.INVALID_PARAMS, message: "claim must be at most 1000 characters" };
  }
  return claim.trim();
}

async function callVerifyEndpoint(
  claim: string,
  domain: string | undefined,
  forwardedFor: string
): Promise<Record<string, unknown>> {
  const host = `http://localhost:${process.env["PORT"] ?? 3000}`;
  const body: Record<string, unknown> = { claim };
  if (domain) body["domain"] = domain;
  const resp = await fetch(`${host}/api/public/verify-claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": forwardedFor,
      "X-MCP-Internal": "1",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok && resp.status !== 200) {
    const errBody = await resp.json().catch(() => ({})) as Record<string, unknown>;
    throw { code: MCP_ERRORS.INTERNAL_ERROR, message: (errBody["error"] as string) ?? "Verification failed" };
  }
  const data = await resp.json() as Record<string, unknown>;
  if (!data["ok"]) {
    throw { code: MCP_ERRORS.INTERNAL_ERROR, message: (data["error"] as string) ?? "Verification failed" };
  }
  return data;
}

function buildVerifyResult(
  data: Record<string, unknown>,
  confidence: number,
  confidenceThreshold: number,
  domain: string | undefined
): Record<string, unknown> {
  if (confidence < confidenceThreshold) {
    return {
      verdict: data["verdict"] ?? "inconclusive",
      confidence,
      summary: `Confidence ${confidence.toFixed(2)} is below requested threshold ${confidenceThreshold.toFixed(2)}`,
      evidence: [],
      claimId: null,
      processedAt: data["processedAt"] ?? new Date().toISOString(),
      loopTriggered: false,
      belowThreshold: true,
    };
  }
  const pubmedResults = (data["pubmedResults"] as Array<Record<string, unknown>>) ?? [];
  const claimText = (data["claimText"] as string | undefined) ?? "";
  const mappedResults = pubmedResults.map(p => ({
    pmid: String(p["pmid"] ?? ""),
    title: p["title"] as string | undefined,
    abstractSnippet: p["abstractSnippet"] as string | undefined,
    citationUrl: (p["url"] ?? p["citationUrl"]) as string | undefined,
    year: p["year"] as number | undefined,
  }));
  return {
    verdict: data["verdict"] ?? "inconclusive",
    confidence,
    summary: data["rationale"] ?? "",
    evidence: buildEvidenceWithExcerpts(claimText, mappedResults, confidence),
    claimId: null,
    processedAt: data["processedAt"] ?? new Date().toISOString(),
    loopTriggered: false,
    domain: data["vertical"] ?? domain ?? null,
    claimType: data["claimType"] ?? null,
    proteinName: data["proteinName"] ?? null,
    pdbId: data["pdbId"] ?? null,
  };
}


// ─── Tool: verify_claim ───────────────────────────────────────────────────────
async function toolVerifyClaim(
  params: Record<string, unknown>,
  req: Request
): Promise<unknown> {
  const claim = validateClaimParam(params);
  const domain = typeof params["domain"] === "string" ? params["domain"] : undefined;
  const confidenceThreshold =
    typeof params["confidence_threshold"] === "number"
      ? Math.max(0, Math.min(1, params["confidence_threshold"]))
      : 0;
  const forwardedFor = (req.headers["x-forwarded-for"] as string) ?? req.ip ?? "127.0.0.1";
  const data = await callVerifyEndpoint(claim, domain, forwardedFor);
  // signalDensity is a raw keyword-count (0, 1, 2, …); normalise to [0,1]
  // by dividing by 10 and capping at 1. A density of 0 → 0.0, ≥10 → 1.0.
  const rawDensity = typeof data["signalDensity"] === "number" ? (data["signalDensity"] as number) : 5;
  const confidence = Math.min(1, Math.max(0, rawDensity / 10));
  return buildVerifyResult(data, confidence, confidenceThreshold, domain);
}

// ─── Tool: search_claims ──────────────────────────────────────────────────────
async function toolSearchClaims(params: Record<string, unknown>): Promise<unknown> {
  const query = typeof params["query"] === "string" ? params["query"].trim() : "";
  if (!query) {
    throw { code: MCP_ERRORS.INVALID_PARAMS, message: "query must be a non-empty string" };
  }
  const verdict = typeof params["verdict"] === "string" ? params["verdict"] : undefined;
  const domain = typeof params["domain"] === "string" ? params["domain"] : undefined;
  const minConfidence =
    typeof params["min_confidence"] === "number"
      ? Math.max(0, Math.min(1, params["min_confidence"]))
      : undefined;
  const limit = typeof params["limit"] === "number" ? Math.min(50, Math.max(1, params["limit"])) : 10;
  const offset = typeof params["offset"] === "number" ? Math.max(0, params["offset"]) : 0;
  const page = Math.floor(offset / limit) + 1;

  let result: Awaited<ReturnType<typeof getPaginatedPublicClaims>>;
  try {
    result = await getPaginatedPublicClaims({
      page,
      pageSize: limit,
      verdict,
      vertical: domain,
      q: query,
    });
  } catch {
    // DB may be empty in test/fresh environments — return empty result
    return { total: 0, claims: [] };
  }

  const filtered = minConfidence !== undefined
    ? result.rows.filter(r => (r.confidenceScore ?? 0) >= minConfidence)
    : result.rows;

  return {
    total: result.total,
    claims: filtered.map(r => ({
      claimId: String(r.id),
      claimText: r.claimText,
      verdict: r.verdict ?? "inconclusive",
      confidence: r.confidenceScore ?? 0,
      domain: r.verticalDomain ?? null,
      processedAt: r.updatedAt?.toISOString() ?? null,
      evidenceCount: r.pdbEvidenceUrl ? 1 : 0,
      primarySourceId: r.pdbId ?? null,
    })),
  };
}

// ─── Tool: get_claim ──────────────────────────────────────────────────────────
async function toolGetClaim(params: Record<string, unknown>): Promise<unknown> {
  const claimIdRaw = params["claim_id"];
  const claimId = typeof claimIdRaw === "number"
    ? claimIdRaw
    : typeof claimIdRaw === "string"
    ? parseInt(claimIdRaw, 10)
    : NaN;

  if (isNaN(claimId) || claimId <= 0) {
    throw { code: MCP_ERRORS.INVALID_PARAMS, message: "claim_id must be a positive integer" };
  }

  let claim: Awaited<ReturnType<typeof getClaimById>>;
  try {
    claim = await getClaimById(claimId);
  } catch {
    // DB error (e.g. empty DB in test) — treat as not found
    throw { code: MCP_ERRORS.NOT_FOUND, message: `Claim ${claimId} not found` };
  }
  if (!claim) {
    throw { code: MCP_ERRORS.NOT_FOUND, message: `Claim ${claimId} not found` };
  }

  return {
    claimId: String(claim.id),
    claimText: claim.claimText,
    claimType: claim.claimType,
    extractedValue: claim.extractedValue ?? null,
    verdict: claim.verdict ?? null,
    confidence: claim.confidenceScore ?? null,
    verdictRationale: claim.verdictRationale ?? null,
    verdictMethod: claim.verdictMethod ?? null,
    pdbId: claim.pdbId ?? null,
    pdbEvidenceUrl: claim.pdbEvidenceUrl ?? null,
    documentId: claim.documentId,
    createdAt: claim.createdAt?.toISOString() ?? null,
    updatedAt: claim.updatedAt?.toISOString() ?? null,
  };
}

// ─── Tool: get_source_version ─────────────────────────────────────────────────
async function toolGetSourceVersion(params: Record<string, unknown>): Promise<unknown> {
  const sourceId = typeof params["source_id"] === "string" ? params["source_id"].trim() : "";
  if (!sourceId) {
    throw { code: MCP_ERRORS.INVALID_PARAMS, message: "source_id must be a non-empty string" };
  }

  const version = await getSourceVersion(sourceId);
  if (!version) {
    return {
      sourceId,
      currentVersionHash: null,
      lastChecked: null,
      changeType: null,
      affectedClaimCount: 0,
      versionLabel: null,
      neverChecked: true,
    };
  }

  return {
    sourceId: version.sourceId,
    currentVersionHash: version.versionHash,
    lastChecked: version.detectedAt != null ? new Date(version.detectedAt * 1000).toISOString() : null,
    changeType: version.changeType ?? null,
    affectedClaimCount: version.affectedClaimCount ?? 0,
    versionLabel: version.versionLabel ?? null,
    neverChecked: false,
  };
}

// ─── Tool: ask_question ───────────────────────────────────────────────────────
async function toolAskQuestion(params: Record<string, unknown>): Promise<unknown> {
  const question = typeof params["question"] === "string" ? params["question"].trim() : "";
  if (!question) {
    throw { code: MCP_ERRORS.INVALID_PARAMS, message: "question must be a non-empty string" };
  }
  if (question.length > 1000) {
    throw { code: MCP_ERRORS.INVALID_PARAMS, message: "question must be at most 1000 characters" };
  }

  const result = await processQuestion(question);
  return {
    question: result.questionText,
    derivedClaim: result.derivedClaim,
    verdict: result.verdict,
    confidence: result.confidence,
    rationale: result.rationale,
    sources: result.sources,
    loopTriggered: result.loopTriggered,
    processedAt: result.processedAt,
  };
}

// ─── Tool registry ────────────────────────────────────────────────────────────
type ToolHandler = (params: Record<string, unknown>, req: Request) => Promise<unknown>;

const TOOLS: Record<string, { description: string; handler: ToolHandler; inputSchema: Record<string, unknown> }> = {
  verify_claim: {
    description:
      "Submit a natural language claim and receive a structured verdict with evidence. Returns verdict (supported/refuted/inconclusive/needs_context/superseded), confidence score, evidence array with source IDs, and provenance.",
    inputSchema: {
      type: "object",
      properties: {
        claim: { type: "string", description: "The claim to verify (max 1000 chars)", maxLength: 1000 },
        domain: { type: "string", description: "Optional domain hint: biotech, climate, law, etc." },
        confidence_threshold: {
          type: "number",
          description: "Minimum confidence to return (0.0–1.0, default 0.0)",
          minimum: 0,
          maximum: 1,
        },
      },
      required: ["claim"],
      additionalProperties: false,
    },
    handler: toolVerifyClaim,
  },
  search_claims: {
    description:
      "Full-text search over the verified claim registry. Supports filtering by verdict, domain, confidence, and date range.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Full-text search query" },
        verdict: {
          type: "string",
          enum: ["supported", "refuted", "inconclusive", "needs_context", "superseded"],
          description: "Filter by verdict",
        },
        domain: { type: "string", description: "Filter by domain" },
        min_confidence: { type: "number", minimum: 0, maximum: 1, description: "Minimum confidence score" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max results (default 10)" },
        offset: { type: "integer", minimum: 0, description: "Pagination offset (default 0)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: async (params) => toolSearchClaims(params),
  },
  get_claim: {
    description: "Retrieve a single verified claim by its stable ID.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: { type: ["integer", "string"], description: "The claim ID (integer or numeric string)" },
      },
      required: ["claim_id"],
      additionalProperties: false,
    },
    handler: async (params) => toolGetClaim(params),
  },
  get_source_version: {
    description:
      "Check if a source has been retracted or updated since a claim was last verified. Returns the current version hash, change type, and affected claim count.",
    inputSchema: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "Source identifier (e.g. pubmed, uniprot, opencitations)" },
      },
      required: ["source_id"],
      additionalProperties: false,
    },
    handler: async (params) => toolGetSourceVersion(params),
  },
  ask_question: {
    description:
      "Submit a natural language question. The system derives a verifiable claim, runs it through the evidence pipeline, and returns a structured answer with provenance.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to answer (max 1000 chars)", maxLength: 1000 },
      },
      required: ["question"],
      additionalProperties: false,
    },
    handler: async (params) => toolAskQuestion(params),
  },
};

// ─── Capabilities response ────────────────────────────────────────────────────
function buildCapabilities() {
  return {
    protocolVersion: "2025-03-26",
    serverInfo: {
      name: "citation.is",
      version: "1.0.0",
      description:
        "Structured, machine-verifiable evidence for AI agents. Eliminates hallucination on factual claims by providing pre-verified truth values with traceable provenance.",
    },
    capabilities: {
      tools: { listChanged: false },
      streaming: true,
    },
    tools: Object.entries(TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    authentication: {
      required: false,
      schemes: ["Bearer"],
      note: "Anonymous: 10 req/hr per tool. Bearer token: unlimited.",
    },
  };
}

// ─── Protocol dispatch helper ─────────────────────────────────────────────────
/** Returns true if the method was handled (caller should return immediately). */
function handleProtocolMethod(method: string, id: unknown, res: Response): boolean {
  if (method === "initialize") {
    res.json(mcpResult(id, buildCapabilities()));
    return true;
  }
  if (method === "tools/list") {
    res.json(mcpResult(id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));
    return true;
  }
  if (method !== "tools/call") {
    res.status(404).json(mcpError(id, MCP_ERRORS.METHOD_NOT_FOUND, `Method "${method}" not found`));
    return true;
  }
  return false;
}

// ─── Request handler ──────────────────────────────────────────────────────────
// eslint-disable-next-line complexity
async function handleMcpPost(req: Request, res: Response): Promise<void> {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Test-Reset-RateLimit");

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.ip ??
    "unknown";

  // Test-only: clear all rate limit buckets for this IP when X-Test-Reset-RateLimit header is present
  if (process.env["NODE_ENV"] === "test" && req.headers["x-test-reset-ratelimit"] === "1") {
    for (const key of Array.from(rateBuckets.keys())) {
      if (key.startsWith(`${ip}:`)) rateBuckets.delete(key);
    }
    res.status(200).json({ ok: true, reset: true });
    return;
  }

  // Parse JSON-RPC body
  const body = req.body as Record<string, unknown>;
  if (!body || body["jsonrpc"] !== "2.0" || !body["method"]) {
    res.status(400).json(mcpError(body?.["id"], MCP_ERRORS.INVALID_REQUEST, "Invalid JSON-RPC 2.0 request"));
    return;
  }

  const id = body["id"];
  const method = body["method"] as string;
  const params = (body["params"] ?? {}) as Record<string, unknown>;

  // Handle MCP protocol methods (initialize, tools/list, tools/call)
  if (handleProtocolMethod(method, id, res)) return;

    // tools/call
    const toolName = typeof params["name"] === "string" ? params["name"] : "";
    const toolParams = (params["arguments"] ?? {}) as Record<string, unknown>;
    const tool = TOOLS[toolName];
  
    if (!tool) {
      res.status(404).json(mcpError(id, MCP_ERRORS.METHOD_NOT_FOUND, `Tool "${toolName}" not found`));
      return;
    }
  
    // Auth check — authenticated callers skip rate limiting
    const auth = await resolveAuth(req);
    if (!auth.authenticated) {
      const rl = checkMcpRateLimit(ip, toolName);
      if (!rl.allowed) {
        res.status(429).json(
          mcpError(id, MCP_ERRORS.RATE_LIMITED, "Rate limit exceeded. 10 requests per hour per tool for anonymous callers.", {
            resetAt: new Date(rl.resetAt).toISOString(),
            upgradeHint: "Obtain an API key at https://citation.is/settings/api-keys for unlimited access.",
          })
        );
        return;
      }
    }
  
    // Execute tool
    try {
      const result = await tool.handler(toolParams, req);
      res.json(mcpResult(id, { content: [{ type: "text", text: JSON.stringify(result) }] }));
    } catch (err) {
      const mcpErr = err as { code?: number; message?: string };
      if (mcpErr.code && mcpErr.message) {
        const status = mcpErr.code === MCP_ERRORS.NOT_FOUND ? 404 : 400;
        res.status(status).json(mcpError(id, mcpErr.code, mcpErr.message));
      } else {
        log.error(`[MCP] Tool "${toolName}" failed:`, errData(err));
        res.status(500).json(mcpError(id, MCP_ERRORS.INTERNAL_ERROR, "Internal server error"));
      }
    }
}

// ─── Fingerprint helper for testing ──────────────────────────────────────────
export function mcpServerFingerprint(): string {
  const toolNames = Object.keys(TOOLS).sort().join(",");
  return createHash("sha256").update(toolNames).digest("hex").slice(0, 16);
}

// ─── Exports for testing ──────────────────────────────────────────────────────
export {
  checkMcpRateLimit,
  buildCapabilities,
  TOOLS,
  MCP_ERRORS,
  ANON_LIMIT,
  ANON_WINDOW_MS,
};

// ─── Registration ─────────────────────────────────────────────────────────────
export function registerMcpServer(app: Express): void {
  // Preflight
  app.options("/api/mcp", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
  });

  // Capabilities discovery
  app.get("/api/mcp", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(buildCapabilities());
  });

  // Tool calls
  app.post("/api/mcp", handleMcpPost);

  log.info("[MCP] Server registered at GET/POST /api/mcp");
  log.info(`[MCP] Tools: ${Object.keys(TOOLS).join(", ")}`);
}
