/**
 * dreamEventPublisher.ts — Dream State Wake Protocol & Event Publisher
 *
 * Implements the wake protocol (FR-L5-38):
 *   1. Aggregate session results from all 5 cycles
 *   2. Classify each finding into a DreamEvent with dreamPriority + evidenceStrength
 *   3. Apply evidence strength threshold (FR-L5-33): autoTrigger = evidenceStrength > 0.7
 *   4. Enqueue to dream_event_queue (FR-L5-34)
 *   5. Emit dream.session.completed log entry
 *
 * Every event carries dreamOrigin: true so downstream layers apply 1.5x weight (FR-L5-37).
 *
 * Build3 — L5 Dream State
 */

import { getDb } from "../db";
import { dreamEventQueue } from "../../drizzle/schema";
import type { DreamEvent, DreamPriority } from "./dreamTypes";
import type { ConsolidationResult } from "./graphConsolidator";
import type { PatternDetectionResult } from "./latentPatternDetector";
import type { HypothesisGenerationResult } from "./topologyHypothesisGenerator";
import type { RecalibrationReport } from "./confidenceRecalibrator";
import type { SimulationResult } from "./contradictionSimulator";
import { logger } from "../logger";

const log = logger("dream/eventPublisher");

// ─── Evidence Strength Threshold (FR-L5-33) ───────────────────────────────────
const AUTO_TRIGGER_THRESHOLD = 0.7;

// ─── Priority Weights (FR-L5-36) ──────────────────────────────────────────────
const PRIORITY_ORDER: Record<DreamPriority, number> = {
  recalibrate: 4,
  alert: 4,
  hypothesize: 3,
  consolidate: 2,
};

export interface WakeProtocolInput {
  sessionId: number;
  consolidation: ConsolidationResult | null;
  patterns: PatternDetectionResult | null;
  hypotheses: HypothesisGenerationResult | null;
  recalibration: RecalibrationReport | null;
  simulation: SimulationResult | null;
}

export interface WakeProtocolResult {
  eventsPublished: DreamEvent[];
  aggregateRiskLevel: "low" | "medium" | "high";
  recommendedFollowUpActions: string[];
}

/**
 * Compute evidence strength for a consolidation cycle result.
 */
function consolidationStrength(report: ConsolidationResult): number {
  const issues = report.orphanedEntityCount + report.duplicateEdgeCount;
  if (issues === 0) return 0.1;
  if (issues < 5) return 0.4;
  if (issues < 20) return 0.6;
  return 0.8;
}

/**
 * Compute evidence strength for pattern detection.
 */
function patternStrength(report: PatternDetectionResult): number {
  if (report.totalFound === 0) return 0.0;
  // More patterns = higher strength, capped at 0.9
  return Math.min(0.3 + report.totalFound * 0.1, 0.9);
}

/**
 * Compute evidence strength for hypothesis generation.
 */
function hypothesisStrength(report: HypothesisGenerationResult): number {
  if (report.hypothesesQueued === 0) return 0.0;
  // Ratio of queued to total attempted
  const total = report.hypothesesQueued + report.hypothesesRejected + report.hypothesesDeferred;
  if (total === 0) return 0.0;
  return Math.min(0.5 + (report.hypothesesQueued / total) * 0.4, 0.9);
}

/**
 * Compute evidence strength for recalibration.
 */
function recalibrationStrength(report: RecalibrationReport): number {
  if (report.totalRecalibrated === 0) return 0.0;
  const avgDelta =
    report.entries.reduce(
      (sum, e) => sum + Math.abs(e.newConfidence - e.oldConfidence),
      0
    ) / Math.max(report.entries.length, 1);
  const countScore = Math.min(report.totalRecalibrated / 50, 0.5);
  const deltaScore = Math.min(avgDelta * 2, 0.5);
  return countScore + deltaScore;
}

/**
 * Compute evidence strength for contradiction simulation.
 * Based on aggregate risk level.
 */
function simulationStrength(report: SimulationResult): number {
  if (report.totalSimulated === 0) return 0.0;
  // Estimate risk from scenario recommendations
  const highRiskCount = report.scenarios.filter(
    s => s.impactedClaimCount > 20 || s.impactedEntityCount > 10
  ).length;
  if (highRiskCount >= 2) return 0.85;
  if (highRiskCount === 1) return 0.65;
  return 0.4;
}

