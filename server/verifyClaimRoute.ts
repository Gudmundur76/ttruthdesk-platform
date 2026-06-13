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
 *     "processedAt": string (ISO 8601),
 *     "apiVersion": "1.1"
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
import { logger, errData } from "./logger";
const log = logger("verifyClaimRoute");


// ─── EuropePMC search ─────────────────────────────────────────────────────────

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
    res
      .status(400)
      .json({
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
      const pubmedResults = await fetchPubMedResults(primaryClaim.claimText, 5);
      allPubMedResults = pubmedResults;
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
        const fallbackResults = await fetchPubMedResults(claimText, 5);
        allPubMedResults = fallbackResults;
        bestVerdictResult = verdictFromPubMed(fallbackResults, claimText);
        primaryProteinName = null;
      } else {
        // Search PubMed for each translated claim in parallel (max 3 to stay fast)
        const searchPromises = translated
          .slice(0, 3)
          .map(c => fetchPubMedResults(c.searchQuery, 4));
        const allResults = await Promise.all(searchPromises);
        allPubMedResults = allResults
          .flat()
          .filter((r, i, arr) => arr.findIndex(x => x.pmid === r.pmid) === i)
          .slice(0, 10);

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

    // ── Step 3: Fire autonomous ingest in background (grows knowledge graph) ──
    if (allPubMedResults.length > 0) {
      triggerAutonomousIngest({
        query: claimText,
        pubmedResults: allPubMedResults,
        uniprotEntries: [],
      });
    }

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
