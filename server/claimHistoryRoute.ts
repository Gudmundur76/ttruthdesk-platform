import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, getClaimById } from "./db";
import { claimScoreHistory, confidenceHistory } from "../drizzle/schema";
import type { Response } from "express";

function apiError(res: Response, status: number, message: string) {
  return res.status(status).json({ ok: false, error: message });
}
function apiOk<T>(res: Response, data: T) {
  return res.json({ ok: true, data });
}

/**
 * GET /api/v2/claims/:id/history
 *
 * Returns the full temporal history for a claim:
 *   - scoreHistory: composite truth score over time (claim_score_history)
 *   - confidenceHistory: confidence score over time (confidence_history)
 *
 * Both arrays are ordered oldest → newest.
 */
export function registerClaimHistoryRoute(app: Express): void {
  app.get("/api/v2/claims/:id/history", async (req, res) => {
    const claimId = parseInt(req.params.id, 10);
    if (isNaN(claimId)) {
      return apiError(res, 400, "Invalid claim id");
    }

    const claim = await getClaimById(claimId);
    if (!claim) {
      return apiError(res, 404, "Claim not found");
    }

    const [db1, db2] = await Promise.all([getDb(), getDb()]);
    if (!db1 || !db2) {
      return apiError(res, 503, "Database unavailable");
    }
    const [scoreRows, confidenceRows] = await Promise.all([
      db1
        .select()
        .from(claimScoreHistory)
        .where(eq(claimScoreHistory.claimId, claimId))
        .orderBy(desc(claimScoreHistory.snapshotAt)),
      db2
        .select()
        .from(confidenceHistory)
        .where(eq(confidenceHistory.claimId, claimId))
        .orderBy(desc(confidenceHistory.recordedAt)),
    ]);

    return apiOk(res, {
      claimId,
      scoreHistory: scoreRows.reverse(),
      confidenceHistory: confidenceRows.reverse(),
    });
  });
}
