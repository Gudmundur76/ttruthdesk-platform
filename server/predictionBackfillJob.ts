/**
 * predictionBackfillJob.ts
 *
 * Heartbeat handler: POST /api/scheduled/backfill-predictions
 *
 * Runs in batches of 50 claims per invocation (2-minute Cloud Run timeout).
 * Picks claims that:
 *   - have a non-null verdict
 *   - do NOT yet have a prediction_models row (targetClaimId IS NULL in prediction_models)
 *
 * Safe to run multiple times (idempotent via LEFT JOIN check).
 */

import type { Request, Response } from "express";
import { getDb } from "./db";
import { computeClaimTrajectory, savePrediction } from "./predictionEngine";
import { claims, documents, predictionModels } from "../drizzle/schema";
import { isNotNull, eq } from "drizzle-orm";
import { logger, errData } from "./logger";
const log = logger("predictionBackfillJob");


const BATCH_SIZE = 50;

export async function predictionBackfillHandler(req: Request, res: Response) {
  try {
    const { sdk } = await import("./_core/sdk");
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) {
      return res.status(403).json({ error: "cron-only" });
    }

    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: "db-unavailable" });
    }

    // Find claims with a verdict but no prediction row
    // Join documents to get userId (claims table has no userId column)
    const claimsWithoutPrediction = await db
      .select({
        id: claims.id,
        userId: documents.userId,
        verdict: claims.verdict,
      })
      .from(claims)
      .innerJoin(documents, eq(documents.id, claims.documentId))
      .where(isNotNull(claims.verdict))
      .limit(BATCH_SIZE);

    // Filter to only those without a prediction (leftJoin produces null predictionModels.id)
    // Since drizzle leftJoin doesn't expose the joined id directly in the select above,
    // we do a subquery approach: fetch all predicted claim IDs, then exclude them.
    const predictedClaimIds = (
      await db
        .select({ targetClaimId: predictionModels.targetClaimId })
        .from(predictionModels)
        .where(isNotNull(predictionModels.targetClaimId))
    ).map((r) => r.targetClaimId as number);

    const unpredicted = claimsWithoutPrediction.filter(
      (c) => !predictedClaimIds.includes(c.id)
    );

    if (unpredicted.length === 0) {
      return res.json({ ok: true, processed: 0, message: "All claims already have predictions" });
    }

    let processed = 0;
    let errors = 0;

    for (const claim of unpredicted) {
      try {
        const prediction = await computeClaimTrajectory(claim.id, claim.userId ?? 0);
        await savePrediction({
          modelType: "claim_trajectory",
          targetClaimId: claim.id,
          targetEntityId: null,
          targetUserId: claim.userId ?? 0,
          prediction: prediction as unknown as Record<string, unknown>,
          baseRate: prediction.baseRate,
          featuresUsed: prediction.factors as unknown as Record<string, unknown>,
          validationResult: "pending",
        });
        processed++;
      } catch (err) {
        log.warn(`[BackfillJob] Failed to compute prediction for claim ${claim.id}:`, errData(err));
        errors++;
      }
    }

    log.info(`[BackfillJob] Processed ${processed} claims, ${errors} errors`);
    return res.json({
      ok: true,
      processed,
      errors,
      remaining: unpredicted.length - processed,
    });
  } catch (err) {
    log.error("[BackfillJob] Fatal error:", errData(err));
    return res.status(500).json({
      error: String(err),
      timestamp: new Date().toISOString(),
    });
  }
}
