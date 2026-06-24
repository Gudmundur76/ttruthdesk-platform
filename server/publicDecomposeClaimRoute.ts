/**
 * publicDecomposeClaimRoute.ts — Sprint 41
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/public/decompose-claim
 *
 * Splits one or more compound scientific claims into atomic, independently
 * verifiable sub-claims. Supports both single-claim and batch modes.
 *
 * Single-claim request body:
 *   { "claim": string, "useLlm"?: boolean }
 *
 * Batch request body (Sprint 41):
 *   { "claims": string[], "vertical"?: string, "useLlm"?: boolean }
 *   → { "ok": true, "results": Array<{ original, claims, usedLlm, durationMs }>,
 *       "totalClaims", "totalVerifiable", "totalFiltered", "apiVersion" }
 *
 * Single-claim response (unchanged):
 *   { "ok": true, "input", "claims", "usedLlm", "durationMs", "apiVersion" }
 *
 * Rate limiting: 20 requests per IP per minute.
 *   Batch counts as ONE request regardless of array length (max 50 items).
 * Max input length per claim: 2000 characters.
 */

import type { Request, Response, Express } from "express";
import { decomposeQuestion } from "./questionDecomposer";
import { logger } from "./logger";

const log = logger("publicDecomposeClaimRoute");

const API_VERSION = "1.1";
const MAX_INPUT_LENGTH = 2000;
const MAX_BATCH_SIZE = 50;
const RATE_LIMIT = 20; // requests per minute per IP
const WINDOW_MS = 60 * 1000;

// ─── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  "https://notus.is",
  "https://citation.manus.space",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function setCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin ?? "";
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://citation.manus.space";
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(ip: string): { allowed: boolean; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + WINDOW_MS;
    rateLimitMap.set(ip, { count: 1, resetAt });
    return { allowed: true, resetAt };
  }
  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, resetAt: entry.resetAt };
  }
  entry.count++;
  return { allowed: true, resetAt: entry.resetAt };
}

setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of Array.from(rateLimitMap.entries())) {
      if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
  },
  5 * 60 * 1000
);

// ─── Verifiability heuristic ──────────────────────────────────────────────────

const NON_VERIFIABLE_PATTERNS = [
  /\bpredicted\s+(pic50|ki|kd|ic50|binding|affinity|score|energy)\b/i,
  /\bin\s+silico\b/i,
  /\bcomputational\s+prediction\b/i,
  /\bdocking\s+score\b/i,
  /\bSMILES\s*:/i,
  /\b(estimated|modelled?|simulated)\b.{0,40}\d+(\.\d+)?/i,
  /\bpic50\s*=\s*[\d.]+\b/i,
  /\bki\s*=\s*[\d.]+\s*(nm|um|mm|µm)\b/i,
];

function isVerifiable(claimText: string): boolean {
  return !NON_VERIFIABLE_PATTERNS.some(re => re.test(claimText));
}

// ─── Single-claim decompose ───────────────────────────────────────────────────

async function decomposeSingle(
  raw: string,
  useLlm: boolean
): Promise<{
  input: string;
  claims: { index: number; text: string; verifiable: boolean; confidence: number; method: string }[];
  usedLlm: boolean;
  durationMs: number;
}> {
  const trimmed = raw.trim().slice(0, MAX_INPUT_LENGTH);
  const result = await decomposeQuestion(trimmed, useLlm);
  const claims = result.claims.map(c => ({
    index: c.index,
    text: c.text,
    verifiable: isVerifiable(c.text),
    confidence: c.confidence,
    method: c.method,
  }));
  return { input: trimmed, claims, usedLlm: result.usedLlm, durationMs: result.durationMs };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleDecomposeClaim(req: Request, res: Response): Promise<void> {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.ip ??
    "unknown";

  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    res.status(429).json({
      ok: false,
      error: "Rate limit exceeded. Maximum 20 decompose requests per minute per IP.",
      retryAfterMs: rl.resetAt - Date.now(),
    });
    return;
  }

  const body = req.body ?? {};
  const useLlm = Boolean(body.useLlm ?? false);

  // ── Batch mode: { claims: string[] } ─────────────────────────────────────────
  if (Array.isArray(body.claims)) {
    const rawClaims: unknown[] = body.claims;

    if (rawClaims.length === 0) {
      res.status(400).json({ ok: false, error: "'claims' array must not be empty." });
      return;
    }
    if (rawClaims.length > MAX_BATCH_SIZE) {
      res.status(400).json({
        ok: false,
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}. Received ${rawClaims.length}.`,
      });
      return;
    }
    if (!rawClaims.every(c => typeof c === "string")) {
      res.status(400).json({ ok: false, error: "All items in 'claims' must be strings." });
      return;
    }

    try {
      const results = await Promise.all(
        (rawClaims as string[]).map(raw => decomposeSingle(raw, useLlm))
      );

      const totalClaims = results.reduce((s, r) => s + r.claims.length, 0);
      const totalVerifiable = results.reduce(
        (s, r) => s + r.claims.filter(c => c.verifiable).length,
        0
      );

      log.info("[DecomposeClaim] Batch decomposed", {
        inputCount: results.length,
        totalClaims,
        totalVerifiable,
        totalFiltered: totalClaims - totalVerifiable,
      });

      res.json({
        ok: true,
        results: results.map(r => ({
          original: r.input,
          claims: r.claims,
          usedLlm: r.usedLlm,
          durationMs: r.durationMs,
        })),
        totalClaims,
        totalVerifiable,
        totalFiltered: totalClaims - totalVerifiable,
        apiVersion: API_VERSION,
      });
    } catch (err) {
      log.error("[DecomposeClaim] Batch error:", err as Record<string, unknown>);
      res.status(500).json({ ok: false, error: "Batch decomposition failed due to an internal error." });
    }
    return;
  }

  // ── Single mode: { claim: string } ───────────────────────────────────────────
  const { claim } = body;

  if (typeof claim !== "string" || claim.trim().length === 0) {
    res.status(400).json({
      ok: false,
      error: "Request body must include a non-empty 'claim' string, or a 'claims' string array for batch mode.",
      examples: {
        single: { claim: "Compound X shows predicted pIC50=8.7 against HIV-1 protease", useLlm: false },
        batch: { claims: ["Claim A", "Claim B"], vertical: "hiv_protease", useLlm: false },
      },
    });
    return;
  }

  try {
    const r = await decomposeSingle(claim, useLlm);

    log.info("[DecomposeClaim] Decomposed single claim", {
      inputLength: r.input.length,
      claimCount: r.claims.length,
      verifiableCount: r.claims.filter(c => c.verifiable).length,
      usedLlm: r.usedLlm,
    });

    res.json({
      ok: true,
      input: r.input,
      claims: r.claims,
      usedLlm: r.usedLlm,
      durationMs: r.durationMs,
      apiVersion: API_VERSION,
    });
  } catch (err) {
    log.error("[DecomposeClaim] Error:", err as Record<string, unknown>);
    res.status(500).json({ ok: false, error: "Decomposition failed due to an internal error." });
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Reset rate-limit map between tests. Not for production use. */
export function _resetRateLimitForTesting(): void {
  rateLimitMap.clear();
}

/** Expose isVerifiable for unit tests. */
export { isVerifiable };

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerPublicDecomposeClaimRoute(app: Express): void {
  app.options("/api/public/decompose-claim", (req, res) => {
    setCorsHeaders(req, res);
    res.status(204).end();
  });
  app.post("/api/public/decompose-claim", handleDecomposeClaim);
}
