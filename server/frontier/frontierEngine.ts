/**
 * frontierEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontier Engine — Orchestrator (Layer 3 of the Three-Layer Architecture)
 *
 * Coordinates the full Frontier Engine pipeline:
 *   1. Gap Mapping   — scan graph for structural/evidence/contradiction/temporal gaps
 *   2. Gap Ranking   — score gaps by priority formula
 *   3. Evidence Pursuit — queue evidence pursuit for top gaps
 *   4. Hypothesis Generation — generate testable hypotheses from verified patterns
 *   5. Stale Gap Cleanup — mark abandoned gaps as stale
 *
 * Authority Boundaries (from the paper):
 *   ✅ Writes directly: knowledge_gaps, coord_queue, frontier_log
 *   ❌ NEVER writes: graph_entities, graphRelations, claims, verdicts
 *   ❌ NEVER assigns confidence scores or evidence URLs
 *   ✅ Submits hypotheses for verification: coord_queue (source: "frontier_hypothesis")
 *
 * The Frontier Engine is a loopback mechanism, not a bypass.
 * Every claim it generates must pass through Friction → Truth → Verdict.
 */

import { runGapMapper, type GapMapResult } from "./gapMapper";
import { rankAllOpenGaps } from "./gapRanker";
import { pursueTopGaps, type PursuitResult } from "./evidencePursuer";
import {
  runHypothesisGenerator,
  type HypothesisGenerationResult,
} from "./hypothesisGenerator";
import {
  markStaleGaps,
  getFrontierMetrics,
  type FrontierMetrics,
} from "./uncertaintyTracker";
import { directiveStore, type DirectiveEffect } from "./directiveStore";
import { frontierCircuitBreaker } from "./circuitBreaker";
import { logger, errData } from "../logger";
import { getDb } from "../db";
import { frontierLog } from "../../drizzle/schema";
const log = logger("frontier/frontierEngine");


// ─── Types ────────────────────────────────────────────────────────────────────

export interface FrontierEngineRunResult {
  /** Timestamp of this run */
  runAt: Date;
  /** Gap mapping results (null if skipped by directive) */
  gapMapping: GapMapResult;
  /** Number of gaps scored by the ranker */
  gapsRanked: number;
  /** Evidence pursuit results for top gaps */
  pursuitResults: PursuitResult[];
  /** Hypothesis generation results */
  hypothesisGeneration: HypothesisGenerationResult;
  /** Number of stale gaps marked */
  staleGapsMarked: number;
  /** Current Frontier metrics */
  metrics: FrontierMetrics;
  /** Total wall time in ms */
  durationMs: number;
  /** Build3: Directive effects applied this cycle */
  directiveEffect: DirectiveEffect;
  /** Build3: Number of directives consumed this cycle */
  directivesConsumed: number;
}

// ─── Public: runFrontierEngine ────────────────────────────────────────────────

/**
 * Runs the full Frontier Engine pipeline.
 * Called by the heartbeat scheduler or manually via admin tRPC.
 *
 * Non-fatal: each stage is wrapped in try/catch so a failure in one stage
 * does not prevent subsequent stages from running.
 */
