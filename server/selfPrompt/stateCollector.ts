/**
 * stateCollector.ts — SystemState snapshot collector for the Self-Prompting Engine.
 *
 * Reads the current state of the knowledge graph, queue, meta-agent health,
 * and recent events from the DB to build a SystemState object that the
 * Self-Prompting Engine uses to reason about what to do next.
 *
 * Authority boundary: READ-ONLY. This module never writes to any table.
 */

import { getDb } from "../db";
import {
  graphEntities,
  graphRelations,
  coordQueue,
  metaAgentChecks,
  knowledgeGaps,
  claims,
  webhookAlerts,
  dreamSessions,
  dreamStagingQueue,
  frontierDirectives,
} from "../../drizzle/schema";
import { eq, count, and, gte, lte, lt, isNotNull, inArray } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SelfPromptEventType =
  | "verdict_assigned"
  | "contradiction_found"
  | "gap_closed"
  | "source_down"
  | "meta_alert"
  | "user_submitted"
  | "scheduled_tick";

export interface SelfPromptEvent {
  type: SelfPromptEventType;
  description: string;
  claimId?: number;
  verdict?: string;
  entityId?: number;
  gapId?: number;
  documentId?: number;
}

export interface GraphSnapshot {
  entityCount: number;
  contradictionCount: number;
  openGapCount: number;
  highPriorityGapCount: number;
}

export interface QueueSnapshot {
  pendingItems: number;
  failedItems: number;
}

export interface MetaHealthSnapshot {
  score: number;
  grade: string;
  criticalCount: number;
  warningCount: number;
  /** Number of distinct drift-type checks in the last 24 h (schemaDrift, apiDrift, etc.) */
  driftFindingCount: number;
}

/** Verdict distribution for the last 7 days — used to detect claim-quality trends. */
export interface ClaimTrends {
  /** Total claims with a verdict assigned in the last 7 days */
  recentVerifiedCount: number;
  /** Claims with a "Supported" or "Partially Supported" verdict in the last 7 days */
  recentSupportedCount: number;
  /** Claims with a "Contradicted" verdict in the last 7 days */
  recentContradictedCount: number;
  /** Claims with an "Ambiguous" or "Insufficient Evidence" verdict in the last 7 days */
  recentAmbiguousCount: number;
}

/** Aggregated Dream Engine stats — used to detect dream health and throughput. */
export interface DreamStats {
  /** Total completed dream sessions (wokeAt IS NOT NULL) */
  totalCompletedSessions: number;
  /** Dream sessions started in the last 24 h */
  recentSessionCount: number;
  /** Pending items in the dream staging queue */
  pendingStagingItems: number;
}

/** Frontier directive pipeline stats — used to detect directive backlog. */
export interface DirectiveStats {
  /** Directives currently in "pending" or "active" status */
  activeDirectiveCount: number;
  /** Directives created in the last 24 h */
  recentDirectiveCount: number;
}

export interface SubscriptionSnapshot {
  activeWebhookCount: number;
}

export interface SystemState {
  recentEvent: SelfPromptEvent;
  graphSnapshot: GraphSnapshot;
  queueSnapshot: QueueSnapshot;
  metaHealth: MetaHealthSnapshot;
  subscriptionSnapshot: SubscriptionSnapshot;
  staleEvidenceCount: number; // Claims with pdbEvidenceCheckedAt > 180 days ago
  lowConfidenceCount: number; // Claims with confidenceScore < 0.4
  /** Verdict distribution for the last 7 days */
  claimTrends: ClaimTrends;
  /** Dream Engine aggregate stats */
  dreamStats: DreamStats;
  /** Frontier directive pipeline stats */
  directiveStats: DirectiveStats;
}

// ─── State Collector ──────────────────────────────────────────────────────────

// eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export async function collectSystemState(
  event: SelfPromptEvent
): Promise<SystemState> {
  const db = await getDb();

  if (!db) {
    // DB unavailable — return a minimal safe state
    return {
      recentEvent: event,
      graphSnapshot: {
        entityCount: 0,
        contradictionCount: 0,
        openGapCount: 0,
        highPriorityGapCount: 0,
      },
      queueSnapshot: { pendingItems: 0, failedItems: 0 },
      metaHealth: {
        score: 100,
        grade: "A",
        criticalCount: 0,
        warningCount: 0,
        driftFindingCount: 0,
      },
      subscriptionSnapshot: { activeWebhookCount: 0 },
      staleEvidenceCount: 0,
      lowConfidenceCount: 0,
      claimTrends: {
        recentVerifiedCount: 0,
        recentSupportedCount: 0,
        recentContradictedCount: 0,
        recentAmbiguousCount: 0,
      },
      dreamStats: {
        totalCompletedSessions: 0,
        recentSessionCount: 0,
        pendingStagingItems: 0,
      },
      directiveStats: {
        activeDirectiveCount: 0,
        recentDirectiveCount: 0,
      },
    };
  }

  const now = Date.now();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const staleThreshold = new Date(now - 180 * 24 * 60 * 60 * 1000);

  const SUPPORTED_VERDICTS = ["Supported", "Partially Supported"] as const;
  const CONTRADICTED_VERDICTS = ["Contradicted"] as const;
  const AMBIGUOUS_VERDICTS = ["Ambiguous", "Insufficient Evidence"] as const;
  const DRIFT_CHECK_TYPES = [
    "schemaDrift",
    "apiDrift",
    "dependencyDrift",
    "configDrift",
    "disciplineDrift",
    "testDrift",
  ] as const;

  const [
    entityCountResult,
    contradictionCountResult,
    openGapCountResult,
    highPriorityGapCountResult,
    pendingQueueResult,
    failedQueueResult,
    recentCriticalResult,
    recentWarningResult,
    recentDriftResult,
    activeWebhookResult,
    staleEvidenceResult,
    lowConfidenceResult,
    recentVerifiedResult,
    recentSupportedResult,
    recentContradictedResult,
    recentAmbiguousResult,
    totalDreamSessionsResult,
    recentDreamSessionsResult,
    pendingStagingResult,
    activeDirectivesResult,
    recentDirectivesResult,
  ] = await Promise.all([
    // Graph entity count
    db.select({ cnt: count() }).from(graphEntities),
    // Contradiction edge count
    db
      .select({ cnt: count() })
      .from(graphRelations)
      .where(eq(graphRelations.relationType, "contradicts")),
    // Open gap count
    db
      .select({ cnt: count() })
      .from(knowledgeGaps)
      .where(eq(knowledgeGaps.status, "open")),
    // High-priority gaps (score > 50)
    db
      .select({ cnt: count() })
      .from(knowledgeGaps)
      .where(
        and(
          eq(knowledgeGaps.status, "open"),
          gte(knowledgeGaps.priorityScore, 50)
        )
      ),
    // Pending queue items
    db
      .select({ cnt: count() })
      .from(coordQueue)
      .where(eq(coordQueue.status, "pending")),
    // Failed queue items
    db
      .select({ cnt: count() })
      .from(coordQueue)
      .where(eq(coordQueue.status, "failed")),
    // Recent critical meta-agent checks (last 24h)
    db
      .select({ cnt: count() })
      .from(metaAgentChecks)
      .where(
        and(
          eq(metaAgentChecks.severity, "critical"),
          gte(metaAgentChecks.createdAt, oneDayAgo)
        )
      ),
    // Recent warning meta-agent checks (last 24h)
    db
      .select({ cnt: count() })
      .from(metaAgentChecks)
      .where(
        and(
          eq(metaAgentChecks.severity, "warning"),
          gte(metaAgentChecks.createdAt, oneDayAgo)
        )
      ),
    // Recent drift findings (last 24h) — schemaDrift, apiDrift, etc.
    db
      .select({ cnt: count() })
      .from(metaAgentChecks)
      .where(
        and(
          inArray(metaAgentChecks.checkType, [...DRIFT_CHECK_TYPES]),
          gte(metaAgentChecks.createdAt, oneDayAgo)
        )
      ),
    // Active webhook subscriptions
    db
      .select({ cnt: count() })
      .from(webhookAlerts)
      .where(eq(webhookAlerts.active, true)),
    // Stale PDB evidence: claims where pdbEvidenceCheckedAt is older than 180 days
    db
      .select({ cnt: count() })
      .from(claims)
      .where(
        and(
          isNotNull(claims.pdbEvidenceCheckedAt),
          lt(claims.pdbEvidenceCheckedAt, staleThreshold)
        )
      ),
    // Low confidence claims: confidenceScore < 0.4 and not null
    db
      .select({ cnt: count() })
      .from(claims)
      .where(
        and(isNotNull(claims.confidenceScore), lte(claims.confidenceScore, 0.4))
      ),
    // Claim trends: total verified in last 7 days
    db
      .select({ cnt: count() })
      .from(claims)
      .where(
        and(isNotNull(claims.verdict), gte(claims.createdAt, sevenDaysAgo))
      ),
    // Claim trends: supported in last 7 days
    db
      .select({ cnt: count() })
      .from(claims)
      .where(
        and(
          inArray(claims.verdict, [...SUPPORTED_VERDICTS]),
          gte(claims.createdAt, sevenDaysAgo)
        )
      ),
    // Claim trends: contradicted in last 7 days
    db
      .select({ cnt: count() })
      .from(claims)
      .where(
        and(
          inArray(claims.verdict, [...CONTRADICTED_VERDICTS]),
          gte(claims.createdAt, sevenDaysAgo)
        )
      ),
    // Claim trends: ambiguous in last 7 days
    db
      .select({ cnt: count() })
      .from(claims)
      .where(
        and(
          inArray(claims.verdict, [...AMBIGUOUS_VERDICTS]),
          gte(claims.createdAt, sevenDaysAgo)
        )
      ),
    // Dream stats: total completed sessions
    db
      .select({ cnt: count() })
      .from(dreamSessions)
      .where(isNotNull(dreamSessions.wokeAt)),
    // Dream stats: sessions in last 24h
    db
      .select({ cnt: count() })
      .from(dreamSessions)
      .where(gte(dreamSessions.startedAt, oneDayAgo)),
    // Dream stats: pending staging queue items
    db
      .select({ cnt: count() })
      .from(dreamStagingQueue)
      .where(eq(dreamStagingQueue.status, "pending")),
    // Directive stats: active directives (pending or active)
    db
      .select({ cnt: count() })
      .from(frontierDirectives)
      .where(inArray(frontierDirectives.status, ["pending", "active"])),
    // Directive stats: directives created in last 24h
    db
      .select({ cnt: count() })
      .from(frontierDirectives)
      .where(gte(frontierDirectives.createdAt, oneDayAgo)),
  ]);

  const entityCount = entityCountResult[0]?.cnt ?? 0;
  const contradictionCount = contradictionCountResult[0]?.cnt ?? 0;
  const openGapCount = openGapCountResult[0]?.cnt ?? 0;
  const highPriorityGapCount = highPriorityGapCountResult[0]?.cnt ?? 0;
  const pendingItems = pendingQueueResult[0]?.cnt ?? 0;
  const failedItems = failedQueueResult[0]?.cnt ?? 0;
  const criticalCount = recentCriticalResult[0]?.cnt ?? 0;
  const warningCount = recentWarningResult[0]?.cnt ?? 0;
  const driftFindingCount = Number(recentDriftResult[0]?.cnt ?? 0);
  const activeWebhookCount = activeWebhookResult[0]?.cnt ?? 0;
  const staleEvidenceCount = Number(staleEvidenceResult[0]?.cnt ?? 0);
  const lowConfidenceCount = Number(lowConfidenceResult[0]?.cnt ?? 0);

  // Compute a simple health score: start at 100, deduct for issues
  let score = 100;
  score -= criticalCount * 15;
  score -= warningCount * 5;
  score -= Math.min(failedItems * 2, 20); // cap at -20 for queue failures
  score -= Math.min(driftFindingCount * 3, 15); // cap at -15 for drift findings
  score = Math.max(0, Math.min(100, score));

  const grade =
    score >= 90
      ? "A"
      : score >= 80
        ? "B"
        : score >= 70
          ? "C"
          : score >= 60
            ? "D"
            : "F";

  return {
    recentEvent: event,
    graphSnapshot: {
      entityCount,
      contradictionCount,
      openGapCount,
      highPriorityGapCount,
    },
    queueSnapshot: {
      pendingItems,
      failedItems,
    },
    metaHealth: {
      score,
      grade,
      criticalCount,
      warningCount,
      driftFindingCount,
    },
    subscriptionSnapshot: {
      activeWebhookCount,
    },
    staleEvidenceCount,
    lowConfidenceCount,
    claimTrends: {
      recentVerifiedCount: Number(recentVerifiedResult[0]?.cnt ?? 0),
      recentSupportedCount: Number(recentSupportedResult[0]?.cnt ?? 0),
      recentContradictedCount: Number(recentContradictedResult[0]?.cnt ?? 0),
      recentAmbiguousCount: Number(recentAmbiguousResult[0]?.cnt ?? 0),
    },
    dreamStats: {
      totalCompletedSessions: Number(totalDreamSessionsResult[0]?.cnt ?? 0),
      recentSessionCount: Number(recentDreamSessionsResult[0]?.cnt ?? 0),
      pendingStagingItems: Number(pendingStagingResult[0]?.cnt ?? 0),
    },
    directiveStats: {
      activeDirectiveCount: Number(activeDirectivesResult[0]?.cnt ?? 0),
      recentDirectiveCount: Number(recentDirectivesResult[0]?.cnt ?? 0),
    },
  };
}
