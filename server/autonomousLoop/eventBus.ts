/**
 * eventBus.ts — The central event bus for the Autonomous Loop.
 *
 * All events that enter the system are persisted to event_queue before
 * processing. This ensures every event is traceable, replayable, and
 * auditable.
 *
 * REACTIVE DRAIN MODEL (v2)
 * ─────────────────────────
 * publishEvent() now schedules a non-blocking drain pass via setImmediate()
 * after every call. This means the loop reacts to events within milliseconds
 * rather than waiting up to 2 hours for the cron tick.
 *
 * Safety properties:
 *   • Re-entrancy guard  — only one drain pass runs at a time.
 *   • Concurrency cap    — drains at most MAX_DRAIN_PER_PASS events per pass.
 *   • Back-pressure      — if a pass finds more pending events after finishing,
 *                          it schedules another pass immediately (cascade).
 *   • Error isolation    — a failed processEvent() does not abort the drain.
 *   • Cron safety net    — the 2-hour cron tick still works; it just rarely
 *                          finds pending work because the reactive drain already
 *                          processed everything.
 */

import { getDb } from "../db";
import { eventQueue } from "../../drizzle/schema";
import { eq, and, lt, sql } from "drizzle-orm";
import { logger, errData } from "../logger";
import {
  type TypedEventEnvelope,
  type SourceLayer,
  type ExtendedLoopEventType,
  createEnvelope,
  validateEventPayload,
  DEFAULT_TTL_MS,
} from "./eventSchemas";

// Re-export for consumers
export type { TypedEventEnvelope, SourceLayer, ExtendedLoopEventType };
export { createEnvelope, DEFAULT_TTL_MS };

const log = logger("autonomousLoop/eventBus");

// ─── Types ─────────────────────────────────────────────────────────────────────

export type LoopEventType =
  | "document_submitted"
  | "paper_discovered"
  | "source_data_changed"
  | "verdict_complete"
  | "contradiction_found"
  | "gap_closed"
  | "source_status_change"
  | "system_health_change"
  | "hypothesis_resolved"
  | "manual_review_complete"
  | "scheduled_tick"
  | "loop_action_complete"
  | "dream_pattern_detected"
  | "confidence_review_needed"
  | "dream_session_complete"
  | "source_version_changed"
  | "coverage_gap"
  | "system_capability_required"
  | "frontier_search_requested"
  | "frontier_result_received"
  | "dream_hypothesis_generated"
  | "dream_cycle_started"
  | "code_drift_detected"
  | "stub_escalated"
  | "pipeline_invariant_violated"
  | "self_prompt_triggered"
  | "authority_violation"
  | "layer_telemetry_recorded"
  | "pipeline_stage_complete"
  | "convergence_gate_opened"
  | "dream_queue_processed"
  | "l0_scan_completed"
  | "l0_scan_failed";

