/**
 * verifyClaimRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/public/verify-claim
 *
 * Agent-callable, unauthenticated single-claim verification endpoint.
 * Accepts a plain-text claim string, extracts structured fields via the LLM
 * claim extractor, runs it through the PDB verdict engine, and returns a
 * structured JSON verdict with provenance.
 *
 * This is the grow.contact MCP server pattern applied to molecular evidence:
 * any AI agent, investor tool, or due-diligence system can call this endpoint
 * to verify a molecular claim without a human in the loop.
 *
 * Rate limiting: 30 requests per IP per minute (in-memory, resets on restart).
 * For production scale, replace with Redis-backed rate limiting.
 *
 * Schema (request body):
 *   { "claim": string, "vertical"?: "structural_biology" | "salmon_biotech" }
 *
 * Schema (response):
 *   {
 *     "ok": true,
 *     "claim": string,
 *     "vertical": string,
 *     "verdict": VerdictLabel,
 *     "rationale": string,
 *     "evidenceUrl": string | null,
 *     "claimType": string,
 *     "pdbId": string | null,
 *     "proteinName": string | null,
 *     "signalDensity": number,
 *     "processedAt": string (ISO 8601),
 *     "apiVersion": "1.0"
 *   }
 */

import type { Request, Response, Express } from "express";
import { extractClaims } from "./claimExtractor";
import { verdictForClaim, type VerdictResult } from "./pdbAdapter";
import { computeSignalDensity } from "./discoveryLoopJob";
import { getVertical } from "./verticalAdapters/types";
import type { EvidenceResult } from "./verticalAdapters/types";
import "./verticalAdapters"; // ensure all adapters are registered

// ─── EvidenceResult → VerdictResult mapper ────────────────────────────────────
function evidenceToVerdict(evidence: EvidenceResult, claimText: string): VerdictResult {
  if (!evidence.found) {
    return {
      verdict: "Insufficient Evidence",
      rationale: evidence.confidenceFlags.length > 0
        ? evidence.confidenceFlags.join("; ")
        : `No evidence found for: "${claimText.substring(0, 120)}"`,
      evidenceUrl: evidence.sourceUrl,
      evidenceRaw: evidence.evidenceRaw as never,
    };
  }
  let verdict: VerdictResult["verdict"];
  if (evidence.confidenceScore >= 0.85) verdict = "Supported";
  else if (evidence.confidenceScore >= 0.60) verdict = "Partially Supported";
  else if (evidence.confidenceScore >= 0.30) verdict = "Ambiguous";
  else verdict = "Needs Expert Review";
  const flags = evidence.confidenceFlags.length > 0
    ? ` Flags: ${evidence.confidenceFlags.join("; ")}`
    : "";
  return {
    verdict,
    rationale: `Source: ${evidence.sourceId ?? evidence.sourceUrl ?? "unknown"} (confidence ${(evidence.confidenceScore * 100).toFixed(0)}%).${flags}`,
    evidenceUrl: evidence.sourceUrl,
    evidenceRaw: evidence.evidenceRaw as never,
  };
}

// ─── In-memory rate limiter ───────────────────────────────────────────────────

const RATE_LIMIT = 30;          // requests per window
const WINDOW_MS = 60 * 1000;   // 1 minute

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + WINDOW_MS;
    rateLimitMap.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT - 1, resetAt };
  }
  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT - entry.count, resetAt: entry.resetAt };
}

// Prune stale entries every 5 minutes to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of Array.from(rateLimitMap.entries())) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleVerifyClaim(req: Request, res: Response): Promise<void> {
  // CORS — allow any origin so AI agents can call from any domain
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Rate limiting
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  const rl = checkRateLimit(ip);
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));

  // Billing / plan headers (public endpoint = free tier)
  res.setHeader("X-Plan-Tier", "free");
  res.setHeader("X-Credits-Used", "1");
  res.setHeader("X-Credits-Remaining", "unlimited");

  if (!rl.allowed) {
    res.status(429).json({
      ok: false,
      error: "Rate limit exceeded. Maximum 30 requests per minute per IP.",
      retryAfterMs: rl.resetAt - Date.now(),
    });
    return;
  }

  // Input validation
  const { claim, vertical = "structural_biology" } = req.body ?? {};
  if (typeof claim !== "string" || claim.trim().length === 0) {
    res.status(400).json({
      ok: false,
      error: "Request body must include a non-empty 'claim' string.",
      example: { claim: "The crystal structure of lysozyme was solved at 1.8 Å resolution (PDB: 1LYZ)." },
    });
    return;
  }
  if (claim.trim().length > 2000) {
    res.status(400).json({
      ok: false,
      error: "Claim text must be 2000 characters or fewer.",
    });
    return;
  }

  const claimText = claim.trim();
  const processedAt = new Date().toISOString();

  try {
    // Compute signal density (quick pre-check)
    const signalDensity = computeSignalDensity(claimText);

    // Extract structured claim fields via LLM
    const extracted = await extractClaims(claimText);

    if (!extracted || extracted.length === 0) {
      res.json({
        ok: true,
        claim: claimText,
        vertical,
        verdict: "Out of Scope",
        rationale: "No verifiable molecular claims were identified in the provided text.",
        evidenceUrl: null,
        claimType: "unknown",
        pdbId: null,
        proteinName: null,
        signalDensity,
        processedAt,
        apiVersion: "1.0",
      });
      return;
    }

    // Use the first extracted claim for the verdict (most prominent claim)
    const primaryClaim = extracted[0];

    // Route through vertical adapter if registered, else fall back to PDB
    const adapter = getVertical(vertical as string);
    let verdict: VerdictResult;
    if (adapter) {
      const evidence: EvidenceResult = await adapter.lookupEvidence({
        claimText: primaryClaim.claimText,
        extractedValue: primaryClaim.extractedValue ?? null,
      });
      verdict = evidenceToVerdict(evidence, primaryClaim.claimText);
    } else {
      verdict = await verdictForClaim({
        claimType: primaryClaim.claimType,
        pdbId: primaryClaim.pdbId ?? null,
        proteinName: primaryClaim.proteinName ?? null,
        experimentalMethod: primaryClaim.experimentalMethod ?? null,
        resolution: primaryClaim.resolution ?? null,
        organism: primaryClaim.organism ?? null,
        ligand: primaryClaim.ligand ?? null,
        extractedValue: primaryClaim.extractedValue ?? null,
      });
    }

    res.json({
      ok: true,
      claim: claimText,
      vertical,
      verdict: verdict.verdict,
      rationale: verdict.rationale,
      evidenceUrl: verdict.evidenceUrl,
      claimType: primaryClaim.claimType,
      pdbId: primaryClaim.pdbId ?? null,
      proteinName: primaryClaim.proteinName ?? null,
      signalDensity,
      processedAt,
      apiVersion: "1.0",
    });
  } catch (err) {
    console.error("[VerifyClaim] Error:", err);
    res.status(500).json({
      ok: false,
      error: "Verification failed due to an internal error. Please try again.",
      processedAt,
    });
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerVerifyClaimRoute(app: Express): void {
  app.options("/api/public/verify-claim", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
  });
  app.post("/api/public/verify-claim", handleVerifyClaim);
}
