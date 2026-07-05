/**
 * publicV1SearchRoute.ts — GET /v1/search
 *
 * Public search endpoint for the citation.is corpus.
 * Returns paginated verified claims matching a query string.
 *
 * Authentication: Bearer token via `Authorization: Bearer <CITATION_API_KEY>`.
 * If CITATION_API_KEY is not set in env, the endpoint returns 503.
 *
 * Query parameters:
 *   q        — search query (required)
 *   page     — page number, 1-indexed (default: 1)
 *   limit    — results per page, max 50 (default: 20)
 *   verdict  — filter by verdict: "Supported" | "Contradicted" | "Insufficient Evidence"
 *   domain   — filter by domain slug (e.g. "structural_biology")
 *
 * Response shape:
 *   {
 *     "query": string,
 *     "page": number,
 *     "limit": number,
 *     "total": number,
 *     "results": Array<{
 *       "id": string,
 *       "claim": string,
 *       "verdict": string,
 *       "confidenceScore": number,
 *       "domain": string,
 *       "sources": string[],
 *       "verifiedAt": string
 *     }>
 *   }
 */
import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";
import { getPaginatedPublicClaims } from "./db";

// ─── Auth guard (same pattern as publicV1VerifyRoute) ─────────────────────────
function checkAuth(req: Request, res: Response): boolean {
  if (!ENV.citationApiKey) {
    res.status(503).json({
      error: "Service unavailable: CITATION_API_KEY not configured",
      code: "SERVICE_UNAVAILABLE",
    });
    return false;
  }
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== ENV.citationApiKey) {
    res.status(401).json({
      error: "Unauthorized: missing or invalid Bearer token",
      code: "UNAUTHORIZED",
    });
    return false;
  }
  return true;
}

// ─── Route registration ───────────────────────────────────────────────────────
export function registerV1SearchRoute(app: Express): void {
  app.get("/v1/search", async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;

    const query = (req.query.q as string | undefined)?.trim() ?? "";
    if (!query) {
      res.status(400).json({
        error: "Missing required parameter: q",
        code: "MISSING_QUERY",
      });
      return;
    }

    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) ?? "20", 10) || 20));
    const verdictFilter = (req.query.verdict as string | undefined)?.trim();
    const domainFilter = (req.query.domain as string | undefined)?.trim();

    try {
      // Use the existing DB function to get paginated results
      const { data, total } = await getPaginatedPublicClaims({
        page,
        limit,
        searchQuery: query,
        domain: domainFilter,
        verdict: verdictFilter,
      });

      const results = data.map((row) => {
        const pmids = Array.isArray(row.pmid_list)
          ? (row.pmid_list as string[]).map((p: string) => `pubmed:${p}`)
          : [];
        const pdb = row.pdb_id ? [`pdb:${row.pdb_id}`] : [];
        return {
          id: row.id.toString(),
          claim: row.claim_text,
          verdict: row.verdict ?? "Unknown",
          confidenceScore: parseFloat(row.confidence_score ?? "0"),
          domain: row.domain ?? "unknown",
          sources: [...pmids, ...pdb],
          verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : new Date().toISOString(),
        };
      });

      res.json({
        query,
        page,
        limit,
        total,
        results,
      });
    } catch (err) {
      console.error("[v1/search] error:", err);
      res.status(500).json({
        error: "Internal server error",
        code: "INTERNAL_ERROR",
      });
    }
  });
}