/**
 * Determine aggregate risk level from simulation and pattern reports.
 */
function computeAggregateRisk(
  simulation: SimulationResult | null,
  patterns: PatternDetectionResult | null
): "low" | "medium" | "high" {
  const simStrength = simulation ? simulationStrength(simulation) : 0;
  const patternCount = patterns?.totalFound ?? 0;

  if (simStrength >= 0.8 || patternCount > 10) return "high";
  if (simStrength >= 0.6 || patternCount > 3) return "medium";
  return "low";
}

/**
 * Generate recommended follow-up actions based on session results.
 */
function buildRecommendations(input: WakeProtocolInput): string[] {
  const actions: string[] = [];

  if (input.consolidation && input.consolidation.orphanedEntityCount > 0) {
    actions.push(
      `Review ${input.consolidation.orphanedEntityCount} orphaned entities flagged for cleanup`
    );
  }
  if (input.patterns && input.patterns.totalFound > 0) {
    actions.push(
      `Investigate ${input.patterns.totalFound} graph patterns detected by latent pattern analysis`
    );
  }
  if (input.hypotheses && input.hypotheses.hypothesesQueued > 0) {
    actions.push(
      `${input.hypotheses.hypothesesQueued} topology hypotheses queued for evidence pursuit`
    );
  }
  if (input.recalibration && input.recalibration.totalRecalibrated > 0) {
    actions.push(
      `${input.recalibration.totalRecalibrated} confidence recalibrations staged — review and apply if appropriate`
    );
  }
  if (input.simulation && input.simulation.totalSimulated > 0) {
    const highRisk = input.simulation.scenarios.filter(
      s => s.impactedClaimCount > 20
    ).length;
    if (highRisk > 0) {
      actions.push(
        `${highRisk} high-impact contradiction scenarios detected — review simulation report`
      );
    }
  }

  return actions;
}

/**
 * Execute the wake protocol: classify cycle results into DreamEvents,
 * apply evidence strength threshold, and enqueue to dream_event_queue.
 *
 * FR-L5-38
 */
