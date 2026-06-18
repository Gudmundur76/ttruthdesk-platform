/**
 * dreamQueueConsumer.ts — Separated dream queue processing.
 *
 * PRD-MASTER Phase 3: Dream queue processing is separated from the main
 * orchestrator to prevent dream cycles from blocking real-time events.
 */

import { getDb } from "../db";
import { dreamStagingQueue } from "../../drizzle/schema";
import { eq, and, lt } from "drizzle-orm";
import { LayerError } from "./layerError";

export interface DreamQueueItem {
  id: number;
  sessionEventId: number;
  hypothesis: unknown;
  confidence: number;
  status: "pending" | "approved" | "rejected" | "auto_promoted";
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: number;
  reviewedAt: number | null;
}

export interface DreamConsumerResult {
  processed: number;
  rejected: number;
  errors: string[];
}

const DREAM_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export async function fetchPendingDreamItems(
  limit = 10
): Promise<DreamQueueItem[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select()
      .from(dreamStagingQueue)
      .where(eq(dreamStagingQueue.status, "pending"))
      .limit(limit);
    return rows as unknown as DreamQueueItem[];
  } catch (err) {
    throw LayerError.wrap(err, { layerId: "L5" });
  }
}

export async function autoPromoteDreamItem(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(dreamStagingQueue)
    .set({ status: "auto_promoted", reviewedAt: Date.now() })
    .where(eq(dreamStagingQueue.id, id));
}

export async function rejectDreamItem(
  id: number,
  reason?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(dreamStagingQueue)
    .set({
      status: "rejected",
      reviewedAt: Date.now(),
      reviewNote: reason ?? null,
    })
    .where(eq(dreamStagingQueue.id, id));
}

export async function rejectStaleDreamItems(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const cutoff = Date.now() - DREAM_STALE_THRESHOLD_MS;
  const stale = await db
    .select({ id: dreamStagingQueue.id })
    .from(dreamStagingQueue)
    .where(
      and(
        eq(dreamStagingQueue.status, "pending"),
        lt(dreamStagingQueue.createdAt, cutoff)
      )
    );
  for (const item of stale) {
    await rejectDreamItem(item.id, "stale: exceeded 24h TTL");
  }
  return stale.length;
}

export interface DreamQueueConsumerOptions {
  batchSize?: number;
  processor?: (item: DreamQueueItem) => Promise<void>;
}

export async function consumeDreamQueue(
  options: DreamQueueConsumerOptions = {}
): Promise<DreamConsumerResult> {
  const { batchSize = 5, processor } = options;
  const result: DreamConsumerResult = { processed: 0, rejected: 0, errors: [] };
  result.rejected = await rejectStaleDreamItems();
  const items = await fetchPendingDreamItems(batchSize);
  for (const item of items) {
    try {
      if (processor) await processor(item);
      await autoPromoteDreamItem(item.id);
      result.processed++;
    } catch (err) {
      const layerErr = LayerError.wrap(err, { layerId: "L5" });
      result.errors.push(layerErr.message);
      await rejectDreamItem(item.id, layerErr.message);
    }
  }
  return result;
}

// ─── Semantic aliases for PRD-MASTER Phase 3 lifecycle management ─────────────
/**
 * Mark a dream queue item as completed (auto-promoted to the knowledge layer).
 * Alias for autoPromoteDreamItem — use this name in pipeline/consumer code
 * where the intent is "this dream cycle succeeded and its hypothesis is accepted".
 */
export const markDreamItemCompleted = autoPromoteDreamItem;

/**
 * Mark a dream queue item as rejected (hypothesis discarded).
 * Alias for rejectDreamItem — use this name in pipeline/consumer code
 * where the intent is "this dream cycle failed or the hypothesis was invalid".
 */
export const markDreamItemRejected = rejectDreamItem;
