/**
 * streamVerifyRoute.ts
 *
 * GET /api/public/verify-claim/stream?claim=...&vertical=...
 *
 * Server-Sent Events (SSE) streaming variant of the verify-claim endpoint.
 * Emits progress events as each pipeline stage completes so AI agents and
 * frontends can show live progress rather than waiting 8-15s for a single
 * response.
 *
 * Event types (in order):
 *   stage:extraction   — claim extraction / translation complete
 *   stage:evidence     — structural DB + PubMed lookup complete
 *   stage:verdict      — composite verdict computed
 *   final              — full result (same shape as POST /verify-claim)
 *   error              — unrecoverable error
 *
 * Auth: same Bearer token / rate-limit rules as POST /verify-claim.
 * Rate limit: shared with POST endpoint (same IP bucket).
 */

import type { Express, Request, Response } from "express";
import { logger, errData } from "./logger";
import { extractClaims } from "./claimExtractor";
import { translateQueryToClaims } from "./_queryTranslator";
import { verdictForClaim, type VerdictResult } from "./pdbAdapter";
import { computeSignalDensity } from "./discoveryLoopJob";
import { getVertical } from "./verticalAdapters/types";
import type { EvidenceResult } from "./verticalAdapters/types";
import "./verticalAdapters"; // ensure all adapters are registered
import { triggerAutonomousIngest, type PubMedResult } from "./autonomousIngest";
import { validateApiKey } from "./apiKeyService";

// ─── Europe PMC search (mirrors verifyClaimRoute.ts pattern) ─────────────────

const EUROPE_PMC_SEARCH =
  "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

async function fetchPubMedResults(
  query: string,
  limit = 5
): Promise<PubMedResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `${EUROPE_PMC_SEARCH}?query=${encoded}&format=json&pageSize=${limit}&resultType=core&sort=CITED+desc`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      resultList?: {
        result?: Array<{
          pmid?: string;
          id?: string;
          title?: string;
          abstractText?: string;
          authorString?: string;
          journalTitle?: string;
          pubYear?: string;
        }>;
      };
    };
    const results = data.resultList?.result ?? [];
    return results
      .slice(0, limit)
      .map(r => ({
        pmid: r.pmid ?? r.id ?? "",
        title: r.title ?? "Untitled",
        abstractSnippet: (r.abstractText ?? "").slice(0, 400),
        citationUrl: r.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`
          : `https://europepmc.org/article/MED/${r.id ?? ""}`,
        authors: r.authorString ? r.authorString.split(", ").slice(0, 5) : [],
        journal: r.journalTitle ?? undefined,
        year: r.pubYear ? parseInt(r.pubYear, 10) : undefined,
      }))
      .filter(r => r.pmid);
  } catch {
    return [];
  }
}