export async function executeWakeProtocol(
  input: WakeProtocolInput
): Promise<WakeProtocolResult> {
  const events: DreamEvent[] = [];
  const now = new Date();

  // ── C1: Consolidation event ──────────────────────────────────────────────────
  if (input.consolidation) {
    const strength = consolidationStrength(input.consolidation);
    if (strength > 0.1) {
      events.push({
        source: "dream_state",
        dreamPriority: "consolidate",
        cycleNumber: 1,
        evidenceStrength: strength,
        autoTrigger: strength > AUTO_TRIGGER_THRESHOLD,
        dreamOrigin: true,
        sessionId: input.sessionId,
        payload: {
          orphanedEntityCount: input.consolidation.orphanedEntityCount,
          duplicateEdgeCount: input.consolidation.duplicateEdgeCount,
          staleConfidenceCount: input.consolidation.staleConfidenceCount,
          totalOptimizations: input.consolidation.totalOptimizations,
          recommendations: input.consolidation.recommendations,
        },
        createdAt: now,
      });
    }
  }

  // ── C2: Pattern detection event ──────────────────────────────────────────────
  if (input.patterns && input.patterns.totalFound > 0) {
    const strength = patternStrength(input.patterns);
    const priority: DreamPriority =
      input.patterns.totalFound > 5 ? "alert" : "hypothesize";
    events.push({
      source: "dream_state",
      dreamPriority: priority,
      cycleNumber: 2,
      evidenceStrength: strength,
      autoTrigger: strength > AUTO_TRIGGER_THRESHOLD,
      dreamOrigin: true,
      sessionId: input.sessionId,
      payload: {
        patternsFound: input.patterns.totalFound,
        topPatterns: input.patterns.patterns.slice(0, 3).map(p => ({
          type: p.type,
          description: p.description,
          urgency: p.urgency,
        })),
      },
      createdAt: now,
    });
  }

  // ── C3: Hypothesis event ─────────────────────────────────────────────────────
  if (input.hypotheses && input.hypotheses.hypothesesQueued > 0) {
    const strength = hypothesisStrength(input.hypotheses);
    events.push({
      source: "dream_state",
      dreamPriority: "hypothesize",
      cycleNumber: 3,
      evidenceStrength: strength,
      autoTrigger: strength > AUTO_TRIGGER_THRESHOLD,
      dreamOrigin: true,
      sessionId: input.sessionId,
      payload: {
        hypothesesQueued: input.hypotheses.hypothesesQueued,
        hypothesesRejected: input.hypotheses.hypothesesRejected,
        hypothesesDeferred: input.hypotheses.hypothesesDeferred,
      },
      createdAt: now,
    });
  }

  // ── C4: Recalibration event ──────────────────────────────────────────────────
  if (input.recalibration && input.recalibration.totalRecalibrated > 0) {
    const strength = recalibrationStrength(input.recalibration);
    events.push({
      source: "dream_state",
      dreamPriority: "recalibrate",
      cycleNumber: 4,
      evidenceStrength: strength,
      autoTrigger: strength > AUTO_TRIGGER_THRESHOLD,
      dreamOrigin: true,
      sessionId: input.sessionId,
      payload: {
        totalRecalibrated: input.recalibration.totalRecalibrated,
        byRule: input.recalibration.byRule,
        topEntries: input.recalibration.entries.slice(0, 5),
      },
      createdAt: now,
    });
  }

  // ── C5: Simulation event ─────────────────────────────────────────────────────
  if (input.simulation && input.simulation.totalSimulated > 0) {
    const strength = simulationStrength(input.simulation);
    const highRisk = input.simulation.scenarios.some(s => s.impactedClaimCount > 20);
    const priority: DreamPriority = highRisk ? "alert" : "consolidate";
    events.push({
      source: "dream_state",
      dreamPriority: priority,
      cycleNumber: 5,
      evidenceStrength: strength,
      autoTrigger: strength > AUTO_TRIGGER_THRESHOLD,
      dreamOrigin: true,
      sessionId: input.sessionId,
      payload: {
        scenariosRun: input.simulation.totalSimulated,
        scenarios: input.simulation.scenarios.map(s => ({
          scenario: s.scenario,
          impactedClaimCount: s.impactedClaimCount,
          recommendation: s.recommendation,
        })),
      },
      createdAt: now,
    });
  }

  // ── Persist events to dream_event_queue (FR-L5-34) ──────────────────────────
  if (events.length > 0) {
    const db = await getDb();
    if (db) {
      try {
        await db.insert(dreamEventQueue).values(
          events.map(e => ({
            sessionId: e.sessionId,
            dreamPriority: e.dreamPriority,
            evidenceStrength: e.evidenceStrength,
            autoTrigger: e.autoTrigger,
            payload: {
              ...e.payload,
              source: e.source,
              cycleNumber: e.cycleNumber,
              dreamOrigin: e.dreamOrigin,
            },
            status: "queued",
          }))
        );
        log.info("[DreamEventPublisher] Enqueued dream events", {
          sessionId: input.sessionId,
          count: events.length,
          autoTriggerCount: events.filter(e => e.autoTrigger).length,
        });
      } catch (err) {
        log.error("[DreamEventPublisher] Failed to enqueue dream events", { err });
      }
    }
  }

  const aggregateRiskLevel = computeAggregateRisk(input.simulation, input.patterns);
  const recommendedFollowUpActions = buildRecommendations(input);

  return {
    eventsPublished: events,
    aggregateRiskLevel,
    recommendedFollowUpActions,
  };
}

/**
 * Get the count of pending dream events in the queue.
 * Autonomous loop checks this first before the main event_queue (FR-L5-35).
 */
export async function getPendingDreamEventCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const [row] = await db.execute(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).sql`SELECT COUNT(*) AS cnt FROM dream_event_queue WHERE status = 'queued'`
    );
    return Number((row as unknown as Record<string, unknown>)?.cnt ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Sort helper for dream priority ordering (FR-L5-36).
 * Higher number = higher priority.
 */
export function getDreamPriorityWeight(priority: string): number {
  return PRIORITY_ORDER[priority as DreamPriority] ?? 1;
}
