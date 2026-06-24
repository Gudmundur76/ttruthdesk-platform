/**
 * publicBatchVerifyRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/public/batch-verify
 *
 * Agent-callable, unauthenticated batch claim verification endpoint.
 * Accepts up to 50 claim strings and runs them in parallel (concurrency = 5).
 *
 * Request body:
 *   { "claims": string[], "vertical"?: string }
 *
 * Response:
 *   {
 *     "ok": true,
 *     "total": number,
 *     "results": Array<{
 *       "index": number,
 *       "claim": string,
 *       "verdict": string,
 *       "rationale": string,
 *       "confidence": number,
 *       "evidenceUrl": string | null,
 *       "pubmedResults": PubMedResult[],
 *       "processedAt": string,
 *       "error": string | null
 *     }>,
 *     "processedAt": string
 *   }
 *
 * Rate limiting: 10 batch requests per IP per minute (each batch counts as 1).
 * Max 50 claims per batch. Claims over 2000 chars are rejected individually.
 */

import type { Request, Response, Express } from "express";
import { extractClaims } from "./claimExtractor";
import { verdictForClaim, type VerdictResult } from "./pdbAdapter";
import { computeSignalDensity } from "./discoveryLoopJob";
import { getVertical } from "./verticalAdapters/types";
import "./verticalAdapters"; // ensure all adapters are registered
import { translateQueryToClaims } from "./_queryTranslator";
import { triggerAutonomousIngest, type PubMedResult } from "./autonomousIngest";
import { fetchNcbiResults } from "./ncbiAdapter";
import { logger, errData } from "./logger";

const log = logger("publicBatchVerifyRoute");

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CLAIMS = 50;
const CONCURRENCY = 5;
const BATCH_RATE_LIMIT = 10; // requests per minute per IP
const WINDOW_MS = 60 * 1000;

