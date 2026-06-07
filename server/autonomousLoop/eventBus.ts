/**
 * eventBus.ts — The central event bus for the Autonomous Loop.
 *
 * All events that enter the system are persisted to event_queue before
 * processing. This ensures every event is traceable, replayable, and
 * auditable. The bus does NOT execute events — it only persists and
 * retrieves them. The loopOrchestrator is responsible for execution.
 */

import { getDb } from "../db";
import { eventQueue } from "../../drizzle/schema";
import { eq, and, lt, sql } from "drizzle-orm";

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
  | "dream_session_complete";

/** Entry layer for each event type (per the spec) */
export const EVENT_ENTRY_LAYERS: Record<LoopEventType, number> = {
  document_submitted: 0,       // L0: Friction
  paper_discovered: 0,         // L0: Friction
  source_data_changed: 1,      // L1: Truth (re-verify affected claims)
  verdict_complete: 2,         // L2: Self-Prompt
  contradiction_found: 2,      // L2: Self-Prompt + Frontier
  gap_closed: 2,               // L2: Self-Prompt
  source_status_change: 1,     // L1: Truth (halt/resume)
  system_health_change: 4,     // L4: Meta-Agent
  hypothesis_resolved: 2,      // L2: Self-Prompt
  manual_review_complete: 0,   // L0: Friction (re-evaluation)
  scheduled_tick: 0,           // L0: Friction
  loop_action_complete: 0,     // L0: Friction (state change → new event)
  dream_pattern_detected: 4,   // L5: Dream → Meta-Agent for health check
  confidence_review_needed: 2, // L5: Dream → Self-Prompt for recalibration
  dream_session_complete: 0,   // L5: Dream → Friction (new knowledge available)
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
}

// ─── Publish ───────────────────────────────────────────────────────────────────

/**
 * Publish a new event to the event bus.
 * Returns the persisted event ID.
 */
export async function publishEvent(
  eventType: LoopEventType,
  payload: Record<string, unknown>
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const entryLayer = EVENT_ENTRY_LAYERS[eventType];
  const [result] = await db.insert(eventQueue).values({
    eventType,
    payload,
    status: "pending",
    entryLayer,
    attempts: 0,
  });
  return result.insertId;
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
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(eventQueue)
      .where(and(
        eq(eventQueue.status, "pending"),
        lt(eventQueue.attempts, 3)
      ))
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