/** Entry layer for each event type (per the spec) */
export const EVENT_ENTRY_LAYERS: Record<LoopEventType, number> = {
  document_submitted: 0, // L0: Friction
  paper_discovered: 0, // L0: Friction
  source_data_changed: 1, // L1: Truth (re-verify affected claims)
  verdict_complete: 2, // L2: Self-Prompt
  contradiction_found: 2, // L2: Self-Prompt + Frontier
  gap_closed: 2, // L2: Self-Prompt
  source_status_change: 1, // L1: Truth (halt/resume)
  system_health_change: 4, // L4: Meta-Agent
  hypothesis_resolved: 2, // L2: Self-Prompt
  manual_review_complete: 0, // L0: Friction (re-evaluation)
  scheduled_tick: 0, // L0: Friction
  loop_action_complete: 0, // L0: Friction (state change → new event)
  dream_pattern_detected: 4, // L5: Dream → Meta-Agent for health check
  confidence_review_needed: 2, // L5: Dream → Self-Prompt for recalibration
  dream_session_complete: 0, // L5: Dream → Friction (new knowledge available)
  source_version_changed: 1, // L1: Truth (re-verify claims from changed source)
  coverage_gap: 2, // L2: Self-Prompt → Frontier (pursue missing evidence)
  system_capability_required: 4, // L4: Meta-Agent → Manus spawnDevTask for autonomous repair
  frontier_search_requested: 3, // L3: Frontier search
  frontier_result_received: 1, // L1: Truth re-verify
  dream_hypothesis_generated: 5, // L5: Dream hypothesis
  dream_cycle_started: 5, // L5: Dream cycle
  code_drift_detected: 4, // L4: Meta-Agent alert
  stub_escalated: 4, // L4: Meta-Agent alert
  pipeline_invariant_violated: 4, // L4: Meta-Agent critical
  self_prompt_triggered: 2, // L2: Self-prompt
  authority_violation: 4, // L4: Meta-Agent authority enforcement
  layer_telemetry_recorded: 4, // L4: Meta-Agent telemetry
  pipeline_stage_complete: 1, // L1: Truth pipeline stage
  convergence_gate_opened: 2, // L2: Self-Prompt convergence
  dream_queue_processed: 5, // L5: Dream queue
  l0_scan_completed: 0, // L0: Friction scan completed telemetry
  l0_scan_failed: 0, // L0: Friction scan failed telemetry
};

export interface LoopEvent {
  id: number;
  eventType: LoopEventType;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "processed" | "skipped" | "failed";
  entryLayer: number;
  loopRunId: number | null;
  skipReason: string | null;
  attempts: number;
  errorMessage: string | null;
  createdAt: Date;
  processedAt: Date | null;
  /** Typed envelope — present when event was published with build1_foundation envelope */
  envelope?: TypedEventEnvelope;
}

// ─── Reactive Drain Worker ─────────────────────────────────────────────────────

/** Maximum events processed in a single drain pass. */
const MAX_DRAIN_PER_PASS = 10;

/** Re-entrancy guard — true while a drain pass is running. */
let _draining = false;

/**
 * Run a single drain pass: claim and process up to MAX_DRAIN_PER_PASS pending
 * events. If more events remain after the pass, schedule another pass.
 *
 * This function is always called outside the current call stack via
 * setImmediate() so it never blocks the HTTP response that triggered it.
 */
async function _drainPass(): Promise<void> {
  if (_draining) return; // another pass is already running
  _draining = true;

  let processed = 0;
  try {
    // Lazy-import to avoid circular dependency at module load time
    const { processEvent } = await import("./loopOrchestrator");

    for (let i = 0; i < MAX_DRAIN_PER_PASS; i++) {
      const event = await claimNextEvent();
      if (!event) break;

      try {
        await processEvent(event);
        processed++;
      } catch (err) {
        // Mark failed and continue — do not abort the whole drain pass
        await markEventFailed(event.id, String(err));
        log.error(`[EventBus] processEvent(${event.id}) failed:`, errData(err));
      }
    }
  } catch (err) {
    log.error("[EventBus] drain pass error:", errData(err));
  } finally {
    _draining = false;
  }

  // If we processed a full batch there may be more pending events — cascade.
  if (processed >= MAX_DRAIN_PER_PASS) {
    setImmediate(_drainPass);
  }
}

/**
 * Schedule a non-blocking drain pass after the current call stack unwinds.
 * Safe to call from inside an HTTP handler or pipeline — will not block.
 */
export function scheduleDrain(): void {
  setImmediate(_drainPass);
}

// ─── Publish ───────────────────────────────────────────────────────────────────

/**
 * Publish a new event to the event bus.
 * Returns the persisted event ID.
 *
 * PRD-MASTER FR-MASTER-03: Every event carries a TypedEventEnvelope with
 * eventId (UUID v4), correlationId (UUID), ttl (epoch ms), sourceLayer, timestamp.
 *
 * @param eventType  The event type
 * @param payload    Event payload — Zod-validated if a schema is registered
 * @param envelope   Optional partial envelope. correlationId is propagated from
 *                   parent events to child events in the same claim pipeline.
 * @returns The inserted event_queue row ID
 * @throws SCHEMA_VALIDATION_ERROR if payload fails Zod validation
 */
