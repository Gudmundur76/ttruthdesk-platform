/**
 * publicDecomposeClaimRoute.ts — Sprint 39
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/public/decompose-claim
 *
 * Splits a compound scientific claim into atomic, independently verifiable
 * sub-claims. Designed for agents like notus.is that submit predicted values
 * alongside structural claims — the `verifiable` flag lets callers skip
 * sub-claims that cannot be checked against primary literature.
 *
 * Request body:
 *   {
 *     "claim": string,          // required — up to 2000 chars
 *     "useLlm"?: boolean        // default false — set true for complex claims
 *   }
 *
 * Response:
 *   {
 *     "ok": true,
 *     "input": string,
 *     "claims": Array<{
 *       "index": number,
 *       "text": string,
 *       "verifiable": boolean,   // false for predicted/computed values
 *       "confidence": number,    // 0.0–1.0
 *       "method": "heuristic" | "llm" | "passthrough"
 *     }>,
 *     "usedLlm": boolean,
 *     "durationMs": number,
 *     "apiVersion": "1.1"
 *   }
 *
 * Rate limiting: 20 requests per IP per minute (lighter than batch-verify).
 * Max input length: 2000 characters.
 */

import type { Request, Response, Express } from "express";
import { decomposeQuestion } from "./questionDecomposer";
import { logger } from "./logger";

const log = logger("publicDecomposeClaimRoute");

const API_VERSION = "1.1";
const MAX_INPUT_LENGTH = 2000;
const RATE_LIMIT = 20; // requests per minute per IP
const WINDOW_MS = 60 * 1000;

// ─── CORS (same allowlist as batch-verify) ────────────────────────────────────

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

function checkRateLimit(ip: string): { allowed: boolean; resetAt: number } {
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

/**
 * Returns false for sub-claims that contain predicted/computed values which
 * cannot be directly verified against primary literature.
 *
 * Patterns that mark a claim as non-verifiable:
 *   - "predicted pIC50", "predicted Ki", "predicted binding energy"
 *   - "in silico", "computational prediction", "docking score"
 *   - "SMILES:" prefix (raw SMILES strings are not PubMed-searchable)
 *   - "estimated", "modelled", "simulated" + numeric value
 */
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

  const { claim, useLlm = false } = req.body ?? {};

  if (typeof claim !== "string" || claim.trim().length === 0) {
    res.status(400).json({
      ok: false,
      error: "Request body must include a non-empty 'claim' string.",
      example: {
        claim: "Compound X shows predicted pIC50=8.7 against HIV-1 protease via decahydroisoquinoline scaffold",
        useLlm: false,
      },
    });
    return;
  }

  const trimmed = claim.trim().slice(0, MAX_INPUT_LENGTH);

  try {
    const result = await decomposeQuestion(trimmed, Boolean(useLlm));

    const claims = result.claims.map(c => ({
      index: c.index,
      text: c.text,
      verifiable: isVerifiable(c.text),
      confidence: c.confidence,
      method: c.method,
    }));

    log.info("[DecomposeClaim] Decomposed claim", {
      inputLength: trimmed.length,
      claimCount: claims.length,
      verifiableCount: claims.filter(c => c.verifiable).length,
      usedLlm: result.usedLlm,
    });

    res.json({
      ok: true,
      input: trimmed,
      claims,
      usedLlm: result.usedLlm,
      durationMs: result.durationMs,
      apiVersion: API_VERSION,
    });
  } catch (err) {
    log.error("[DecomposeClaim] Error:", err as Record<string, unknown>);
    res.status(500).json({
      ok: false,
      error: "Decomposition failed due to an internal error.",
    });
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
