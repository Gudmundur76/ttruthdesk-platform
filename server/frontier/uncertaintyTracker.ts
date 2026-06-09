/**
 * uncertaintyTracker.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontier Engine — Layer 5: Uncertainty Evolution Tracking
 *
 * Tracks the lifecycle of every gap:
 *   openedAt → evidenceAttempts → status → projectedClosure
 *
 * Also computes the Frontier Engine's success metrics:
 *   - Gaps opened → Gaps closed (within 30 days)
 *   - Hypotheses submitted → Hypotheses verified
 *   - Hypotheses contradicted (also success — false paths eliminated)
 *   - Time-to-closure for high-priority gaps
 *   - False hypothesis rate
 */

import { getDb } from "../db";
import { knowledgeGaps, frontierLog } from "../../drizzle/schema";
import { eq, sql, and, lt } from "drizzle-orm";

// ─── DB helper ────────────────────────────────────────────────────────────────
async function getDbOrThrow() {
  const d = await getDb();
  if (!d) throw new Error("[FrontierEngine] Database not available");
  return d;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FrontierMetrics {
  /** Total gaps ever detected */
  totalGapsDetected: number;
  /** Gaps currently open */
  openGaps: number;
  /** Gaps currently being pursued */
  pursuedGaps: number;
  /** Gaps closed by verified evidence */
  closedVerified: number;
  /** Gaps closed by contradiction resolution */
  closedResolved: number;
  /** Gaps marked stale (no progress) */
  staleGaps: number;
  /** Total hypotheses queued */
  hypothesesQueued: number;
  /** Hypotheses that became Supported claims */
  hypothesesVerified: number;
  /** Hypotheses that were Contradicted (also success) */
  hypothesesRefuted: number;
  /** Average time to closure in days (for closed gaps) */
  avgDaysToClosureHigh: number | null;
  /** False hypothesis rate (contradicted / total queued) */
  falseHypothesisRate: number | null;
  /** Gaps closed within 30 days (success rate) */
  closureRate30Days: number | null;
}

export interface GapTimeline {
  gapId: number;
  description: string;
  gapType: string;
  status: string;
  priorityScore: number;
  openedAt: Date;
  lastPursuedAt: Date | null;
  evidenceAttempts: number;
  projectedClosureAt: Date | null;
  logEntries: Array<{
    actionType: string;
    outcome: string | null;
    createdAt: Date;
  }>;
}

// ─── Core: computeProjectedClosure ───────────────────────────────────────────

/**
 * Estimates time to closure based on:
 *   - Current evidence attempts
 *   - Average swarm throughput (papers processed per day)
 *   - Gap priority score
 */
async function computeProjectedClosure(gapId: number): Promise<Date | null> {
  const db = await getDbOrThrow();

  try {
    // Get average papers processed per day over last 7 days
    const throughputResult = await db.execute(sql`
      SELECT COUNT(*) / 7.0 as dailyThroughput
      FROM coord_queue
      WHERE status = 'completed'
        AND completedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    const throughputRows = throughputResult[0] as unknown as Array<{
      dailyThroughput: number;
    }>;
    const dailyThroughput = throughputRows[0]?.dailyThroughput ?? 1;

    // Estimate days to closure: assume 5-20 papers needed per gap
    const gap = await db
      .select({
        priorityScore: knowledgeGaps.priorityScore,
        evidenceAttempts: knowledgeGaps.evidenceAttempts,
      })
      .from(knowledgeGaps)
      .where(eq(knowledgeGaps.id, gapId))
      .limit(1);

    if (gap.length === 0) return null;

    const papersNeeded = Math.max(5 - gap[0].evidenceAttempts, 1);
    const daysToClose = Math.ceil(
      papersNeeded / Math.max(dailyThroughput, 0.1)
    );

    return new Date(Date.now() + daysToClose * 24 * 60 * 60 * 1000);
  } catch {
    return null;
  }
}

// ─── Core: markStaleGaps ─────────────────────────────────────────────────────

/**
 * Marks gaps as stale if they have been pursued for more than 90 days
 * without any progress (no new evidence, still "pursued" status).
 */
export async function markStaleGaps(): Promise<number> {
  const db = await getDbOrThrow();

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  try {
    const result = await db
      .update(knowledgeGaps)
      .set({ status: "stale", updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeGaps.status, "pursued"),
          lt(knowledgeGaps.lastPursuedAt, cutoff)
        )
      );

    return (result[0] as unknown as { affectedRows: number }).affectedRows ?? 0;
  } catch {
    return 0;
  }
}

// ─── Public: getFrontierMetrics ───────────────────────────────────────────────

/**
 * Computes the Frontier Engine's success metrics.
 * These are the primary KPIs for evaluating Frontier's value.
 */
export async function getFrontierMetrics(): Promise<FrontierMetrics> {
  const db = await getDbOrThrow();

  try {
    // Gap counts by status
    const gapCounts = await db.execute(sql`
      SELECT status, COUNT(*) as cnt
      FROM knowledge_gaps
      GROUP BY status
    `);
    const gapRows = gapCounts[0] as unknown as Array<{
      status: string;
      cnt: number;
    }>;
    const statusMap = Object.fromEntries(gapRows.map(r => [r.status, r.cnt]));

    // Total gaps
    const totalGapsDetected = gapRows.reduce((sum, r) => sum + r.cnt, 0);

    // Hypothesis metrics from frontier_log
    const hypothesisMetrics = await db.execute(sql`
      SELECT actionType, COUNT(*) as cnt
      FROM frontier_log
      WHERE actionType IN ('hypothesis_queued', 'hypothesis_verified', 'hypothesis_refuted')
      GROUP BY actionType
    `);
    const hypRows = hypothesisMetrics[0] as unknown as Array<{
      actionType: string;
      cnt: number;
    }>;
    const hypMap = Object.fromEntries(hypRows.map(r => [r.actionType, r.cnt]));

    const hypothesesQueued = hypMap["hypothesis_queued"] ?? 0;
    const hypothesesVerified = hypMap["hypothesis_verified"] ?? 0;
    const hypothesesRefuted = hypMap["hypothesis_refuted"] ?? 0;

    // Average time to closure for high-priority gaps (priorityScore >= 50)
    const closureTimeResult = await db.execute(sql`
      SELECT AVG(DATEDIFF(updatedAt, openedAt)) as avgDays
      FROM knowledge_gaps
      WHERE status IN ('closed_verified', 'closed_resolved')
        AND priorityScore >= 50
    `);
    const closureRows = closureTimeResult[0] as unknown as Array<{
      avgDays: number | null;
    }>;
    const avgDaysToClosureHigh = closureRows[0]?.avgDays ?? null;

    // Closure rate within 30 days
    const closureRateResult = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN DATEDIFF(updatedAt, openedAt) <= 30 THEN 1 ELSE 0 END) as closedIn30
      FROM knowledge_gaps
      WHERE status IN ('closed_verified', 'closed_resolved')
    `);
    const crRows = closureRateResult[0] as unknown as Array<{
      total: number;
      closedIn30: number;
    }>;
    const total = crRows[0]?.total ?? 0;
    const closedIn30 = crRows[0]?.closedIn30 ?? 0;
    const closureRate30Days = total > 0 ? closedIn30 / total : null;

    // False hypothesis rate
    const falseHypothesisRate =
      hypothesesQueued > 0 ? hypothesesRefuted / hypothesesQueued : null;

    return {
      totalGapsDetected,
      openGaps: statusMap["open"] ?? 0,
      pursuedGaps: statusMap["pursued"] ?? 0,
      closedVerified: statusMap["closed_verified"] ?? 0,
      closedResolved: statusMap["closed_resolved"] ?? 0,
      staleGaps: statusMap["stale"] ?? 0,
      hypothesesQueued,
      hypothesesVerified,
      hypothesesRefuted,
      avgDaysToClosureHigh,
      falseHypothesisRate,
      closureRate30Days,
    };
  } catch {
    return {
      totalGapsDetected: 0,
      openGaps: 0,
      pursuedGaps: 0,
      closedVerified: 0,
      closedResolved: 0,
      staleGaps: 0,
      hypothesesQueued: 0,
      hypothesesVerified: 0,
      hypothesesRefuted: 0,
      avgDaysToClosureHigh: null,
      falseHypothesisRate: null,
      closureRate30Days: null,
    };
  }
}

// ─── Public: getGapTimeline ───────────────────────────────────────────────────

/**
 * Returns the full lifecycle timeline for a single gap.
 */
export async function getGapTimeline(
  gapId: number
): Promise<GapTimeline | null> {
  const db = await getDbOrThrow();

  try {
    const gaps = await db
      .select()
      .from(knowledgeGaps)
      .where(eq(knowledgeGaps.id, gapId))
      .limit(1);

    if (gaps.length === 0) return null;
    const gap = gaps[0];

    const logEntries = await db
      .select({
        actionType: frontierLog.actionType,
        outcome: frontierLog.outcome,
        createdAt: frontierLog.createdAt,
      })
      .from(frontierLog)
      .where(eq(frontierLog.gapId, gapId))
      .orderBy(frontierLog.createdAt);

    // Update projected closure
    const projectedClosureAt = await computeProjectedClosure(gapId);
    if (projectedClosureAt && gap.status === "pursued") {
      await db
        .update(knowledgeGaps)
        .set({ projectedClosureAt, updatedAt: new Date() })
        .where(eq(knowledgeGaps.id, gapId));
    }

    return {
      gapId: gap.id,
      description: gap.description,
      gapType: gap.gapType,
      status: gap.status,
      priorityScore: gap.priorityScore,
      openedAt:
        gap.openedAt instanceof Date ? gap.openedAt : new Date(gap.openedAt),
      lastPursuedAt: gap.lastPursuedAt
        ? gap.lastPursuedAt instanceof Date
          ? gap.lastPursuedAt
          : new Date(gap.lastPursuedAt)
        : null,
      evidenceAttempts: gap.evidenceAttempts,
      projectedClosureAt: projectedClosureAt,
      logEntries: logEntries.map(e => ({
        actionType: e.actionType,
        outcome: e.outcome,
        createdAt:
          e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt),
      })),
    };
  } catch {
    return null;
  }
}
