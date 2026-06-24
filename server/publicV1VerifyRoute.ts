/**
 * publicV1VerifyRoute.ts — POST /v1/verify
 *
 * Thin adapter for the cognitive-loop-framework `citationVerifierClient.ts`.
 * Accepts a molecular entity claim (SMILES, DNA/protein sequence, gene name, or
 * natural language) and returns a verdict in the shape the client expects:
 *
 *   { verdict, confidenceScore, sources }
 *
 * Authentication: Bearer token via `Authorization: Bearer <CITATION_API_KEY>`.
 * If CITATION_API_KEY is not set in env, the endpoint returns 503.
 *
 * The endpoint proxies to the existing `handleVerifyClaim` pipeline internally
 * by calling the same `verifyClaimRoute` logic via a local HTTP request so we
 * reuse all rate-limiting, PubMed, PDB, and vertical-routing logic without
 * duplicating it.
 *
 * Response shape (matches citationVerifierClient.ts contract):
 *   { "verdict": "Supported" | "Contradicted" | "Ambiguous",
 *     "confidenceScore": 0.0–1.0,
 *     "sources": ["pubmed:12345678", "pdb:1ABC"],
 *     "citedPmids": ["12345678"] }  // Sprint 41: raw PMID array for evidence graph
 *
 * Error handling (matches client expectations):
 *   401 → missing/invalid token
 *   400 → missing claim
 *   503 → CITATION_API_KEY not configured
 *   5xx → client fails safe, returns { supported: false, confidence: 0 }
 */

import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";

// ─── Verdict normalisation ────────────────────────────────────────────────────
// The cognitive-loop-framework only handles three verdict states.
// Map all internal verdicts to the three the client understands.
const VERDICT_MAP: Record<string, "Supported" | "Contradicted" | "Ambiguous"> = {
  Supported: "Supported",
  "Partially Supported": "Supported",
  Contradicted: "Contradicted",
  Ambiguous: "Ambiguous",
  "Insufficient Evidence": "Ambiguous",
  "Needs Expert Review": "Ambiguous",
  "Out of Scope": "Ambiguous",
};

function normaliseVerdict(v: string): "Supported" | "Contradicted" | "Ambiguous" {
  return VERDICT_MAP[v] ?? "Ambiguous";
}

// ─── Source array builder ─────────────────────────────────────────────────────
// Converts pubmedResults + pdbId from the internal response to the
// "pubmed:PMID" / "pdb:PDBID" format the client expects.
function buildSources(
  pubmedResults: Array<{ pmid?: string | null }>,
  pdbId: string | null | undefined
): string[] {
  const sources: string[] = [];
  for (const p of pubmedResults) {
    if (p.pmid) sources.push(`pubmed:${p.pmid}`);
  }
  if (pdbId) sources.push(`pdb:${pdbId}`);
  return sources;
}

/** Extract raw PMID strings for the evidence graph (Sprint 41). */
function buildCitedPmids(pubmedResults: Array<{ pmid?: string | null }>): string[] {
  return pubmedResults.flatMap(p => (p.pmid ? [p.pmid] : []));
}

// ─── Auth + input guards (extracted to reduce cyclomatic complexity) ─────────

function checkServiceAvailability(res: Response): boolean {
  if (!ENV.citationApiKey) {
    res.status(503).json({
      error: "Service unavailable: CITATION_API_KEY is not configured on this deployment.",
      hint: "Set the CITATION_API_KEY environment variable to enable this endpoint.",
    });
    return false;
  }
  return true;
}

function checkBearerAuth(req: Request, res: Response): boolean {
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || token !== ENV.citationApiKey) {
    res.status(401).json({
      error: "Unauthorized: missing or invalid Bearer token.",
      hint: "Set Authorization: Bearer <CITATION_API_KEY> header.",
    });
    return false;
  }
  return true;
}

function checkClaimInput(claim: unknown, res: Response): claim is string {
  if (typeof claim !== "string" || claim.trim().length === 0) {
    res.status(400).json({
      error: "Request body must include a non-empty 'claim' string.",
      example: {
        claim: "GAGTCCGAGCAGAGGACGAA is a valid therapeutic target",
        context: "molecular_evolution",
      },
    });
    return false;
  }
  return true;
}

async function proxyToVerifyClaim(
  claim: string,
  vertical: string,
  res: Response
): Promise<Record<string, unknown> | null> {
  const localUrl = `http://localhost:${process.env.PORT ?? 3000}/api/public/verify-claim`;
  try {
    const proxyRes = await fetch(localUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim, vertical }),
      signal: AbortSignal.timeout(115_000),
    });
    if (!proxyRes.ok) {
      const status = proxyRes.status === 429 ? 429 : 502;
      const body = (await proxyRes.json().catch(() => ({}))) as Record<string, unknown>;
      res.status(status).json({
        error: body["error"] ?? "Upstream verification failed.",
        retryAfterMs: body["retryAfterMs"] ?? undefined,
      });
      return null;
    }
    return (await proxyRes.json()) as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Upstream verification error: ${msg}` });
    return null;
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

async function handleV1Verify(req: Request, res: Response): Promise<void> {
  if (!checkServiceAvailability(res)) return;
  if (!checkBearerAuth(req, res)) return;

  const { claim, context } = req.body ?? {};
  if (!checkClaimInput(claim, res)) return;

  // Route molecular_evolution context to hiv_protease for best SAR retrieval
  const vertical =
    context === "molecular_evolution" ? "hiv_protease" : "structural_biology";

  const internalResult = await proxyToVerifyClaim(claim.trim(), vertical, res);
  if (!internalResult) return; // proxyToVerifyClaim already sent error response

  const rawVerdict = (internalResult["verdict"] as string | undefined) ?? "Ambiguous";
  const confidenceScore =
    typeof internalResult["confidenceScore"] === "number"
      ? internalResult["confidenceScore"]
      : 0.5;
  const pubmedResults = Array.isArray(internalResult["pubmedResults"])
    ? (internalResult["pubmedResults"] as Array<{ pmid?: string | null }>)
    : [];
  const pdbId = internalResult["pdbId"] as string | null | undefined;

  res.json({
    verdict: normaliseVerdict(rawVerdict),
    confidenceScore,
    sources: buildSources(pubmedResults, pdbId),
    citedPmids: buildCitedPmids(pubmedResults),
    _internal: {
      rawVerdict,
      vertical,
      context: context ?? null,
      claimType: internalResult["claimType"] ?? null,
      apiVersion: internalResult["apiVersion"] ?? null,
    },
  });
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerV1VerifyRoute(app: Express): void {
  app.post("/v1/verify", (req, res) => {
    handleV1Verify(req, res).catch((err: unknown) => {
      console.error("[V1Verify] Unhandled error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error." });
      }
    });
  });

  // CORS preflight for browser-based callers
  app.options("/v1/verify", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
  });
}
