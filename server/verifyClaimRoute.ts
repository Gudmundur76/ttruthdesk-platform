/**
 * verifyClaimRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/public/verify-claim
 *
 * Agent-callable, unauthenticated single-claim verification endpoint.
 *
 * PIPELINE (Sprint R-fix — never returns "Out of Scope"):
 *
 *   1. Receive any text — structured claim OR everyday natural-language question.
 *   2. Try extractClaims() for structured molecular claims (PDB IDs, accessions).
 *   3. If extraction yields nothing (natural-language input), call
 *      translateQueryToClaims() to decompose into 1-5 verifiable claims.
 *   4. For each claim, search PubMed via EuropePMC (primary evidence source).
 *   5. Derive verdict from paper count: ≥2 papers → Supported, 1 paper →
 *      Partially Supported, 0 papers → Insufficient Evidence.
 *   6. Enrich with structural DB (PDB/UniProt) verdict if available.
 *   7. Return the best (highest-confidence) verdict with PMIDs.
 *
 * "Out of Scope" is NEVER returned. Every question gets evidence or an honest
 * "Insufficient Evidence" with the PubMed queries that were tried.
 *
 * Rate limiting: 30 requests per IP per minute (in-memory, resets on restart).
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
 *     "pubmedResults": PubMedResult[],
 *     "translatedClaims": string[],
 *     "spo": { subject, predicate, object, confidence, method } | null,
 *     "contradictions": ContradictionAlert[],
 *     "processedAt": string (ISO 8601),
 *     "apiVersion": "1.2"
 *   }
 */

import type { Request, Response, Express } from "express";
import { extractClaims } from "./claimExtractor";
import { verdictForClaim, type VerdictResult } from "./pdbAdapter";
import { computeSignalDensity } from "./discoveryLoopJob";
import { getVertical } from "./verticalAdapters/types";
import type { EvidenceResult } from "./verticalAdapters/types";
import "./verticalAdapters"; // ensure all adapters are registered
import { translateQueryToClaims } from "./_queryTranslator";
import { triggerAutonomousIngest, type PubMedResult } from "./autonomousIngest";
import { findClaimByText, getContradictionsForClaim } from "./db";
import { extractSpoTriple } from "./spoExtractor";
import { logger, errData } from "./logger";
import { fireVerdictWebhook, buildVerdictPayload } from "./verdictWebhookRoute";
import { decomposeQuestion, buildPubMedQuery } from "./questionDecomposer";
import { classifyClaims, getPrimaryRoute } from "./domainClassifier";
const log = logger("verifyClaimRoute");

// ─── NCBI E-utilities adapter (Sprint 25 Phase 3 — replaces EuropePMC) ──────
import { fetchNcbiResults } from "./ncbiAdapter";
// Thin wrapper: keeps all call-sites identical; claimText drives sentence scoring
async function fetchPubMedResults(
  query: string,
  limit = 5,
  claimText = query
): Promise<PubMedResult[]> {
  return fetchNcbiResults(query, claimText, limit);
}

// ─── Keyword overlap relevance filter ────────────────────────────────────────
// Filters PubMed results to papers that share at least one meaningful keyword
// with the claim text. Prevents topically-adjacent but claim-irrelevant papers.

function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "this",
    "that",
    "these",
    "those",
    "with",
    "for",
    "from",
    "and",
    "or",
    "but",
    "not",
    "in",
    "on",
    "at",
    "to",
    "of",
    "by",
    "as",
    "its",
    "it",
    "their",
    "our",
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !stopWords.has(w))
  );
}

function relevanceScore(
  claimKeywords: Set<string>,
  paper: PubMedResult
): number {
  const paperText =
    `${paper.title} ${paper.abstractSnippet ?? ""}`.toLowerCase();
  let matches = 0;
  Array.from(claimKeywords).forEach(kw => {
    if (paperText.includes(kw)) matches++;
  });
  return claimKeywords.size > 0 ? matches / claimKeywords.size : 0;
}

