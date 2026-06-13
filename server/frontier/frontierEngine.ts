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
import { logger, errData } from "../logger";
const log = logger("frontier/frontierEngine");


// ─── Types ────────────────────────────────────────────────────────────────────

export interface FrontierEngineRunResult {
  /** Timestamp of this run */
  runAt: Date;
  /** Gap mapping results */
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

  // Stage 1: Gap Mapping
  let gapMapping: GapMapResult = {
    structural: 0,
    evidence: 0,
    contradiction: 0,
    temporal: 0,
    total: 0,
    newGapsCreated: 0,
  };
  try {
    gapMapping = await runGapMapper();
    log.info(
      `[FrontierEngine] Gap mapping: ${gapMapping.newGapsCreated} new gaps detected`
    );
  } catch (err) {
    log.warn("[FrontierEngine] Gap mapping failed (non-fatal):", errData(err));
  }

  // Stage 2: Gap Ranking
  let gapsRanked = 0;
  try {
    gapsRanked = await rankAllOpenGaps();
    log.info(`[FrontierEngine] Gap ranking: ${gapsRanked} gaps scored`);
  } catch (err) {
    log.warn("[FrontierEngine] Gap ranking failed (non-fatal):", errData(err));
  }

  // Stage 3: Evidence Pursuit (top 5 gaps)
  let pursuitResults: PursuitResult[] = [];
  try {
    pursuitResults = await pursueTopGaps(5);
    log.info(
      `[FrontierEngine] Evidence pursuit: ${pursuitResults.length} gaps pursued`
    );
  } catch (err) {
    log.warn("[FrontierEngine] Evidence pursuit failed (non-fatal):", errData(err));
  }

  // Stage 4: Hypothesis Generation
  let hypothesisGeneration: HypothesisGenerationResult = {
    hypothesesGenerated: 0,
    queueItemsCreated: 0,
    hypotheses: [],
  };
  try {
    hypothesisGeneration = await runHypothesisGenerator();
    log.info(
      `[FrontierEngine] Hypothesis generation: ${hypothesisGeneration.hypothesesGenerated} hypotheses, ${hypothesisGeneration.queueItemsCreated} queued`
    );
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
  };
}

// ─── Re-exports for convenience ───────────────────────────────────────────────

export { getFrontierMetrics, getGapTimeline } from "./uncertaintyTracker";
export {} from "./gapRanker";
export { detectEvidenceGapForDocument } from "./gapMapper";
export { closeGap } from "./evidencePursuer";
export { recordHypothesisOutcome } from "./hypothesisGenerator";
