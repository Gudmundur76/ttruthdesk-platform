/**
 * findSimilarRoute.ts — Phase 124b
 *
 * HTTP route:  GET /api/public/similar/:claimId?topK=5&threshold=0.7
 * MCP tool:    find_similar (tool #12)
 *
 * Wraps claimSimilarityEngine.findSimilarToClaimId() with:
 *   - CORS headers for public access
 *   - Staleness indicator: sourceIsStale = true when claim.updatedAt > 90 days ago
 *   - topK / threshold query params (defaults: topK=10, threshold=0.35)
 *   - Structured MCP tool manifest
 */
import type { Express, Request, Response } from "express";
import { getClaimById } from "./db";
import { findSimilarToClaimId } from "./claimSimilarityEngine";
import { logger, errData } from "./logger";

const log = logger("findSimilarRoute");

// ─── Constants ────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const STALE_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const DEFAULT_TOP_K = 10;
const DEFAULT_THRESHOLD = 0.35;
const MAX_TOP_K = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isStale(updatedAt: Date | null | undefined): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() > STALE_THRESHOLD_MS;
}

// ─── HTTP Route ───────────────────────────────────────────────────────────────

export function registerFindSimilarRoute(app: Express): void {
  // CORS preflight
  app.options(
    "/api/public/similar/:claimId",
    (_req: Request, res: Response) => {
      res.set(CORS_HEADERS).status(204).end();
    }
  );

  app.get(
    "/api/public/similar/:claimId",
    async (req: Request, res: Response) => {
      const claimId = parseInt(req.params.claimId, 10);
      if (isNaN(claimId) || claimId <= 0) {
        return res
          .set(CORS_HEADERS)
          .status(400)
          .json({ error: "Invalid claim id" });
      }

      const topK = Math.min(
        parseInt(String(req.query.topK ?? DEFAULT_TOP_K), 10) || DEFAULT_TOP_K,
        MAX_TOP_K
      );
      const threshold =
        parseFloat(String(req.query.threshold ?? DEFAULT_THRESHOLD)) ||
        DEFAULT_THRESHOLD;

      try {
        const claim = await getClaimById(claimId);
        if (!claim) {
          return res
            .set(CORS_HEADERS)
            .status(404)
            .json({ error: "Claim not found" });
        }

        const similar = await findSimilarToClaimId(claimId, {
          topK,
          threshold,
        });

        return res
          .set({ ...CORS_HEADERS, "Content-Type": "application/json" })
          .status(200)
          .json({
            claimId,
            sourceIsStale: isStale(
              (claim as Record<string, unknown>).updatedAt as Date
            ),
            topK,
            threshold,
            count: similar.length,
            similar,
          });
      } catch (err) {
        log.warn("[findSimilarRoute] Unexpected error", errData(err));
        return res
          .set(CORS_HEADERS)
          .status(500)
          .json({ error: "Internal server error" });
      }
    }
  );
}

// ─── MCP Tool Manifest ────────────────────────────────────────────────────────

export const FIND_SIMILAR_TOOLS_MANIFEST = [
  {
    name: "find_similar",
    description:
      "Find semantically similar verified claims to a given claim ID. " +
      "Uses TF-IDF cosine similarity over the claim corpus. " +
      "Returns up to top_k results above the similarity threshold, " +
      "with a staleness indicator if the source claim is older than 90 days.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: {
          type: ["integer", "string"],
          description: "The ID of the source claim to find similar claims for",
        },
        top_k: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: `Maximum number of similar claims to return (default: ${DEFAULT_TOP_K})`,
        },
        threshold: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: `Minimum cosine similarity score to include (default: ${DEFAULT_THRESHOLD})`,
        },
      },
      required: ["claim_id"],
      additionalProperties: false,
    },
  },
] as const;

// ─── MCP Tool Handler ─────────────────────────────────────────────────────────

export async function toolFindSimilar(
  params: Record<string, unknown>
): Promise<unknown> {
  const rawId = params["claim_id"];
  if (rawId === undefined || rawId === null) {
    throw new Error("Missing required parameter: claim_id");
  }
  const claimId =
    typeof rawId === "string" ? parseInt(rawId, 10) : Number(rawId);
  if (isNaN(claimId) || claimId <= 0) {
    throw new Error(`Invalid claim_id: ${String(rawId)}`);
  }

  const topK = Math.min(
    typeof params["top_k"] === "number" ? params["top_k"] : DEFAULT_TOP_K,
    MAX_TOP_K
  );
  const threshold =
    typeof params["threshold"] === "number"
      ? params["threshold"]
      : DEFAULT_THRESHOLD;

  const claim = await getClaimById(claimId);
  if (!claim) {
    return { notFound: true, claimId };
  }

  const similar = await findSimilarToClaimId(claimId, { topK, threshold });

  log.info("find_similar called", { claimId, resultCount: similar.length });

  return {
    claimId,
    sourceIsStale: isStale(
      (claim as Record<string, unknown>).updatedAt as Date
    ),
    topK,
    threshold,
    count: similar.length,
    similar,
  };
}