export async function publishEvent(
  eventType: LoopEventType,
  payload: Record<string, unknown>,
  envelope?: { correlationId?: string; sourceLayer?: SourceLayer; ttl?: number }
): Promise<number> {
  // Validate payload against registered Zod schema (if one exists)
  try {
    validateEventPayload(eventType as ExtendedLoopEventType, payload);
  } catch (err) {
    log.error("publishEvent: schema validation failed", {
      eventType,
      err: errData(err as Error),
    });
    throw err;
  }

  // Build the typed envelope — merge caller-supplied fields with fresh defaults
  const finalEnvelope: TypedEventEnvelope = createEnvelope(
    envelope?.sourceLayer ?? "ORCHESTRATOR",
    envelope?.correlationId
  );
  if (envelope?.ttl) finalEnvelope.ttl = envelope.ttl;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const entryLayer = EVENT_ENTRY_LAYERS[eventType] ?? 0;
  const [result] = await db.insert(eventQueue).values({
    eventType,
    // Embed envelope in payload for persistence (backward compat with consumers)
    payload: { ...payload, __envelope: finalEnvelope },
    status: "pending",
    entryLayer,
    attempts: 0,
  });

  // Schedule reactive drain — non-blocking, outside current call stack
  scheduleDrain();

  return result.insertId;
}

/**
 * Extract the TypedEventEnvelope from a LoopEvent payload.
 * Returns undefined if the event was published before build1_foundation.
 */
export function extractEnvelope(
  event: LoopEvent
): TypedEventEnvelope | undefined {
  const env = event.payload?.__envelope;
  if (!env || typeof env !== "object") return undefined;
  return env as TypedEventEnvelope;
}

// ─── Consume ───────────────────────────────────────────────────────────────────

/**
 * Claim the next pending event for processing (atomic).
 * Returns null if no pending events exist.
 */
export async function claimNextEvent(): Promise<LoopEvent | null> {
  const db = await getDb();
  if (!db) return null;

  // Use a transaction to atomically claim one event
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(eventQueue)
      .where(and(eq(eventQueue.status, "pending"), lt(eventQueue.attempts, 3)))
      .orderBy(eventQueue.createdAt)
      .limit(1)
      .for("update");

    if (!row) return null;

    await tx
      .update(eventQueue)
      .set({
        status: "processing",
        attempts: sql`${eventQueue.attempts} + 1`,
      })
      .where(eq(eventQueue.id, row.id));

    return { ...row, status: "processing" as const };
  });
}

// ─── Update ────────────────────────────────────────────────────────────────────

export async function markEventProcessed(
  id: number,
  loopRunId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(eventQueue)
    .set({ status: "processed", loopRunId, processedAt: new Date() })
    .where(eq(eventQueue.id, id));
}

export async function markEventSkipped(
  id: number,
  skipReason: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(eventQueue)
    .set({ status: "skipped", skipReason, processedAt: new Date() })
    .where(eq(eventQueue.id, id));
}

export async function markEventFailed(
  id: number,
  errorMessage: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(eventQueue)
    .set({ status: "failed", errorMessage, processedAt: new Date() })
    .where(eq(eventQueue.id, id));
}

// ─── Query ─────────────────────────────────────────────────────────────────────

export async function getPendingEventCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(eventQueue)
    .where(eq(eventQueue.status, "pending"));
  return Number(row?.count ?? 0);
}

export async function getRecentEvents(limit = 50): Promise<LoopEvent[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(eventQueue)
    .orderBy(sql`${eventQueue.createdAt} DESC`)
    .limit(limit);
  return rows as LoopEvent[];
}
