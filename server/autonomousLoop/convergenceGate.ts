/**
 * convergenceGate.ts — The Convergence Gate.
 *
 * Evaluates whether the autonomous loop should stop processing and sleep
 * until the next external event. Per the spec:
 *
 *   ALL true → CONVERGE → sleep until next external event
 *   ANY false → continue loop, execute highest-priority action
 *
 * The system stops not because a timer expires.
 * It stops because it has nothing important to do.
 */

import type { LoopAction } from "./loopOrchestrator";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Actions below this priority are considered low-value */
export const CONVERGE_THRESHOLD = 30;

/** Health score above this is considered healthy */
export const HEALTHY_THRESHOLD = 80;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ConvergenceInput {
  pendingActions: LoopAction[];
  metaHealthScore: number;
  pendingEventCount: number;
}

export interface ConvergenceResult {
  converge: boolean;
  reason?: string;
  /** Which conditions were met */
  conditions: {
    noHighValueActions: boolean;
    noUserFacingWork: boolean;
    systemHealthy: boolean;
    noNewEvents: boolean;
  };
}

// ─── Gate ──────────────────────────────────────────────────────────────────────

/**
 * Evaluate whether the system should converge.
 *
 * Mirrors the TypeScript pseudocode from the spec exactly:
 *
 * ```typescript
 * function shouldConverge(state: SystemState): boolean {
 *   const noHighValueActions = state.pendingActions.every(a => a.expectedValue < CONVERGE_THRESHOLD);
 *   const noUserFacingWork   = state.pendingActions.every(a => a.visibility === "internal");
 *   const systemHealthy      = state.metaHealth.score >= HEALTHY_THRESHOLD;
 *   const noNewEvents        = state.eventQueue.length === 0;
 *   return noHighValueActions && noUserFacingWork && systemHealthy && noNewEvents;
 * }
 * ```
 */
export function shouldConverge(input: ConvergenceInput): ConvergenceResult {
  const { pendingActions, metaHealthScore, pendingEventCount } = input;

  // Condition 1: No high-value pending actions
  const noHighValueActions = pendingActions.every(
    (a) => a.priority < CONVERGE_THRESHOLD
  );

  // Condition 2: No user-facing pending work (all remaining actions are internal)
  // We classify "success" actions with priority >= 50 as user-facing
  const noUserFacingWork = pendingActions
    .filter((a) => a.result !== "skipped")
    .every((a) => a.priority < 50);

  // Condition 3: System is healthy
  const systemHealthy = metaHealthScore >= HEALTHY_THRESHOLD;

  // Condition 4: No new events in queue
  const noNewEvents = pendingEventCount === 0;

  const conditions = {
    noHighValueActions,
    noUserFacingWork,
    systemHealthy,
    noNewEvents,
  };

  const converge = noHighValueActions && noUserFacingWork && systemHealthy && noNewEvents;

  let reason: string | undefined;
  if (converge) {
    reason = "all_convergence_conditions_met";
  } else {
    const failing: string[] = [];
    if (!noHighValueActions) failing.push("high_value_actions_pending");
    if (!noUserFacingWork) failing.push("user_facing_work_pending");
    if (!systemHealthy) failing.push(`health_score_${metaHealthScore}_below_${HEALTHY_THRESHOLD}`);
    if (!noNewEvents) failing.push(`${pendingEventCount}_events_in_queue`);
    reason = failing.join(", ");
  }

  return { converge, reason, conditions };
}
