/**
 * dreamStartRoute.ts — POST /api/v2/dream/start
 * ─────────────────────────────────────────────────────────────────────────────
 * Manually triggers a Dream State session with the following guardrails:
 *
 *   1. Kill switch: DREAM_DISABLED env flag → 503
 *   2. Rate limit: eligibility check (6h cooldown) → 429
 *   3. Health threshold: healthScore < 40 → 422
 *   4. Audit log: dreamSessions.manualTrigger = true (set by runDreamSession)
 *   5. After completion: bridge dream claims to ingest pipeline
 */
import type { Request, Response } from "express";
import { Router as makeRouter } from "express";
import { checkDreamEligibility, runDreamSession } from "./dreamEngine";
import { bridgeDreamClaimsToIngest } from "./dreamIngestBridge";
import { logger, errData } from "../logger";

const log = logger("dream/dreamStartRoute");

export function createDreamStartRouter() {
  const router = makeRouter();

  /** POST /start — manually trigger a dream session */
  router.post("/start", async (req: Request, res: Response) => {
    // ── Guardrail 1: Kill switch ───────────────────────────────────────────
    if (process.env.DREAM_DISABLED === "true") {
      res.status(503).json({ error: "Dream State is disabled via DREAM_DISABLED flag" });
      return;
    }

    const { healthScore = 50 } = req.body as { healthScore?: number };

    try {
      // ── Guardrail 2+3: Eligibility (rate limit + health threshold) ────────
      const eligibility = await checkDreamEligibility(healthScore);

      if (!eligibility.eligible) {
        const reason = eligibility.reason ?? "Not eligible";
        // Distinguish rate-limit (cooldown) from health threshold
        if (reason.toLowerCase().includes("cooldown") || reason.toLowerCase().includes("ago")) {
          res.status(429).json({ error: reason });
          return;
        }
        if (reason.toLowerCase().includes("health") || reason.toLowerCase().includes("score")) {
          res.status(422).json({ error: reason });
          return;
        }
        // Generic ineligibility
        res.status(422).json({ error: reason });
        return;
      }

      // ── Run dream session (manualTrigger = true for audit log) ────────────
      const result = await runDreamSession({
        healthScore,
        manualTrigger: true,
      });

      if (!result) {
        res.status(503).json({ error: "Dream session unavailable — database connection failed" });
        return;
      }

      // ── Bridge dream claims to ingest pipeline ────────────────────────────
      const bridgeResult = await bridgeDreamClaimsToIngest();
      log.info(`Dream session ${result.sessionId} complete; bridged ${bridgeResult.queued} claims to ingest`);

      res.json({
        sessionId: result.sessionId,
        durationMs: result.durationMs,
        cyclesCompleted: result.cyclesCompleted,
        reasonForWaking: result.reasonForWaking,
        patternsFound: result.patternsFound,
        hypothesesGenerated: result.hypothesesGenerated,
        graphOptimizations: result.graphOptimizations,
        confidenceRecalibrations: result.confidenceRecalibrations,
        simulatedScenarios: result.simulatedScenarios,
        bridge: {
          queued: bridgeResult.queued,
          skipped: bridgeResult.skipped,
        },
      });
    } catch (err: unknown) {
      log.error("POST /dream/start failed", errData(err));
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
