/**
 * @file server/publicV1SearchRoute.ts
 * @description Public API endpoint for searching the citation.is verified claims corpus.
 *   GET /api/v1/search?q=aspirin&page=1&limit=20
 *   Requires Bearer token auth (CITATION_API_KEY).
 */
import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";
import { getPaginatedPublicClaims } from "./db";

// ─── Auth guard (same pattern as publicV1VerifyRoute) ─────────────────────────
function checkAuth(req: Request, res: Response): boolean {
  if (!ENV.citationApiKey) {
    // If the server doesn't have an API key configured, deny all public API access
    res.status(503).json({ error: "API key not configured on server" });
    return false;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return false;
  }

  const token = authHeader.split(" ")[1];
  if (token !== ENV.citationApiKey) {
    res.status(403).json({ error: "Invalid API key" });
    return false;
  }

  return true;
}

export function registerPublicV1SearchRoute(app: Express) {
  app.get("/api/v1/search", async (req: Request, res: Response) => {
    // 1. Check Auth
    if (!checkAuth(req, res)) return;

    // 2. Parse Query Params
    const query = (req.query.q as string | undefined)?.trim();
    if (!query) {
      return res.status(400).json({
        error: "Missing search query parameter 'q'",
      });
    }

    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt((req.query.limit as string) || "20", 10))
    );
    const verdictFilter = (req.query.verdict as string | undefined)?.trim();
    const domainFilter = (req.query.domain as string | undefined)?.trim();

    try {
      // Use the existing DB function to get paginated results
      const { rows, total } = await getPaginatedPublicClaims({
        page,
        pageSize: limit,
        q: query,
        vertical: domainFilter,
        verdict: verdictFilter,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results = rows.map((row: any) => {
        const pmids = Array.isArray(row.pmid_list)
          ? (row.pmid_list as string[]).map((p: string) => `pubmed:${p}`)
          : [];
        const pdb = row.pdb_id ? [`pdb:${row.pdb_id}`] : [];
        return {
          id: String(row.id),
          claim: String(row.claim_text || ""),
          verdict: String(row.verdict || "Unknown"),
          confidenceScore: parseFloat(String(row.confidence_score || "0")),
          domain: String(row.domain || "unknown"),
          sources: [...pmids, ...pdb],
          verifiedAt: row.verified_at ? new Date(String(row.verified_at)).toISOString() : new Date().toISOString(),
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
      });
    }
  });
}
