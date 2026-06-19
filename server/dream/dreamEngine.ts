/**
 * dreamEngine.ts — Dream State Orchestrator (Layer 5)
 *
 * The Dream State is the seventh and final layer of the Autonomous Loop.
 * It runs only when:
 *   1. The event queue has no pending events (the system has converged)
 *   2. The last dream session ended > DREAM_COOLDOWN_HOURS ago
 *   3. System health is ≥ DREAM_MIN_HEALTH (don't dream when sick)
 *
 * A dream session consists of 5 cycles:
 *   C1. Graph Consolidation — structural cleanup
 *   C2. Latent Pattern Detection — cross-entity pattern mining
 *   C3. Topology Hypothesis Generation — graph-derived hypotheses
 *   C4. Confidence Recalibration — evidence-weighted score updates (LLM-gated)
 *   C5. Contradiction Simulation — stress-test scenarios (LLM-gated)
 *
 * Build3 additions:
 *   - Per-cycle budget: remaining_budget_ms / remaining_cycles (FR-L5-07)
 *   - LLM circuit breaker: skip C4/C5 after 3 consecutive LLM failures (NFR-L5-03)
 *   - Wake protocol: executeWakeProtocol() classifies results into DreamEvents (FR-L5-38)
 *   - sessionId passed to C4 for confidence_history entries (FR-L5-26)
 */

import { getDb } from "../db";
import { dreamSessions } from "../../drizzle/schema";
import { sql, desc, eq } from "drizzle-orm";
import { runGraphConsolidation } from "./graphConsolidator";
import type { ConsolidationResult } from "./graphConsolidator";
import { runPatternDetection } from "./latentPatternDetector";
import type { PatternDetectionResult } from "./latentPatternDetector";
import { generateTopologyHypotheses } from "./topologyHypothesisGenerator";
import type { HypothesisGenerationResult } from "./topologyHypothesisGenerator";
import { runConfidenceRecalibration } from "./confidenceRecalibrator";
import type { RecalibrationReport } from "./confidenceRecalibrator";
import { runContradictionSimulation } from "./contradictionSimulator";
import type { SimulationResult } from "./contradictionSimulator";
import { publishEvent, getPendingEventCount } from "../autonomousLoop/eventBus";
import { executeWakeProtocol } from "./dreamEventPublisher";
import { logger, errData } from "../logger";

const log = logger("dream/dreamEngine");

// ─── Configuration ─────────────────────────────────────────────────────────────

const DREAM_COOLDOWN_HOURS = 6;
const DREAM_MIN_HEALTH = 40;
const DREAM_MAX_CYCLES = 5;
const DREAM_DURATION_CAP_MS = 5 * 60 * 1000; // 5 minutes max

// ─── LLM Circuit Breaker (NFR-L5-03) ──────────────────────────────────────────

/** Disable C4/C5 after this many consecutive LLM failures */
const LLM_CIRCUIT_BREAKER_THRESHOLD = 3;
let _llmConsecutiveFailures = 0;
let _llmCircuitOpen = false;

/** Record an LLM failure; open circuit after threshold */
export function recordLLMFailure(): void {
  _llmConsecutiveFailures++;
  if (_llmConsecutiveFailures >= LLM_CIRCUIT_BREAKER_THRESHOLD) {
    _llmCircuitOpen = true;
    log.warn("[DreamEngine] LLM circuit breaker OPEN — C4/C5 disabled for this session", {
      consecutiveFailures: _llmConsecutiveFailures,
    });
  }
}

/** Record an LLM success; reset circuit */
export function recordLLMSuccess(): void {
  _llmConsecutiveFailures = 0;
  _llmCircuitOpen = false;
}

/** Check if LLM circuit is open (C4/C5 should be skipped) */
export function isLLMCircuitOpen(): boolean {
  return _llmCircuitOpen;
}

/** Reset circuit breaker state (called at session start) */
export function resetLLMCircuitBreaker(): void {
  _llmConsecutiveFailures = 0;
  _llmCircuitOpen = false;
}

/**
 * Compute per-cycle budget (FR-L5-07):
 * remaining_budget_ms / remaining_cycles
 */
export function computeCycleBudget(
  sessionStartedAt: number,
  cycleNumber: number
): number {
  const elapsed = Date.now() - sessionStartedAt;
  const remainingBudget = Math.max(0, DREAM_DURATION_CAP_MS - elapsed);
  const remainingCycles = DREAM_MAX_CYCLES - cycleNumber + 1;
  return Math.floor(remainingBudget / Math.max(remainingCycles, 1));
}

