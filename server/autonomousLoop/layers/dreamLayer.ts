/**
 * dreamLayer.ts — L5 Dream State layer adapter
 *
 * Dispatches dream-related events (dream_cycle_started, dream_pattern_detected,
 * dream_queue_processed) to the Dream Engine (runDreamSession).
 *
 * Build3 T076-T084 — Wake protocol integration
 *
 * Contract: FR-L5-01, FR-L5-32, FR-L5-38, FR-L5-39
 */
import { randomUUID } from "crypto";
import type { LoopEvent } from "../eventBus";
import type { LoopAction } from "../loopOrchestrator";
import {
  emitLayerStart,
  emitLayerEnd,
  emitLayerError,
} from "../../telemetryCollector";
import {
  runDreamSession,
  checkDreamEligibility,
} from "../../dream/dreamEngine";
import { logger } from "../../logger";

const log = logger("dream/dreamLayer");

/** Events that should trigger a Dream session */
const DREAM_TRIGGER_EVENTS = new Set([
  "dream_cycle_started",
  "dream_pattern_detected",
  "dream_queue_processed",
]);

export interface DreamLayerResult {
  ran: boolean;
  actions: LoopAction[];
}

/**
 * runDreamLayer — called by loopOrchestrator when an L5 event is routed here.
 *
 * Eligibility is checked first (6h cooldown, system health ≥ 60).
 * If eligible, a full Dream session (C1–C5) is run.
 * The wake protocol publishes DreamEvents to dream_event_queue.
 */
export async function runDreamLayer(
  event: LoopEvent,
  priorActions: LoopAction[]
): Promise<DreamLayerResult> {
  const corrId = randomUUID();
  const startMs = Date.now();
  await emitLayerStart("L5_DREAM", corrId, { eventQueueId: event.id });

  const actions: LoopAction[] = [];

  try {
    // Only run for dream trigger events
    if (!DREAM_TRIGGER_EVENTS.has(event.eventType)) {
      await emitLayerEnd("L5_DREAM", corrId, startMs, { eventQueueId: event.id });
      return { ran: false, actions };
    }

    // Avoid duplicate dream runs in the same loop tick
    const alreadyRan = priorActions.some((a) => a.type.startsWith("dream_"));
    if (alreadyRan) {
      await emitLayerEnd("L5_DREAM", corrId, startMs, { eventQueueId: event.id });
      return { ran: false, actions };
    }

    // Extract system health score from event payload if available
    const healthScore =
      typeof event.payload?.systemHealth === "number"
        ? (event.payload.systemHealth as number)
        : 100;

    // Eligibility gate (FR-L5-02): 6h cooldown + health ≥ 60
    const eligibility = await checkDreamEligibility(healthScore);
    if (!eligibility.eligible) {
      const reason = eligibility.reason ?? "Not eligible";
      log.info("[DreamLayer] Session ineligible — skipping", { reason });
      actions.push({
        type: "dream_session_skipped",
        description: `Dream session skipped: ${reason}`,
        priority: 10,
        result: "success",
      });
      await emitLayerEnd("L5_DREAM", corrId, startMs, { eventQueueId: event.id });
      return { ran: false, actions };
    }

    // Run the full Dream session (C1–C5 + wake protocol)
    const sessionResult = await runDreamSession();

    if (!sessionResult) {
      // runDreamSession returns null when eligibility check fails internally
      actions.push({
        type: "dream_session_skipped",
        description: "Dream session returned null (ineligible)",
        priority: 10,
        result: "success",
      });
      await emitLayerEnd("L5_DREAM", corrId, startMs, { eventQueueId: event.id });
      return { ran: false, actions };
    }

    const eventsPublished = sessionResult.wakeProtocolResult?.eventsPublished ?? 0;
    const cyclesCompleted = sessionResult.cyclesCompleted;
    const durationMs = sessionResult.durationMs;

    actions.push({
      type: "dream_session_complete",
      description: `Dream session complete: ${cyclesCompleted} cycles, ${eventsPublished} events published, ${durationMs}ms`,
      priority: 60,
      result: "success",
    });

    log.info("[DreamLayer] Dream session complete", {
      sessionId: sessionResult.sessionId,
      cyclesCompleted,
      eventsPublished,
      durationMs,
    });

    await emitLayerEnd("L5_DREAM", corrId, startMs, { eventQueueId: event.id });
    return { ran: true, actions };
  } catch (err) {
    await emitLayerError("L5_DREAM", corrId, "LAYER_ERROR", {
      eventQueueId: event.id,
      durationMs: Date.now() - startMs,
    });
    log.error("[DreamLayer] Unhandled error:", { err: String(err) });
    actions.push({
      type: "dream_session_complete",
      description: `Dream session failed: ${err instanceof Error ? err.message : String(err)}`,
      priority: 60,
      result: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return { ran: false, actions };
  }
}
