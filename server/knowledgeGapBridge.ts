/**
 * Knowledge Gap Bridge — Phase 128
 *
 * Reads "open" rows from knowledge_gaps and enqueues each as a coordQueue
 * work item so the autonomous agent swarm can pursue evidence closure.
 *
 * Called at the end of every discoveryLoopJob run to close the autonomous
 * improvement loop:
 *
 *   discoveryLoopJob → knowledgeGapBridge → coordQueue → autonomousIngest
 *
 * Gap lifecycle transition:
 *   open → pursued  (when a coordQueue item is created)
 */

import { eq, inArray } from "drizzle-orm";
import { knowledgeGaps, coordQueue } from "../drizzle/schema";
import { getDb } from "./db";
import { logger } from "./logger";

const log = logger("knowledgeGapBridge");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GapBridgeResult {
  gapsFound: number;
  gapsBridged: number;
  gapsFailed: number;
  durationMs: number;
}

export interface GapBridgeStats {
  openGaps: number;
  pursuedGaps: number;
  closedGaps: number;
}

// ─── Priority mapping ─────────────────────────────────────────────────────────

function priorityFromScore(score: number): number {
  if (score >= 0.8) return 10;   // high
  if (score >= 0.5) return 5;    // medium
  return 0;                       // normal
}

// ─── Gap → vertical mapping ───────────────────────────────────────────────────

function verticalFromGapType(gapType: string): string {
  switch (gapType) {
    case "structural":    return "structural_biology";
    case "evidence":      return "structural_biology";
    case "contradiction": return "structural_biology";
    case "temporal":      return "structural_biology";
    case "hypothesis":    return "structural_biology";
    default:              return "structural_biology";
  }
}

// ─── Main bridge function ─────────────────────────────────────────────────────

/**
 * Bridge all open knowledge gaps to the coordQueue for evidence pursuit.
 * Marks each bridged gap as "pursued" with the new coordQueue item id.
 */
export async function bridgeOpenGapsToCoordQueue(
  options: { batchSize?: number } = {}
): Promise<GapBridgeResult> {
  const startedAt = Date.now();
  const { batchSize = 50 } = options;

  const db = await getDb();
  if (!db) {
    log.warn("[knowledgeGapBridge] DB unavailable — skipping gap bridge");
    return { gapsFound: 0, gapsBridged: 0, gapsFailed: 0, durationMs: 0 };
  }

  // Fetch open gaps ordered by priority (highest first)
  const openGaps = await db
    .select()
    .from(knowledgeGaps)
    .where(eq(knowledgeGaps.status, "open"))
    .orderBy(knowledgeGaps.priorityScore)
    .limit(batchSize);

  if (openGaps.length === 0) {
    log.info("[knowledgeGapBridge] No open gaps found");
    return { gapsFound: 0, gapsBridged: 0, gapsFailed: 0, durationMs: Date.now() - startedAt };
  }

  log.info(`[knowledgeGapBridge] Found ${openGaps.length} open gaps to bridge`);

  let bridged = 0;
  let failed = 0;

  for (const gap of openGaps) {
    try {
      // Insert coordQueue item for this gap
      const [insertResult] = await db
        .insert(coordQueue)
        .values({
          vertical: verticalFromGapType(gap.gapType),
          title: gap.description,
          priority: priorityFromScore(gap.priorityScore),
          source: "knowledge_gap",
          status: "pending",
        })
        .execute() as unknown as [{ insertId: number }];

      const queueId = insertResult.insertId;

      // Mark gap as pursued with the new queue item id
      await db
        .update(knowledgeGaps)
        .set({
          status: "pursued",
          pursuitQueueId: queueId,
          lastPursuedAt: new Date(),
          evidenceAttempts: (gap.evidenceAttempts ?? 0) + 1,
        })
        .where(eq(knowledgeGaps.id, gap.id));

      log.info(
        `[knowledgeGapBridge] Bridged gap ${gap.id} (${gap.gapType}) → coordQueue ${queueId}`
      );
      bridged++;
    } catch (err) {
      log.error(
        `[knowledgeGapBridge] Failed to bridge gap ${gap.id}`,
        { err: String(err) }
      );
      failed++;
    }
  }

  const durationMs = Date.now() - startedAt;
  log.info(
    `[knowledgeGapBridge] Complete: ${bridged} bridged, ${failed} failed in ${durationMs}ms`
  );

  return {
    gapsFound: openGaps.length,
    gapsBridged: bridged,
    gapsFailed: failed,
    durationMs,
  };
}

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * Return aggregate counts of gaps by lifecycle status.
 */
export async function getGapBridgeStats(): Promise<GapBridgeStats> {
  const db = await getDb();
  if (!db) return { openGaps: 0, pursuedGaps: 0, closedGaps: 0 };

  const openRows = await db
    .select()
    .from(knowledgeGaps)
    .where(eq(knowledgeGaps.status, "open"));

  const pursuedRows = await db
    .select()
    .from(knowledgeGaps)
    .where(eq(knowledgeGaps.status, "pursued"));

  const closedRows = await db
    .select()
    .from(knowledgeGaps)
    .where(
      inArray(knowledgeGaps.status, ["closed_verified", "closed_resolved"])
    );

  return {
    openGaps: (openRows as unknown[]).length,
    pursuedGaps: (pursuedRows as unknown[]).length,
    closedGaps: (closedRows as unknown[]).length,
  };
}
