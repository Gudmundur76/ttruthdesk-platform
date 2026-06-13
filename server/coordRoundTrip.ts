/**
 * coordRoundTrip.ts — Coordination Layer Round-Trip Test Harness
 * ─────────────────────────────────────────────────────────────────────────────
 * Executes a full enqueue → dequeue → complete → status cycle against the
 * coordApi endpoints, measuring latency at each step.
 *
 * Used by:
 *   - Phase 126 integration tests
 *   - Health check endpoint (GET /api/v2/health/detailed)
 *   - CI smoke tests
 */
import { getDb } from "./db";
import { coordQueue } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { logger, errData } from "./logger";

const log = logger("coordRoundTrip");

// ─── Types ────────────────────────────────────────────────────────────────────
export interface RoundTripInput {
  vertical: string;
  pmid?: string;
  doi?: string;
}

export interface RoundTripResult {
  taskId: string;
  enqueueMs: number;
  dequeueMs: number;
  completeMs: number;
  statusMs: number;
  totalMs: number;
  finalStatus: string;
  success: boolean;
  error?: string;
}

// ─── Implementation ───────────────────────────────────────────────────────────
export async function coordRoundTrip(input: RoundTripInput): Promise<RoundTripResult> {
  const overallStart = Date.now();
  const taskId = `round-trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let enqueueMs = 0;
  let dequeueMs = 0;
  let completeMs = 0;
  let statusMs = 0;

  try {
    const db = await getDb();
    if (!db) {
      return {
        taskId,
        enqueueMs: 0,
        dequeueMs: 0,
        completeMs: 0,
        statusMs: 0,
        totalMs: Date.now() - overallStart,
        finalStatus: "failed",
        success: false,
        error: "Database unavailable",
      };
    }

    // ── Step 1: Enqueue ────────────────────────────────────────────────────────
    const enqueueStart = Date.now();
    await db.insert(coordQueue).values({
      vertical: input.vertical,
      pmid: input.pmid ?? null,
      doi: input.doi ?? null,
      paperUrl: null,
      title: `Round-trip test item (${taskId})`,
      priority: 0,
      status: "pending",
      retryCount: 0,
    });
    enqueueMs = Date.now() - enqueueStart;

    // ── Step 2: Dequeue (claim the item) ──────────────────────────────────────
    const dequeueStart = Date.now();
    const [item] = await db
      .select()
      .from(coordQueue)
      .where(
        and(
          eq(coordQueue.vertical, input.vertical),
          eq(coordQueue.status, "pending")
        )
      )
      .limit(1);

    if (!item) {
      return {
        taskId,
        enqueueMs,
        dequeueMs: Date.now() - dequeueStart,
        completeMs: 0,
        statusMs: 0,
        totalMs: Date.now() - overallStart,
        finalStatus: "failed",
        success: false,
        error: "Dequeue returned no item",
      };
    }

    await db
      .update(coordQueue)
      .set({ status: "claimed", claimedBy: taskId, claimedAt: new Date() })
      .where(eq(coordQueue.id, item.id));
    dequeueMs = Date.now() - dequeueStart;

    // ── Step 3: Complete ──────────────────────────────────────────────────────
    const completeStart = Date.now();
    const updateResult = await db
      .update(coordQueue)
      .set({ status: "completed", result: "round-trip-ok", completedAt: new Date() })
      .where(and(eq(coordQueue.id, item.id), eq(coordQueue.claimedBy, taskId)));

    if (!updateResult) {
      return {
        taskId,
        enqueueMs,
        dequeueMs,
        completeMs: Date.now() - completeStart,
        statusMs: 0,
        totalMs: Date.now() - overallStart,
        finalStatus: "failed",
        success: false,
        error: "Complete step: item not found",
      };
    }
    completeMs = Date.now() - completeStart;

    // ── Step 4: Status check ──────────────────────────────────────────────────
    const statusStart = Date.now();
    const [completed] = await db
      .select()
      .from(coordQueue)
      .where(eq(coordQueue.id, item.id));
    statusMs = Date.now() - statusStart;

    const finalStatus = completed?.status ?? "unknown";

    // ── Cleanup: remove the test item ─────────────────────────────────────────
    await db.delete(coordQueue).where(eq(coordQueue.id, item.id));

    const totalMs = Date.now() - overallStart;
    log.info(`Round-trip complete in ${totalMs}ms (enqueue=${enqueueMs}ms, dequeue=${dequeueMs}ms, complete=${completeMs}ms, status=${statusMs}ms)`);

    return {
      taskId,
      enqueueMs,
      dequeueMs,
      completeMs,
      statusMs,
      totalMs,
      finalStatus,
      success: finalStatus === "completed",
    };
  } catch (err: unknown) {
    log.error("coordRoundTrip failed", errData(err));
    return {
      taskId,
      enqueueMs,
      dequeueMs,
      completeMs,
      statusMs,
      totalMs: Date.now() - overallStart,
      finalStatus: "failed",
      success: false,
      error: String(err),
    };
  }
}
