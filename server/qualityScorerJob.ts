/**
 * qualityScorerJob.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Heartbeat handler for the quality scoring pipeline.
 * Registered at POST /api/scheduled/quality-scorer
 *
 * Runs every 6 hours via Manus heartbeat to:
 *  1. Score all unscored claims (confidenceScore IS NULL)
 *  2. Re-score claims whose evidence was checked more than 7 days ago
 *  3. Return a summary of the run for monitoring
 */
import type { Request, Response } from "express";
import { runQualityScorerJob } from "./claimQualityScorer";
import { ENV } from "./_core/env";

export async function qualityScorerJobHandler(req: Request, res: Response): Promise<void> {
  // Validate heartbeat secret
  const envAny = ENV as unknown as Record<string, unknown>;
  const heartbeatSecret = typeof envAny["HEARTBEAT_SECRET"] === "string"
    ? envAny["HEARTBEAT_SECRET"]
    : "";
  const providedSecret = req.headers["x-heartbeat-secret"] as string | undefined;

  if (heartbeatSecret && providedSecret !== heartbeatSecret) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  console.log("[QualityScorerJob] Starting quality scoring run...");
  const startMs = Date.now();

  try {
    const result = await runQualityScorerJob();
    const totalMs = Date.now() - startMs;

    console.log(
      `[QualityScorerJob] Complete: scored=${result.scored} errors=${result.errors} ` +
      `duration=${totalMs}ms`
    );

    res.json({
      ok: true,
      scored: result.scored,
      errors: result.errors,
      durationMs: totalMs,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[QualityScorerJob] Fatal error:", error);
    res.status(500).json({ ok: false, error });
  }
}