// ─── Entry Gate ────────────────────────────────────────────────────────────────

export interface DreamEligibility {
  eligible: boolean;
  reason: string;
  lastSessionId?: number;
  lastSessionAt?: Date;
}

/**
 * Check whether the system is eligible to enter the Dream State.
 */
export async function checkDreamEligibility(
  currentHealthScore: number
): Promise<DreamEligibility> {
  const db = await getDb();
  if (!db) {
    return { eligible: false, reason: "Database unavailable" };
  }

  // Check pending events
  const pendingCount = await getPendingEventCount();
  if (pendingCount > 0) {
    return {
      eligible: false,
      reason: `${pendingCount} pending events — system has not converged`,
    };
  }

  // Check health
  if (currentHealthScore < DREAM_MIN_HEALTH) {
    return {
      eligible: false,
      reason: `Health score ${currentHealthScore} is below minimum ${DREAM_MIN_HEALTH}`,
    };
  }

  // Check cooldown
  const [lastSession] = await db
    .select({ id: dreamSessions.id, startedAt: dreamSessions.startedAt })
    .from(dreamSessions)
    .orderBy(desc(dreamSessions.startedAt))
    .limit(1);

  if (lastSession) {
    const hoursSinceLast =
      (Date.now() - lastSession.startedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLast < DREAM_COOLDOWN_HOURS) {
      return {
        eligible: false,
        reason: `Cooldown: last session ${hoursSinceLast.toFixed(1)}h ago (min ${DREAM_COOLDOWN_HOURS}h)`,
        lastSessionId: lastSession.id,
        lastSessionAt: lastSession.startedAt,
      };
    }
    return {
      eligible: true,
      reason: "All conditions met",
      lastSessionId: lastSession.id,
      lastSessionAt: lastSession.startedAt,
    };
  }

  return { eligible: true, reason: "No previous sessions — first dream" };
}

// ─── Dream Session ─────────────────────────────────────────────────────────────

export interface DreamSessionResult {
  sessionId: number;
  cyclesCompleted: number;
  reasonForWaking: string;
  patternsFound: number;
  hypothesesGenerated: number;
  graphOptimizations: number;
  confidenceRecalibrations: number;
  simulatedScenarios: number;
  durationMs: number;
  /** Wake protocol result — DreamEvents published to dream_event_queue */
  wakeProtocolResult?: {
    eventsPublished: number;
    aggregateRiskLevel: "low" | "medium" | "high";
    recommendedFollowUpActions: string[];
  };
}

/**
 * Run a full Dream State session.
 * Returns the session summary.
 */
// eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export async function runDreamSession(
  options: {
    healthScore?: number;
    entityCount?: number;
    manualTrigger?: boolean;
  } = {}
): Promise<DreamSessionResult | null> {
  const db = await getDb();
  if (!db) return null;

  const startedAt = Date.now();
  let cyclesCompleted = 0;
  let reasonForWaking = "in_progress";

  // Reset LLM circuit breaker at session start (NFR-L5-03)
  resetLLMCircuitBreaker();

  // Create session row
  const [insertResult] = await db.insert(dreamSessions).values({
    manualTrigger: options.manualTrigger ?? false,
    healthScoreAtEntry: options.healthScore,
    entityCountAtEntry: options.entityCount,
  });
  const sessionId = insertResult.insertId;

  // Accumulators
  let patternsFound = 0;
  let hypothesesGenerated = 0;
  let graphOptimizations = 0;
  let confidenceRecalibrations = 0;
  let simulatedScenarios = 0;
  const patternLog: Array<{
    type: string;
    description: string;
    urgency: "low" | "medium" | "high" | "critical";
    entityIds: number[];
    evidence: string;
  }> = [];
  const simulationLog: Array<{
    scenario: string;
    impactedClaimCount: number;
    impactedEntityCount: number;
    recommendation: string;
  }> = [];
  const recalibrationLog: Array<{
    claimId: number;
    currentConfidence: number;
    suggestedConfidence: number;
    reason: string;
  }> = [];

  // Cycle result holders for wake protocol (FR-L5-38)
  let c1Result: ConsolidationResult | null = null;
  let c2Result: PatternDetectionResult | null = null;
  let c3Result: HypothesisGenerationResult | null = null;
  let c4Result: RecalibrationReport | null = null;
  let c5Result: SimulationResult | null = null;

  try {
    // ── Cycle 1: Graph Consolidation ────────────────────────────────────────
    if (Date.now() - startedAt < DREAM_DURATION_CAP_MS) {
      const budget = computeCycleBudget(startedAt, 1);
      log.info(`[DreamEngine] Starting C1 (budget: ${budget}ms)`);
      const consolidation = await runGraphConsolidation();
      c1Result = consolidation;
      graphOptimizations = consolidation.totalOptimizations;
      cyclesCompleted++;
    }

    // ── Cycle 2: Latent Pattern Detection ───────────────────────────────────
    let detectedPatterns: PatternDetectionResult = { patterns: [], totalFound: 0 };
    if (Date.now() - startedAt < DREAM_DURATION_CAP_MS) {
      const budget = computeCycleBudget(startedAt, 2);
      log.info(`[DreamEngine] Starting C2 (budget: ${budget}ms)`);
      detectedPatterns = await runPatternDetection();
      c2Result = detectedPatterns;
      patternsFound = detectedPatterns.totalFound;
      patternLog.push(...detectedPatterns.patterns);
      cyclesCompleted++;

      // Check for critical patterns — wake immediately if found
      const criticalPatterns = detectedPatterns.patterns.filter(
        (p) => p.urgency === "critical"
      );
      if (criticalPatterns.length > 0) {
        reasonForWaking = "critical_pattern";
        for (const pattern of criticalPatterns) {
          await publishEvent("dream_pattern_detected", {
            sessionId,
            patternType: pattern.type,
            urgency: pattern.urgency,
            description: pattern.description,
            entityIds: pattern.entityIds,
          }).catch(() => {});
        }
      }
    }

    // ── Cycle 3: Topology Hypothesis Generation ──────────────────────────────
    if (
      reasonForWaking === "in_progress" &&
      Date.now() - startedAt < DREAM_DURATION_CAP_MS &&
      detectedPatterns.patterns.length > 0
    ) {
      const budget = computeCycleBudget(startedAt, 3);
      log.info(`[DreamEngine] Starting C3 (budget: ${budget}ms)`);
      const hypotheses = await generateTopologyHypotheses(detectedPatterns.patterns);
      c3Result = hypotheses;
      hypothesesGenerated = hypotheses.hypothesesQueued;
      cyclesCompleted++;
    }

    // ── Cycle 4: Confidence Recalibration ────────────────────────────────────
    // Skip if LLM circuit breaker is open (NFR-L5-03)
    if (
      reasonForWaking === "in_progress" &&
      Date.now() - startedAt < DREAM_DURATION_CAP_MS &&
      !isLLMCircuitOpen()
    ) {
      const budget = computeCycleBudget(startedAt, 4);
      log.info(`[DreamEngine] Starting C4 (budget: ${budget}ms)`);
      try {
        // Pass sessionId and budget (FR-L5-26, FR-L5-07)
        const recalibration = await runConfidenceRecalibration(false, sessionId, budget);
        c4Result = recalibration;
        confidenceRecalibrations = recalibration.totalRecalibrated;
        recalibrationLog.push(
          ...recalibration.entries.map(e => ({
            claimId: e.claimId,
            currentConfidence: e.oldConfidence,
            suggestedConfidence: e.newConfidence,
            reason: `${e.ruleTriggered}: ${e.evidence}`,
          }))
        );
        cyclesCompleted++;
        recordLLMSuccess();

        if (recalibration.totalRecalibrated > 10) {
          await publishEvent("confidence_review_needed", {
            sessionId,
            count: recalibration.totalRecalibrated,
            topEntries: recalibration.entries.slice(0, 5),
          }).catch(() => {});
        }
      } catch (c4Err) {
        recordLLMFailure();
        log.warn("[DreamEngine] C4 failed — LLM circuit breaker updated", { err: c4Err });
        cyclesCompleted++;
      }
    } else if (isLLMCircuitOpen()) {
      log.warn("[DreamEngine] C4 skipped — LLM circuit breaker is open");
    }

    // ── Cycle 5: Contradiction Simulation ────────────────────────────────────
    // Skip if LLM circuit breaker is open (NFR-L5-03)
    if (
      reasonForWaking === "in_progress" &&
      Date.now() - startedAt < DREAM_DURATION_CAP_MS &&
      !isLLMCircuitOpen()
    ) {
      const budget = computeCycleBudget(startedAt, 5);
      log.info(`[DreamEngine] Starting C5 (budget: ${budget}ms)`);
      try {
        const simulation = await runContradictionSimulation();
        c5Result = simulation;
        simulatedScenarios = simulation.totalSimulated;
        simulationLog.push(...simulation.scenarios);
        cyclesCompleted++;
        recordLLMSuccess();
      } catch (c5Err) {
        recordLLMFailure();
        log.warn("[DreamEngine] C5 failed — LLM circuit breaker updated", { err: c5Err });
        cyclesCompleted++;
      }
    } else if (isLLMCircuitOpen()) {
      log.warn("[DreamEngine] C5 skipped — LLM circuit breaker is open");
    }

    // Set final wake reason
    if (reasonForWaking === "in_progress") {
      if (Date.now() - startedAt >= DREAM_DURATION_CAP_MS) {
        reasonForWaking = "duration_cap";
      } else if (cyclesCompleted >= DREAM_MAX_CYCLES) {
        reasonForWaking = "max_cycles";
      } else {
        reasonForWaking = "max_cycles";
      }
    }
  } catch (err) {
    reasonForWaking = "error";
    log.error("[DreamEngine] Session error:", errData(err));
  }

  const durationMs = Date.now() - startedAt;
  const wokeAt = new Date();

  // Update session row with results
  await db
    .update(dreamSessions)
    .set({
      wokeAt,
      durationMs,
      cyclesCompleted,
      reasonForWaking,
      patternsFound,
      hypothesesGenerated,
      graphOptimizations,
      confidenceRecalibrations,
      simulatedScenarios,
      patternLog: patternLog.length > 0 ? patternLog : null,
      simulationLog: simulationLog.length > 0 ? simulationLog : null,
      recalibrationLog: recalibrationLog.length > 0 ? recalibrationLog : null,
    })
    .where(eq(dreamSessions.id, sessionId));

  // ── Wake Protocol (FR-L5-38): classify results into DreamEvents ─────────────
  let wakeProtocolResult: DreamSessionResult["wakeProtocolResult"];
  try {
    const wakeResult = await executeWakeProtocol({
      sessionId,
      consolidation: c1Result,
      patterns: c2Result,
      hypotheses: c3Result,
      recalibration: c4Result,
      simulation: c5Result,
    });
    wakeProtocolResult = {
      eventsPublished: wakeResult.eventsPublished.length,
      aggregateRiskLevel: wakeResult.aggregateRiskLevel,
      recommendedFollowUpActions: wakeResult.recommendedFollowUpActions,
    };
    log.info("[DreamEngine] Wake protocol complete", {
      sessionId,
      eventsPublished: wakeResult.eventsPublished.length,
      aggregateRiskLevel: wakeResult.aggregateRiskLevel,
    });
  } catch (wakeErr) {
    log.warn("[DreamEngine] Wake protocol failed", { err: wakeErr });
  }

  // Publish dream_session_complete event
  await publishEvent("dream_session_complete", {
    sessionId,
    durationMs,
    cyclesCompleted,
    patternsFound,
    hypothesesGenerated,
    confidenceRecalibrations,
    simulatedScenarios,
    reasonForWaking,
  }).catch(() => {});

  return {
    sessionId,
    cyclesCompleted,
    reasonForWaking,
    patternsFound,
    hypothesesGenerated,
    graphOptimizations,
    confidenceRecalibrations,
    simulatedScenarios,
    durationMs,
    wakeProtocolResult,
  };
}

