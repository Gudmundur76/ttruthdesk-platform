/**
 * convergenceGate.ts — L2 Convergence Gate (Hard Constraints)
 *
 * Implements FR-L2-19 through FR-L2-23 from build2_decision.docx:
 *   FR-L2-19: Convergence declared when LLM returns converged:true AND gate validates
 *   FR-L2-20: NOT converge if fewer than 2 L2 cycles in last 24 hours
 *   FR-L2-21: NOT converge if critical-severity open alerts from L4
 *   FR-L2-22: NOT converge if frontier gaps older than 30 days with no active directive
 *   FR-L2-23: Maximum cycles per trigger = 10; force convergence after 10
 *
 * The gate applies hard constraints that can override the LLM's converged flag.
 * Authority boundary: READ-ONLY from DB. Never writes.
 */

import { getDb } from "../db";
import {
  selfPromptLog,
  metaAgentAlerts,
  knowledgeGaps,
  frontierDirectives,
} from "../../drizzle/schema";
import { eq, and, gte, count, lt } from "drizzle-orm";
import { logger } from "../logger";

const log = logger("selfPrompt/convergenceGate");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConvergenceGateInput {
  /** Whether the LLM declared convergence */
  llmConverged: boolean;
  /** Number of L2 cycles run on this trigger so far */
  cycleCount: number;
  /** Optional: meta stats from state collector */
  openCriticalAlerts?: number;
  /** Optional: count of gaps older than 30 days with no active directive */
  staleGapsWithNoDirective?: number;
}

export interface ConvergenceGateResult {
  /** Final convergence decision (may override LLM) */
  converged: boolean;
  /** Reason for the decision */
  reason: string;
  /** Whether the gate overrode the LLM */
  overridden: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_CYCLES_PER_TRIGGER = 10; // FR-L2-23
const MIN_CYCLES_24H = 2; // FR-L2-20
const STALE_GAP_DAYS = 30; // FR-L2-22

// ─── DB Helpers ───────────────────────────────────────────────────────────────

/**
 * Count L2 cycles run in the last 24 hours.
 * Used for FR-L2-20: minimum activity check.
 */
async function countRecentL2Cycles(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return MIN_CYCLES_24H; // Assume minimum met when DB unavailable
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await db
      .select({ cnt: count() })
      .from(selfPromptLog)
      .where(gte(selfPromptLog.createdAt, since));
    return result[0]?.cnt ?? 0;
  } catch {
    return MIN_CYCLES_24H; // Fail-safe: assume minimum met
  }
}

/**
 * Count open critical alerts from L4.
 * Used for FR-L2-21: critical alert check.
 */
async function countOpenCriticalAlerts(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    const result = await db
      .select({ cnt: count() })
      .from(metaAgentAlerts)
      .where(
        and(
          eq(metaAgentAlerts.severity, "critical"),
          eq(metaAgentAlerts.acknowledged, false)
        )
      );
    return result[0]?.cnt ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Count frontier gaps older than 30 days with no active directive.
 * Used for FR-L2-22: stale gap check.
 */
async function countStaleGapsWithNoDirective(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 0;
    const thirtyDaysAgo = new Date(
      Date.now() - STALE_GAP_DAYS * 24 * 60 * 60 * 1000
    );
    // Count open gaps older than 30 days
    const staleGapsResult = await db
      .select({ cnt: count() })
      .from(knowledgeGaps)
      .where(
        and(
          eq(knowledgeGaps.status, "open"),
          lt(knowledgeGaps.createdAt, thirtyDaysAgo)
        )
      );
    const staleGapCount = staleGapsResult[0]?.cnt ?? 0;
    if (staleGapCount === 0) return 0;
    // Count active directives
    const activeDirectivesResult = await db
      .select({ cnt: count() })
      .from(frontierDirectives)
      .where(eq(frontierDirectives.status, "active"));
    const activeDirectiveCount = activeDirectivesResult[0]?.cnt ?? 0;
    // If there are stale gaps and no active directives, return the stale gap count
    return activeDirectiveCount === 0 ? staleGapCount : 0;
  } catch {
    return 0;
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Apply hard convergence constraints.
 * Returns the final convergence decision, potentially overriding the LLM.
 */
export async function applyConvergenceGate(
  input: ConvergenceGateInput
): Promise<ConvergenceGateResult> {
  // FR-L2-23: Force convergence after MAX_CYCLES_PER_TRIGGER
  if (input.cycleCount >= MAX_CYCLES_PER_TRIGGER) {
    log.warn(
      `[ConvergenceGate] Max cycles (${MAX_CYCLES_PER_TRIGGER}) reached — forcing convergence`
    );
    return {
      converged: true,
      reason: `max_cycles_reached:${MAX_CYCLES_PER_TRIGGER}`,
      overridden: !input.llmConverged,
    };
  }

  // If LLM did not declare convergence, gate cannot force it (only block it)
  if (!input.llmConverged) {
    return {
      converged: false,
      reason: "llm_not_converged",
      overridden: false,
    };
  }

  // LLM declared convergence — apply hard constraints that can BLOCK it

  // FR-L2-20: Minimum activity check
  const recentCycles = await countRecentL2Cycles();
  if (recentCycles < MIN_CYCLES_24H) {
    log.info(
      `[ConvergenceGate] Blocking convergence: only ${recentCycles} cycles in last 24h (min ${MIN_CYCLES_24H})`
    );
    return {
      converged: false,
      reason: `insufficient_recent_cycles:${recentCycles}/${MIN_CYCLES_24H}`,
      overridden: true,
    };
  }

  // FR-L2-21: Critical alert check
  const criticalAlerts =
    input.openCriticalAlerts ?? (await countOpenCriticalAlerts());
  if (criticalAlerts > 0) {
    log.info(
      `[ConvergenceGate] Blocking convergence: ${criticalAlerts} open critical alerts`
    );
    return {
      converged: false,
      reason: `open_critical_alerts:${criticalAlerts}`,
      overridden: true,
    };
  }

  // FR-L2-22: Stale gap check
  const staleGaps =
    input.staleGapsWithNoDirective ?? (await countStaleGapsWithNoDirective());
  if (staleGaps > 0) {
    log.info(
      `[ConvergenceGate] Blocking convergence: ${staleGaps} stale gaps (>${STALE_GAP_DAYS}d) with no active directive`
    );
    return {
      converged: false,
      reason: `stale_gaps_no_directive:${staleGaps}`,
      overridden: true,
    };
  }

  // All constraints passed — allow convergence
  return {
    converged: true,
    reason: "all_constraints_passed",
    overridden: false,
  };
}
