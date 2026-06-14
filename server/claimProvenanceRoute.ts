import type { Express, Response } from "express";
import { getClaimById } from "./db";
import { getChain, summarize } from "./claimProvenanceService";

function apiError(res: Response, status: number, message: string) {
  return res.status(status).json({ ok: false, error: message });
}
function apiOk<T>(res: Response, data: T) {
  return res.json({ ok: true, data });
}

/**
 * GET /api/v2/claims/:id/provenance
 *
 * Returns the full provenance chain for a claim plus a summary:
 *   - chain: ProvenanceChainEntry[] — every step the claim passed through
 *   - summary: ProvenanceSummary — totals, actors, duration
 */
export function registerClaimProvenanceRoute(app: Express): void {
  app.get("/api/v2/claims/:id/provenance", async (req, res) => {
    const claimId = parseInt(req.params.id, 10);
    if (isNaN(claimId)) {
      return apiError(res, 400, "Invalid claim id");
    }

    const claim = await getClaimById(claimId);
    if (!claim) {
      return apiError(res, 404, "Claim not found");
    }

    const chain = await getChain(claimId);
    const summary = summarize(chain);

    return apiOk(res, { claimId, chain, summary });
  });
}