// ─── Query Helpers ─────────────────────────────────────────────────────────────

export async function getRecentDreamSessions(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(dreamSessions)
    .orderBy(desc(dreamSessions.startedAt))
    .limit(limit);
}

export async function getDreamSession(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [session] = await db
    .select()
    .from(dreamSessions)
    .where(eq(dreamSessions.id, id))
    .limit(1);
  return session ?? null;
}

export async function getDreamStats() {
  const db = await getDb();
  if (!db) return null;

  const [statsRow] = await db.execute(sql`
    SELECT
      COUNT(*) AS totalSessions,
      SUM(patternsFound) AS totalPatterns,
      SUM(hypothesesGenerated) AS totalHypotheses,
      SUM(confidenceRecalibrations) AS totalRecalibrations,
      SUM(simulatedScenarios) AS totalSimulations,
      AVG(durationMs) AS avgDurationMs,
      MAX(startedAt) AS lastSessionAt
    FROM dream_sessions
    WHERE wokeAt IS NOT NULL
  `);
  const row = ((statsRow as unknown) as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return {
    totalSessions: Number(row.totalSessions ?? 0),
    totalPatterns: Number(row.totalPatterns ?? 0),
    totalHypotheses: Number(row.totalHypotheses ?? 0),
    totalRecalibrations: Number(row.totalRecalibrations ?? 0),
    totalSimulations: Number(row.totalSimulations ?? 0),
    avgDurationMs: Number(row.avgDurationMs ?? 0),
    lastSessionAt: row.lastSessionAt ? new Date(row.lastSessionAt as string) : null,
  };
}