// ─── CORS allowlist (same as verify-claim) ────────────────────────────────────

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
  if (entry.count >= BATCH_RATE_LIMIT) {
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

// ─── Verdict helpers (mirrors verify-claim logic) ─────────────────────────────

const VERDICT_CONFIDENCE: Record<string, number> = {
  Supported: 0.9,
  "Partially Supported": 0.65,
  Ambiguous: 0.4,
  "Needs Expert Review": 0.3,
  "Insufficient Evidence": 0.1,
  Contradicted: 0.05,
  "Out of Scope": 0.05,
};

function verdictFromPubMed(papers: PubMedResult[], claimText: string): VerdictResult {
  if (papers.length >= 2) {
    const pmids = papers.slice(0, 3).map(p => `PMID:${p.pmid}`).join(", ");
    return {
      verdict: "Supported",
      rationale: `${papers.length} peer-reviewed papers support this claim. Top sources: ${pmids}.`,
      evidenceUrl: papers[0]?.citationUrl ?? null,
      evidenceRaw: undefined as never,
    };
  }
  if (papers.length === 1) {
    return {
      verdict: "Partially Supported",
      rationale: `1 peer-reviewed paper found (PMID:${papers[0].pmid}): "${papers[0].title}". More evidence needed for full support.`,
      evidenceUrl: papers[0].citationUrl ?? null,
      evidenceRaw: undefined as never,
    };
  }
  return {
    verdict: "Insufficient Evidence",
    rationale: `No peer-reviewed papers found for: "${claimText.slice(0, 120)}". This claim may be novel or require different search terms.`,
    evidenceUrl: null,
    evidenceRaw: undefined as never,
  };
}

// ─── Sub-helpers to keep processSingleClaim complexity ≤ 20 ─────────────────

async function tryVerticalEvidence(
  claimText: string,
  extractedValue: string | null,
  vertical: string | null
): Promise<VerdictResult | null> {
  const adapter = getVertical(vertical as string);
  if (!adapter) return null;
  const evidence = await adapter.lookupEvidence({ claimText, extractedValue });
  if (!evidence.found || evidence.confidenceScore < 0.6) return null;
  return {
    verdict: evidence.confidenceScore >= 0.85 ? "Supported" : "Partially Supported",
    rationale: `Source: ${evidence.sourceId ?? evidence.sourceUrl ?? "unknown"} (confidence ${(evidence.confidenceScore * 100).toFixed(0)}%).`,
    evidenceUrl: evidence.sourceUrl,
    evidenceRaw: evidence.evidenceRaw as never,
  };
}

async function tryStructuredVerdict(
  primaryClaim: Awaited<ReturnType<typeof extractClaims>>[number],
  vertical: string | null
): Promise<VerdictResult | null> {
  const vertResult = await tryVerticalEvidence(
    primaryClaim.claimText,
    primaryClaim.extractedValue ?? null,
    vertical
  );
  if (vertResult) return vertResult;
  return verdictForClaim({
    claimType: primaryClaim.claimType,
    pdbId: primaryClaim.pdbId ?? null,
    proteinName: primaryClaim.proteinName ?? null,
    experimentalMethod: primaryClaim.experimentalMethod ?? null,
    resolution: primaryClaim.resolution ?? null,
    organism: primaryClaim.organism ?? null,
    ligand: primaryClaim.ligand ?? null,
  });
}

async function tryPubMedFallback(
  claimText: string
): Promise<{ pubmedResults: PubMedResult[]; verdictResult: VerdictResult }> {
  const translated = await translateQueryToClaims(claimText);
  const searchQuery = translated.length > 0 ? translated[0].claimText : claimText;
  const rawResults = await fetchNcbiResults(searchQuery, claimText, 5);
  const pubmedResults = rawResults.slice(0, 5);
  const verdictResult = verdictFromPubMed(pubmedResults, claimText);
  if (pubmedResults.length > 0) {
    triggerAutonomousIngest({ query: claimText, pubmedResults, uniprotEntries: [] });
  }
  return { pubmedResults, verdictResult };
}

function computeConfidence(verdict: string, pubmedCount: number, signalDensity: number): number {
  const base = VERDICT_CONFIDENCE[verdict] ?? 0.5;
  const pubmedBoost = Math.min(pubmedCount * 0.04, 0.2);
  const signalBoost = Math.min((signalDensity / 60) * 0.1, 0.1);
  return Math.round(Math.min(base + pubmedBoost + signalBoost, 0.99) * 100) / 100;
}

// ─── Single claim processor ───────────────────────────────────────────────────

async function processSingleClaim(
  claimText: string,
  vertical: string | null,
  index: number
): Promise<{
  index: number;
  claim: string;
  verdict: string;
  rationale: string;
  confidence: number;
  evidenceUrl: string | null;
  pubmedResults: PubMedResult[];
  processedAt: string;
  error: string | null;
}> {
  const processedAt = new Date().toISOString();
  try {
    const signalDensity = computeSignalDensity(claimText);
    const extracted = await extractClaims(claimText);

    let pubmedResults: PubMedResult[] = [];
    let verdictResult: VerdictResult | null = null;

    if (extracted && extracted.length > 0) {
      verdictResult = await tryStructuredVerdict(extracted[0], vertical);
    }

    if (!verdictResult || verdictResult.verdict === "Insufficient Evidence") {
      const fallback = await tryPubMedFallback(claimText);
      pubmedResults = fallback.pubmedResults;
      verdictResult = fallback.verdictResult;
    }

    const confidence = computeConfidence(verdictResult.verdict, pubmedResults.length, signalDensity);

    return {
      index,
      claim: claimText,
      verdict: verdictResult.verdict,
      rationale: verdictResult.rationale,
      confidence,
      evidenceUrl: verdictResult.evidenceUrl ?? null,
      pubmedResults: pubmedResults.slice(0, 3).map(p => ({
        pmid: p.pmid,
        title: p.title,
        abstractSnippet: p.abstractSnippet ?? "",
        journal: p.journal ?? null,
        year: p.year ?? null,
        citationUrl: p.citationUrl,
      })) as unknown as PubMedResult[],
      processedAt,
      error: null,
    };
  } catch (err) {
    log.error(`[BatchVerify] Claim ${index} error:`, errData(err));
    return {
      index,
      claim: claimText,
      verdict: "Insufficient Evidence",
      rationale: "Verification failed due to an internal error.",
      confidence: 0,
      evidenceUrl: null,
      pubmedResults: [],
      processedAt,
      error: "Internal error",
    };
  }
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleBatchVerify(req: Request, res: Response): Promise<void> {
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
      error: "Rate limit exceeded. Maximum 10 batch requests per minute per IP.",
      retryAfterMs: rl.resetAt - Date.now(),
    });
    return;
  }

  const { claims, vertical = null } = req.body ?? {};

  if (!Array.isArray(claims) || claims.length === 0) {
    res.status(400).json({
      ok: false,
      error: "Request body must include a non-empty 'claims' array of strings.",
      example: { claims: ["Salmon contains omega-3 fatty acids.", "Protein X inhibits enzyme Y."] },
    });
    return;
  }

  if (claims.length > MAX_CLAIMS) {
    res.status(400).json({
      ok: false,
      error: `Maximum ${MAX_CLAIMS} claims per batch request.`,
    });
    return;
  }

  const processedAt = new Date().toISOString();

  // Validate each claim
  const validatedClaims: Array<{ text: string; error: string | null }> = claims.map(c => {
    if (typeof c !== "string" || c.trim().length === 0) {
      return { text: "", error: "Claim must be a non-empty string." };
    }
    if (c.trim().length > 2000) {
      return { text: c.trim(), error: "Claim text must be 2000 characters or fewer." };
    }
    return { text: c.trim(), error: null };
  });

  // Build tasks for valid claims only
  const tasks = validatedClaims.map((c, i) => {
    if (c.error) {
      return async () => ({
        index: i,
        claim: c.text,
        verdict: "Insufficient Evidence" as const,
        rationale: c.error!,
        confidence: 0,
        evidenceUrl: null,
        pubmedResults: [] as PubMedResult[],
        processedAt: new Date().toISOString(),
        error: c.error,
      });
    }
    return () => processSingleClaim(c.text, vertical as string | null, i);
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);

  res.json({
    ok: true,
    total: results.length,
    results,
    processedAt,
    apiVersion: "1.0",
  });
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerPublicBatchVerifyRoute(app: Express): void {
  app.options("/api/public/batch-verify", (req, res) => {
    setCorsHeaders(req, res);
    res.status(204).end();
  });
  app.post("/api/public/batch-verify", handleBatchVerify);
}