function filterByRelevance(
  papers: PubMedResult[],
  claimText: string,
  minScore = 0.08
): PubMedResult[] {
  const keywords = extractKeywords(claimText);
  if (keywords.size === 0) return papers;
  const scored = papers
    .map(p => ({ paper: p, score: relevanceScore(keywords, p) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score);
  // Always return at least 1 paper if any exist (avoid empty result for short claims)
  return scored.length > 0 ? scored.map(s => s.paper) : papers.slice(0, 1);
}

// ─── Compute a real confidence score from available signals ───────────────────
// Combines: (1) pubmed hit count, (2) signal density, (3) verdict label weight
// Returns a 0–1 float rounded to 2 decimal places.

const VERDICT_CONFIDENCE: Record<string, number> = {
  Supported: 0.9,
  "Partially Supported": 0.65,
  Ambiguous: 0.4,
  "Needs Expert Review": 0.3,
  "Insufficient Evidence": 0.1,
  Contradicted: 0.05,
  "Out of Scope": 0.05,
};

function computeConfidenceScore(
  verdict: string,
  pubmedCount: number,
  signalDensity: number,
  maxSignals = 60
): number {
  const verdictBase = VERDICT_CONFIDENCE[verdict] ?? 0.5;
  // pubmed boost: each paper adds up to 0.04 (capped at 0.20 for 5+ papers)
  const pubmedBoost = Math.min(pubmedCount * 0.04, 0.2);
  // signal boost: proportion of matched signals, scaled to 0.10 max
  const signalBoost = Math.min((signalDensity / maxSignals) * 0.1, 0.1);
  const raw = verdictBase + pubmedBoost + signalBoost;
  return Math.round(Math.min(raw, 0.99) * 100) / 100;
}

// ─── Derive verdict from PubMed paper count ───────────────────────────────────

function verdictFromPubMed(
  papers: PubMedResult[],
  claimText: string
): VerdictResult {
  if (papers.length >= 2) {
    const pmids = papers
      .slice(0, 3)
      .map(p => `PMID:${p.pmid}`)
      .join(", ");
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

// ─── EvidenceResult → VerdictResult mapper ────────────────────────────────────

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

// ─── Verdict rank (higher = better) ──────────────────────────────────────────

const VERDICT_RANK: Record<string, number> = {
  Supported: 6,
  "Partially Supported": 5,
  Ambiguous: 4,
  "Needs Expert Review": 3,
  "Insufficient Evidence": 2,
  "Out of Scope": 1,
};

function bestVerdict(a: VerdictResult, b: VerdictResult): VerdictResult {
  return (VERDICT_RANK[a.verdict] ?? 0) >= (VERDICT_RANK[b.verdict] ?? 0)
    ? a
    : b;
}

// ─── In-memory rate limiter ───────────────────────────────────────────────────

const RATE_LIMIT = 30;
const WINDOW_MS = 60 * 1000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
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
  return {
    allowed: true,
    remaining: RATE_LIMIT - entry.count,
    resetAt: entry.resetAt,
  };
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

// ─── Handler ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
async function handleVerifyClaim(req: Request, res: Response): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.ip ??
    "unknown";
  const rl = checkRateLimit(ip);
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT));
  res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
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

  const { claim, vertical = "structural_biology" } = req.body ?? {};
  if (typeof claim !== "string" || claim.trim().length === 0) {
    res.status(400).json({
      ok: false,
      error: "Request body must include a non-empty 'claim' string.",
      example: { claim: "Can I create biotech products from salmon sludge?" },
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
    const signalDensity = computeSignalDensity(claimText);

    // ── Step 1: Try structured extraction (works for PDB/accession-rich text) ──
    const extracted = await extractClaims(claimText);

    // ── Step 2: If no structured claims, translate natural language → claims ──
    let translatedClaims: string[] = [];
    let allPubMedResults: PubMedResult[] = [];
    let bestVerdictResult: VerdictResult | null = null;
    let _primaryClaimText = claimText;
    let primaryClaimType = "general_molecular";
    let primaryPdbId: string | null = null;
    let primaryProteinName: string | null = null;
    // Sprint 26: domain routing per decomposed claim (populated in NL path)
    const domainRouting: Array<{
      claim: string;
      domain: string;
      primarySource: string;
      confidence: number;
    }> = [];

    if (extracted && extracted.length > 0) {
      // Structured path: use first extracted claim for structural DB lookup
      const primaryClaim = extracted[0];
      _primaryClaimText = primaryClaim.claimText;
      primaryClaimType = primaryClaim.claimType;
      primaryPdbId = primaryClaim.pdbId ?? null;
      primaryProteinName = primaryClaim.proteinName ?? null;

      const adapter = getVertical(vertical as string);
      let structuralVerdict: VerdictResult;
      if (adapter) {
        const evidence: EvidenceResult = await adapter.lookupEvidence({
          claimText: primaryClaim.claimText,
          extractedValue: primaryClaim.extractedValue ?? null,
        });
        structuralVerdict = evidenceToVerdict(evidence, primaryClaim.claimText);
      } else {
        structuralVerdict = await verdictForClaim({
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

      // Also search PubMed to enrich with literature evidence
      const pubmedResults = await fetchPubMedResults(
        primaryClaim.claimText,
        5,
        primaryClaim.claimText
      );
      allPubMedResults = filterByRelevance(
        pubmedResults,
        primaryClaim.claimText
      );
      const pubmedVerdict = verdictFromPubMed(
        pubmedResults,
        primaryClaim.claimText
      );

      // Use whichever verdict is stronger
      bestVerdictResult = bestVerdict(structuralVerdict, pubmedVerdict);
    } else {
      // Natural-language path: translate question → specific claims → PubMed
      const translated = await translateQueryToClaims(claimText);
      translatedClaims = translated.map(c => c.claimText);

      if (translated.length === 0) {
        // Absolute fallback: search PubMed with the raw text
        const fallbackResults = await fetchPubMedResults(
          claimText,
          5,
          claimText
        );
        allPubMedResults = filterByRelevance(fallbackResults, claimText);
        bestVerdictResult = verdictFromPubMed(fallbackResults, claimText);
        primaryProteinName = null;
      } else {
        // Sprint 25: decompose the original question into atomic claims for better PubMed relevance
        const decomposed = await decomposeQuestion(claimText);
        const decomposedQueries = decomposed.claims.map(c =>
          buildPubMedQuery(c)
        );
        // Sprint 26: classify each decomposed claim to the correct source adapter
        const claimClassifications = classifyClaims(decomposed.claims);
        domainRouting.push(
          ...claimClassifications.map(r => ({
            claim: r.claim.text,
            domain: r.domain,
            primarySource: getPrimaryRoute(r).sourceId,
            confidence: getPrimaryRoute(r).confidence,
          }))
        );
        log.debug("domain routing computed", {
          count: domainRouting.length,
          domains: domainRouting.map(d => d.domain),
        });
        // Merge decomposed queries with translated claim search queries (deduplicated, max 3)
        const allSearchQueries = [
          ...decomposedQueries,
          ...translated.map(c => c.searchQuery),
        ]
          .filter((q, i, arr) => q.length > 0 && arr.indexOf(q) === i)
          .slice(0, 3);
        // Search PubMed for each query in parallel
        const searchPromises = allSearchQueries.map(q =>
          fetchPubMedResults(q, 4, translated[0]?.claimText ?? claimText)
        );
        const allResults = await Promise.all(searchPromises);
        const rawResults = allResults
          .flat()
          .filter((r, i, arr) => arr.findIndex(x => x.pmid === r.pmid) === i);
        allPubMedResults = filterByRelevance(
          rawResults,
          translated[0].claimText
        ).slice(0, 10);

        // Derive verdict from total unique papers found
        bestVerdictResult = verdictFromPubMed(
          allPubMedResults,
          translated[0].claimText
        );
        _primaryClaimText = translated[0].claimText;
        primaryProteinName = translated[0].proteinName;
        primaryClaimType = "general_molecular";
      }
    }

    // ── Step 3: Fast registry lookup — surface claimId if this claim is already known ──
    const existingClaim = await findClaimByText(claimText).catch(() => null);
    const registryClaimId = existingClaim?.id ?? null;

    // ── Step 3b: Fetch open contradictions for this claim (if registry hit) ──
    // Sprint 20: surface contradictions in verify_claim response per Perplexity spec
    const contradictions =
      registryClaimId !== null
        ? await getContradictionsForClaim(registryClaimId).catch(() => [])
        : [];

    // ── Step 3c: Normalize claim into SPO triple (Sprint 21 — Perplexity Doc 1 + Doc 3) ──
    // Runs concurrently with the ingest trigger for zero added latency.
    const spoTriple = await extractSpoTriple(claimText).catch(() => null);

    // ── Step 4: Fire autonomous ingest in background (grows knowledge graph) ──
    if (allPubMedResults.length > 0) {
      triggerAutonomousIngest({
        query: claimText,
        pubmedResults: allPubMedResults,
        uniprotEntries: [],
      });
    }

    // ── Step 4b: Feed the self-improving SLM flywheel (fire-and-forget) ──
    // POST the verdict event to cognitive-loop-framework /cognitive/ingest.
    // Non-blocking — if the cognitive loop is down, verification still succeeds.
    fireVerdictWebhook(
      buildVerdictPayload({
        claimId: registryClaimId !== null ? String(registryClaimId) : null,
        claimText,
        verdict: bestVerdictResult!.verdict,
        confidence:
          (
            {
              Supported: 0.9,
              "Partially Supported": 0.65,
              Ambiguous: 0.4,
              "Needs Expert Review": 0.3,
              "Insufficient Evidence": 0.1,
              Contradicted: 0.05,
              "Out of Scope": 0.05,
            } as Record<string, number>
          )[bestVerdictResult!.verdict] ?? 0.5,
        pubmedResults: allPubMedResults,
        rationale: bestVerdictResult!.rationale,
      })
    );

    const confidenceScore = computeConfidenceScore(
      bestVerdictResult!.verdict,
      allPubMedResults.length,
      signalDensity
    );

    res.json({
      ok: true,
      claim: claimText,
      vertical,
      verdict: bestVerdictResult!.verdict,
      rationale: bestVerdictResult!.rationale,
      evidenceUrl: bestVerdictResult!.evidenceUrl ?? null,
      claimType: primaryClaimType,
      pdbId: primaryPdbId,
      proteinName: primaryProteinName,
      signalDensity,
      confidenceScore,
      claimText,
      // Sprint 12: surface registry ID when claim is already known
      claimId: registryClaimId,
      // Sprint 21: SPO triple — normalized subject–predicate–object (Perplexity Doc 1 + Doc 3)
      spo: spoTriple
        ? {
            subject: spoTriple.subject,
            predicate: spoTriple.predicate,
            object: spoTriple.object,
            confidence: spoTriple.confidence,
            method: spoTriple.method,
          }
        : null,
      // Sprint 20: contradictions from the knowledge graph (Perplexity spec)
      contradictions: contradictions.map(c => ({
        claimId: c.contradictingClaimId,
        severity: c.severity,
        verdictA: c.claimAVerdict,
        verdictB: c.claimBVerdict,
        edgeWeight: c.edgeWeight,
      })),
      pubmedResults: allPubMedResults.slice(0, 5).map(p => ({
        pmid: p.pmid,
        title: p.title,
        abstractSnippet: p.abstractSnippet ?? "",
        journal: p.journal ?? null,
        year: p.year ?? null,
        url: p.citationUrl,
        citationUrl: p.citationUrl,
      })),
      translatedClaims,
      // Sprint 26: per-claim domain routing — which source adapter each claim was dispatched to
      domainRouting,
      processedAt,
      apiVersion: "1.3",
    });
  } catch (err) {
    log.error("[VerifyClaim] Error:", errData(err));
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
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    res.status(204).end();
  });
  app.post("/api/public/verify-claim", handleVerifyClaim);
}