export async function runFrontierEngine(): Promise<FrontierEngineRunResult> {
  const startTime = Date.now();
  log.info("[FrontierEngine] Starting full pipeline run...");

  // ── Build3: Read active directives at cycle start (FR-L3-26) ────────────────
  const directiveEffect = directiveStore.applyDirectives();
  const directivesConsumed = directiveStore.activeCount();

  if (directivesConsumed > 0) {
    log.info("[FrontierEngine] Directives active this cycle", {
      count: directivesConsumed,
      skippedMapping: directiveEffect.skippedMapping,
      focusGapIds: directiveEffect.focusGapIds,
      deepDiveEntityId: directiveEffect.deepDiveEntityId,
      extraHypotheses: directiveEffect.extraHypotheses,
    });
  }

  // Emit frontier.cycle.start (FR-L3-31)
  await emitCycleEvent("frontier.cycle.start", {
    directivesActive: directivesConsumed,
    directiveEffect,
    circuitBreakerOpen: frontierCircuitBreaker.isOpen,
  }).catch(() => {});

  // Stage 1: Gap Mapping (skipped if skip_mapping directive is active)
  let gapMapping: GapMapResult = {
    structural: 0,
    evidence: 0,
    contradiction: 0,
    temporal: 0,
    total: 0,
    newGapsCreated: 0,
  };
  if (directiveEffect.skippedMapping) {
    log.info("[FrontierEngine] Stage 1 (Gap Mapping) skipped by directive");
  } else {
    try {
      gapMapping = await runGapMapper();
      log.info(
        `[FrontierEngine] Gap mapping: ${gapMapping.newGapsCreated} new gaps detected`
      );
    } catch (err) {
      log.warn("[FrontierEngine] Gap mapping failed (non-fatal):", errData(err));
    }
  }

  // Stage 2: Gap Ranking (with focus_gap directive boost)
  let gapsRanked = 0;
  try {
    gapsRanked = await rankAllOpenGaps(directiveEffect.focusGapIds);
    log.info(`[FrontierEngine] Gap ranking: ${gapsRanked} gaps scored`);
  } catch (err) {
    log.warn("[FrontierEngine] Gap ranking failed (non-fatal):", errData(err));
  }

  // Stage 3: Evidence Pursuit (deep_dive_entity or top 5 gaps)
  let pursuitResults: PursuitResult[] = [];
  try {
    if (directiveEffect.deepDiveEntityId) {
      const entityIdNum = parseInt(directiveEffect.deepDiveEntityId, 10);
      pursuitResults = await pursueTopGaps(10, isNaN(entityIdNum) ? undefined : entityIdNum);
      log.info(
        `[FrontierEngine] Deep-dive pursuit: ${pursuitResults.length} gaps for entity ${directiveEffect.deepDiveEntityId}`
      );
    } else {
      pursuitResults = await pursueTopGaps(5);
      log.info(
        `[FrontierEngine] Evidence pursuit: ${pursuitResults.length} gaps pursued`
      );
    }
  } catch (err) {
    log.warn("[FrontierEngine] Evidence pursuit failed (non-fatal):", errData(err));
  }

  // Stage 4: Hypothesis Generation (circuit-breaker guarded)
  const maxHypotheses = 5 + directiveEffect.extraHypotheses;
  let hypothesisGeneration: HypothesisGenerationResult = {
    hypothesesGenerated: 0,
    queueItemsCreated: 0,
    hypotheses: [],
    skippedByCircuitBreaker: false,
  };
  try {
    hypothesisGeneration = await runHypothesisGenerator(maxHypotheses);
    if (hypothesisGeneration.skippedByCircuitBreaker) {
      log.warn("[FrontierEngine] Stage 4 skipped by circuit breaker");
    } else {
      log.info(
        `[FrontierEngine] Hypothesis generation: ${hypothesisGeneration.hypothesesGenerated} hypotheses, ${hypothesisGeneration.queueItemsCreated} queued`
      );
    }
  } catch (err) {
    log.warn(
      "[FrontierEngine] Hypothesis generation failed (non-fatal):",
      errData(err)
    );
  }

  // Stage 5: Stale Gap Cleanup
  let staleGapsMarked = 0;
  try {
    staleGapsMarked = await markStaleGaps();
    if (staleGapsMarked > 0) {
      log.info(
        `[FrontierEngine] Stale cleanup: ${staleGapsMarked} gaps marked stale`
      );
    }
  } catch (err) {
    log.warn("[FrontierEngine] Stale cleanup failed (non-fatal):", errData(err));
  }

  // Metrics
  const metrics = await getFrontierMetrics().catch(() => ({
    totalGapsDetected: 0,
    openGaps: 0,
    pursuedGaps: 0,
    closedVerified: 0,
    closedResolved: 0,
    staleGaps: 0,
    hypothesesQueued: 0,
    hypothesesVerified: 0,
    hypothesesRefuted: 0,
    avgDaysToClosureHigh: null,
    falseHypothesisRate: null,
    closureRate30Days: null,
  }));

  const durationMs = Date.now() - startTime;

  // ── Build3: Clear consumed directives (FR-L3-28) ─────────────────────────────────
  directiveStore.clearConsumed();

  // ── Build3: Write MetricReport to frontier_log (FR-L3-32) ─────────────────────────
  await writeMetricReport({
    gapMapping, gapsRanked, pursuitResults, hypothesisGeneration,
    staleGapsMarked, metrics, durationMs, directiveEffect, directivesConsumed,
  }).catch(() => {});

  // Emit frontier.cycle.complete (FR-L3-31)
  await emitCycleEvent("frontier.cycle.complete", {
    durationMs,
    gapsRanked,
    hypothesesGenerated: hypothesisGeneration.hypothesesGenerated,
    directivesConsumed,
    circuitBreakerOpen: frontierCircuitBreaker.isOpen,
  }).catch(() => {});

  log.info(`[FrontierEngine] Pipeline complete in ${durationMs}ms`);

  return {
    runAt: new Date(),
    gapMapping,
    gapsRanked,
    pursuitResults,
    hypothesisGeneration,
    staleGapsMarked,
    metrics,
    durationMs,
    directiveEffect,
    directivesConsumed,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────────────────────

async function emitCycleEvent(
  eventType: "frontier.cycle.start" | "frontier.cycle.complete",
  payload: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(frontierLog).values({
    actionType: "cycle_event",
    reasoning: { eventType, ...payload },
    outcome: eventType,
  });
}

async function writeMetricReport(data: {
  gapMapping: GapMapResult;
  gapsRanked: number;
  pursuitResults: PursuitResult[];
  hypothesisGeneration: HypothesisGenerationResult;
  staleGapsMarked: number;
  metrics: FrontierMetrics;
  durationMs: number;
  directiveEffect: DirectiveEffect;
  directivesConsumed: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(frontierLog).values({
    actionType: "metric_report",
    reasoning: {
      gapMapping: data.gapMapping,
      gapsRanked: data.gapsRanked,
      pursuitCount: data.pursuitResults.length,
      hypothesesGenerated: data.hypothesisGeneration.hypothesesGenerated,
      hypothesesQueued: data.hypothesisGeneration.queueItemsCreated,
      skippedByCircuitBreaker: data.hypothesisGeneration.skippedByCircuitBreaker,
      staleGapsMarked: data.staleGapsMarked,
      durationMs: data.durationMs,
      directivesConsumed: data.directivesConsumed,
      directiveEffect: data.directiveEffect,
      circuitBreakerState: frontierCircuitBreaker.getState(),
    },
    outcome: `Frontier cycle complete: ${data.gapMapping.newGapsCreated} new gaps, ${data.hypothesisGeneration.hypothesesGenerated} hypotheses in ${data.durationMs}ms`,
  });
}

// ─── Re-exports for convenience ───────────────────────────────────────────────

export { getFrontierMetrics, getGapTimeline } from "./uncertaintyTracker";
export {} from "./gapRanker";
export { detectEvidenceGapForDocument } from "./gapMapper";
export { closeGap } from "./evidencePursuer";
export { recordHypothesisOutcome } from "./hypothesisGenerator";