function verdictFromPubMed(
  papers: PubMedResult[],
  claimText: string
): VerdictResult {
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

function evidenceToVerdict(
  evidence: EvidenceResult,
  claimText: string
): VerdictResult {
  if (!evidence.found) {
    return {
      verdict: "Insufficient Evidence",
      rationale:
        evidence.confidenceFlags.length > 0
          ? evidence.confidenceFlags.join("; ")
          : `No structural database evidence found for: "${claimText.substring(0, 120)}"`,
      evidenceUrl: evidence.sourceUrl,
      evidenceRaw: evidence.evidenceRaw as never,
    };
  }
  let verdict: VerdictResult["verdict"];
  if (evidence.confidenceScore >= 0.85) verdict = "Supported";
  else if (evidence.confidenceScore >= 0.6) verdict = "Partially Supported";
  else if (evidence.confidenceScore >= 0.3) verdict = "Ambiguous";
  else verdict = "Needs Expert Review";
  const flags =
    evidence.confidenceFlags.length > 0
      ? ` Flags: ${evidence.confidenceFlags.join("; ")}`
      : "";
  return {
    verdict,
    rationale: `Source: ${evidence.sourceId ?? evidence.sourceUrl ?? "unknown"} (confidence ${(evidence.confidenceScore * 100).toFixed(0)}%).${flags}`,
    evidenceUrl: evidence.sourceUrl,
    evidenceRaw: evidence.evidenceRaw as never,
  };
}

const VERDICT_RANK: Record<string, number> = {
  Supported: 6,
  "Partially Supported": 5,
  Ambiguous: 4,
  "Needs Expert Review": 3,
  "Insufficient Evidence": 2,
  "Out of Scope": 1,
};

function bestVerdict(a: VerdictResult, b: VerdictResult): VerdictResult {
  return (VERDICT_RANK[a.verdict] ?? 0) >= (VERDICT_RANK[b.verdict] ?? 0) ? a : b;
}

/** Map a verdict label to a numeric confidence score in [0, 1]. */
function verdictToConfidence(verdict: string): number {
  const map: Record<string, number> = {
    Supported: 0.92,
    "Partially Supported": 0.65,
    Ambiguous: 0.45,
    "Needs Expert Review": 0.30,
    "Insufficient Evidence": 0.15,
    "Out of Scope": 0.05,
  };
  return map[verdict] ?? 0.15;
}

const log = logger("streamVerifyRoute");

// ─── Rate limiting (shared bucket with POST endpoint) ─────────────────────────

const STREAM_RATE_LIMIT = 10; // requests per window
const STREAM_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateBucket {
  count: number;
  windowStart: number;
}

const streamRateBuckets = new Map<string, RateBucket>();

function checkStreamRateLimit(
  ip: string,
  isApiKey: boolean
): { allowed: boolean; remaining: number; resetAt: number } {
  if (isApiKey) return { allowed: true, remaining: 999999, resetAt: 0 };

  const now = Date.now();
  const bucket = streamRateBuckets.get(ip);

  if (!bucket || now - bucket.windowStart > STREAM_WINDOW_MS) {
    streamRateBuckets.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: STREAM_RATE_LIMIT - 1, resetAt: now + STREAM_WINDOW_MS };
  }

  if (bucket.count >= STREAM_RATE_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: bucket.windowStart + STREAM_WINDOW_MS,
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: STREAM_RATE_LIMIT - bucket.count,
    resetAt: bucket.windowStart + STREAM_WINDOW_MS,
  };
}

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function sseWrite(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseError(res: Response, message: string, code = 500): void {
  sseWrite(res, "error", { ok: false, error: message, code });
  res.end();
}

// ─── Main handler ─────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
async function handleStreamVerify(req: Request, res: Response): Promise<void> {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // ── Pre-flight checks (before SSE headers are committed) ─────────────────────
  // Auth check
  const authHeader = req.headers["authorization"] ?? "";
  let isApiKey = false;
  let apiKeyId: string | null = null;
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const keyRecord = await validateApiKey(token);
    if (keyRecord && keyRecord.valid) {
      isApiKey = true;
      apiKeyId = keyRecord.keyId !== undefined ? String(keyRecord.keyId) : null;
    }
  }

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.ip ??
    "unknown";

  // Test-only: reset rate limit bucket for this IP (must happen before flushHeaders)
  if (process.env["NODE_ENV"] === "test" && req.headers["x-test-reset-ratelimit"] === "1") {
    streamRateBuckets.delete(ip);
    res.status(204).end();
    return;
  }

  const rl = checkStreamRateLimit(ip, isApiKey);

  if (!rl.allowed) {
    res.status(429)
      .setHeader("X-RateLimit-Limit", String(STREAM_RATE_LIMIT))
      .setHeader("X-RateLimit-Remaining", "0")
      .setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)))
      .json({ ok: false, error: "Rate limit exceeded. Maximum 10 streaming requests per hour per IP.", code: 429 });
    return;
  }

  const claim = typeof req.query["claim"] === "string" ? req.query["claim"].trim() : "";
  const vertical = typeof req.query["vertical"] === "string" ? req.query["vertical"] : "structural_biology";

  if (!claim) {
    res.status(400).json({ ok: false, error: "Query parameter 'claim' is required and must be a non-empty string.", code: 400 });
    return;
  }
  if (claim.length > 2000) {
    res.status(400).json({ ok: false, error: "Claim text must be 2000 characters or fewer.", code: 400 });
    return;
  }

  // ── Commit SSE headers (no turning back after this point) ────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-RateLimit-Limit", String(STREAM_RATE_LIMIT));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
  res.flushHeaders();

  const processedAt = new Date().toISOString();
  const signalDensity = computeSignalDensity(claim);

  // ── Test-only mock mode ────────────────────────────────────────────────────
  // When NODE_ENV=test and claim starts with "__mock__", emit pre-canned events
  // immediately without calling LLM or PubMed. This lets integration tests
  // assert SSE event structure without waiting for real network calls.
  if (process.env["NODE_ENV"] === "test" && claim.startsWith("__mock__")) {
    const mockClaim = claim.slice(8) || "Mock claim";
    const sseWrite = (event: string, data: Record<string, unknown>) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    sseWrite("stage:extraction", { stage: 1, primaryClaimText: mockClaim, translatedClaims: [], claimsFound: 1 });
    sseWrite("stage:evidence", { stage: 2, pubmedCount: 3, pdbHit: false, sourcesQueried: ["pubmed"] });
    sseWrite("stage:verdict", { stage: 3, verdict: "Supported", confidence: 0.88, rationale: "Mock rationale" });
    sseWrite("final", {
      ok: true,
      claim: mockClaim,
      verdict: "Supported",
      rationale: "Mock rationale",
      evidenceUrl: null,
      claimType: "general_molecular",
      pdbId: null,
      proteinName: null,
      signalDensity: 0,
      pubmedResults: [],
      translatedClaims: [],
      processedAt,
      streaming: true,
    });
    res.end();
    return;
  }

  // Track client disconnect
  let clientGone = false;
  req.on("close", () => { clientGone = true; });

  // Send an immediate ping so the client knows the connection is alive
  // before the pipeline (LLM calls, PubMed fetches) begins.
  res.write(": ping\n\n");

  // Keepalive heartbeat — prevents proxies and clients from timing out
  // during long LLM/PubMed calls.
  const heartbeat = setInterval(() => {
    if (!clientGone) res.write(": heartbeat\n\n");
  }, 15_000);

  try {
    // ── Stage 1: Claim extraction / translation ────────────────────────────────
    const extracted = await extractClaims(claim);
    let translatedClaims: string[] = [];
    let primaryClaimText = claim;
    let primaryClaimType = "general_molecular";
    let primaryPdbId: string | null = null;
    let primaryProteinName: string | null = null;

    if (extracted && extracted.length > 0) {
      primaryClaimText = extracted[0].claimText;
      primaryClaimType = extracted[0].claimType;
      primaryPdbId = extracted[0].pdbId ?? null;
      primaryProteinName = extracted[0].proteinName ?? null;
    } else {
      const translated = await translateQueryToClaims(claim);
      translatedClaims = translated.map(c => c.claimText);
      if (translated.length > 0) {
        primaryClaimText = translated[0].claimText;
        primaryProteinName = translated[0].proteinName;
      }
    }

    if (!clientGone) {
      sseWrite(res, "stage:extraction", {
        stage: 1,
        label: "extraction",
        primaryClaimText,
        primaryClaimType,
        primaryPdbId,
        primaryProteinName,
        translatedClaims,
      });
    }

    // ── Stage 2: Evidence lookup ───────────────────────────────────────────────
    let allPubMedResults: PubMedResult[] = [];
    let structuralVerdictResult: VerdictResult | null = null;

    if (extracted && extracted.length > 0) {
      const primaryClaim = extracted[0];
      const adapter = getVertical(vertical as string);

      if (adapter) {
        const evidence: EvidenceResult = await adapter.lookupEvidence({
          claimText: primaryClaim.claimText,
          extractedValue: primaryClaim.extractedValue ?? null,
        });
        structuralVerdictResult = evidenceToVerdict(evidence, primaryClaim.claimText);
      } else {
        structuralVerdictResult = await verdictForClaim({
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

      const pubmedResults = await fetchPubMedResults(primaryClaim.claimText, 5);
      allPubMedResults = pubmedResults;
    } else if (translatedClaims.length > 0) {
      const translated = await translateQueryToClaims(claim);
      const searchPromises = translated.slice(0, 3).map(c => fetchPubMedResults(c.searchQuery, 4));
      const allResults = await Promise.all(searchPromises);
      allPubMedResults = allResults
        .flat()
        .filter((r, i, arr) => arr.findIndex(x => x.pmid === r.pmid) === i)
        .slice(0, 10);
    } else {
      allPubMedResults = await fetchPubMedResults(claim, 5);
    }

    if (!clientGone) {
      sseWrite(res, "stage:evidence", {
        stage: 2,
        label: "evidence",
        pubmedCount: allPubMedResults.length,
        hasStructuralEvidence: structuralVerdictResult !== null,
        pubmedResults: allPubMedResults.slice(0, 5).map(p => ({
          pmid: p.pmid,
          title: p.title,
          journal: p.journal ?? null,
          year: p.year ?? null,
          url: p.citationUrl,
        })),
      });
    }

    // ── Stage 3: Composite verdict ─────────────────────────────────────────────
    const pubmedVerdictResult = verdictFromPubMed(allPubMedResults, primaryClaimText);
    const bestVerdictResult = structuralVerdictResult
      ? bestVerdict(structuralVerdictResult, pubmedVerdictResult)
      : pubmedVerdictResult;

    if (!clientGone) {
      sseWrite(res, "stage:verdict", {
        stage: 3,
        label: "verdict",
        verdict: bestVerdictResult.verdict,
        confidence: verdictToConfidence(bestVerdictResult.verdict),
        rationale: bestVerdictResult.rationale,
      });
    }

    // ── Background: autonomous ingest ─────────────────────────────────────────
    if (allPubMedResults.length > 0) {
      triggerAutonomousIngest({
        query: claim,
        pubmedResults: allPubMedResults,
        uniprotEntries: [],
      });
    }

    // ── Final event ───────────────────────────────────────────────────────────
    if (!clientGone) {
      sseWrite(res, "final", {
        ok: true,
        claim,
        vertical,
        verdict: bestVerdictResult.verdict,
        rationale: bestVerdictResult.rationale,
        evidenceUrl: bestVerdictResult.evidenceUrl ?? null,
        claimType: primaryClaimType,
        pdbId: primaryPdbId,
        proteinName: primaryProteinName,
        signalDensity,
        pubmedResults: allPubMedResults.slice(0, 5).map(p => ({
          pmid: p.pmid,
          title: p.title,
          journal: p.journal ?? null,
          year: p.year ?? null,
          url: p.citationUrl,
        })),
        translatedClaims,
        processedAt,
        apiVersion: "1.1",
        streaming: true,
        apiKeyId: apiKeyId ?? undefined,
      });
    }

    clearInterval(heartbeat);
    res.end();
  } catch (err) {
    clearInterval(heartbeat);
    log.error("Stream verify error:", errData(err));
    if (!clientGone) {
      sseError(res, "Verification failed due to an internal error. Please try again.");
    } else {
      res.end();
    }
  }
}

// ─── MCP streaming capability descriptor ─────────────────────────────────────

export const MCP_STREAMING_CAPABILITY = {
  streaming: {
    supported: true,
    endpoint: "/api/public/verify-claim/stream",
    method: "GET",
    protocol: "text/event-stream",
    events: ["stage:extraction", "stage:evidence", "stage:verdict", "final", "error"],
    description:
      "Server-Sent Events stream that emits progress events as each verification stage completes. " +
      "Use when latency matters or when building live-progress UIs.",
  },
} as const;

export type McpStreamingCapability = typeof MCP_STREAMING_CAPABILITY;

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerStreamVerifyRoute(app: Express): void {
  app.options("/api/public/verify-claim/stream", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
  });
  app.get("/api/public/verify-claim/stream", handleStreamVerify);
}
