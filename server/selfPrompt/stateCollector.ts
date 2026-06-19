/**
 * stateCollector.ts — SystemState snapshot collector for the Self-Prompting Engine.
 *
 * Reads the current state of the knowledge graph, queue, meta-agent health,
 * and recent events from the DB to build a SystemState object that the
 * Self-Prompting Engine uses to reason about what to do next.
 *
 * Authority boundary: READ-ONLY. This module never writes to any table.
 *
 * T024: confidence trend (7d delta)
 * T025: gap age distribution (4 buckets)
 * T026: hypothesis verification rate (7d)
 * T027: frontier directive hit rate + cycles last 24h
 * T028: active directives list (up to 10)
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
  metaAgentAlerts,
  selfPromptLog,
} from "../../drizzle/schema";
import {
  eq,
  count,
  and,
  gte,
  lte,
  lt,
  isNotNull,
  inArray,
  avg,
  desc,
} from "drizzle-orm";

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
  /** Average confidence delta: today's avg minus 7-days-ago avg (FR-L2-T024) */
  confidenceTrend7d: number;
}

/** Frontier gap age distribution (FR-L2-T025) */
export interface GapAgeDistribution {
  bucket0to1d: number;
  bucket1to7d: number;
  bucket7to30d: number;
  bucket30dPlus: number;
}

/** Frontier stats including gap age distribution and hypothesis verification rate */
export interface FrontierStats {
  /** 4-bucket histogram of open frontier gap ages (FR-L2-T025) */
  gapAgeDistribution: GapAgeDistribution;
  /** COUNT(verified) / COUNT(total) for hypothesis gaps updated in last 7 days (FR-L2-T026) */
  hypothesisVerificationRate7d: number;
}

/** Self-prompt engine performance stats */
export interface SelfPromptStats {
  /** COUNT(completedAt IS NOT NULL) / COUNT(*) for directives created in last 7 days (FR-L2-T027) */
  frontierDirectiveHitRate7d: number;
  /** Number of L2 cycles in the last 24 hours */
  cyclesLast24h: number;
}

/** Active frontier directive (FR-L2-T028) */
export interface ActiveDirective {
  id: number;
  directiveId: string;
  triggerReason: string;
  priority: number;
  status: string;
  createdAt: Date;
}

/** Aggregated Dream Engine stats */
export interface DreamStats {
  /** Total completed dream sessions (wokeAt IS NOT NULL) */
  totalCompletedSessions: number;
  /** Dream sessions started in the last 24 h */
  recentSessionCount: number;
  /** Pending items in the dream staging queue */
  pendingStagingItems: number;
  /** Last dream session wake time */
  lastWakeAt: Date | null;
  /** Sessions started in the last 30 days */
  sessionsLast30d: number;
}

/** Meta-agent and alert stats */
export interface MetaStats {
  /** Most recent meta-agent health score (mirrors metaHealth.score) */
  lastHealthScore: number;
  /** Open (unacknowledged) alerts from meta_agent_alerts */
  openAlerts: number;
  /** Critical alerts dispatched in the last 7 days */
  driftFlagsLast7d: number;
}

/** Frontier directive pipeline stats */
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
  /** Frontier gap age distribution and hypothesis verification rate (T025-T026) */
  frontierStats: FrontierStats;
  /** Self-prompt engine performance stats (T027) */
  selfPromptStats: SelfPromptStats;
  /** Active frontier directives (not expired, not consumed) (T028) */
  activeDirectives: ActiveDirective[];
  /** Dream Engine aggregate stats */
  dreamStats: DreamStats;
  /** Meta-agent and alert stats */
  metaStats: MetaStats;
  /** Frontier directive pipeline stats */
  directiveStats: DirectiveStats;
}

// ─── Safe-state helper ────────────────────────────────────────────────────────

function buildSafeState(event: SelfPromptEvent): SystemState {
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
      confidenceTrend7d: 0,
    },
    frontierStats: {
      gapAgeDistribution: {
        bucket0to1d: 0,
        bucket1to7d: 0,
        bucket7to30d: 0,
        bucket30dPlus: 0,
      },
      hypothesisVerificationRate7d: 0,
    },
    selfPromptStats: { frontierDirectiveHitRate7d: 0, cyclesLast24h: 0 },
    activeDirectives: [],
    dreamStats: {
      totalCompletedSessions: 0,
      recentSessionCount: 0,
      pendingStagingItems: 0,
      lastWakeAt: null,
      sessionsLast30d: 0,
    },
    metaStats: { lastHealthScore: 100, openAlerts: 0, driftFlagsLast7d: 0 },
    directiveStats: { activeDirectiveCount: 0, recentDirectiveCount: 0 },
  };
}

// ─── State Collector ──────────────────────────────────────────────────────────

// eslint-disable-next-line complexity -- many parallel queries needed for full system snapshot
export async function collectSystemState(
  event: SelfPromptEvent
): Promise<SystemState> {
  const db = await getDb();

  if (!db) {
    return buildSafeState(event);
  }

  const now = Date.now();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
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
    // Claim trends
    recentVerifiedResult,
    recentSupportedResult,
    recentContradictedResult,
    recentAmbiguousResult,
    // T024: confidence trend
    avgConfNowResult,
    avgConf7dAgoResult,
    // T025: gap age distribution
    gapAge0to1dResult,
    gapAge1to7dResult,
    gapAge7to30dResult,
    gapAge30dPlusResult,
    // T026: hypothesis verification rate
    hypothesisVerifiedResult,
    hypothesisTotalResult,
    // T027: directive hit rate + cycles last 24h
    directivesConsumedResult,
    directivesTotal7dResult,
    cyclesLast24hResult,
    // T028: active directives list
    activeDirectivesListResult,
    // Dream stats
    totalDreamSessionsResult,
    recentDreamSessionsResult,
    pendingStagingResult,
    lastWakeAtResult,
    sessionsLast30dResult,
    // Meta stats
    openAlertsResult,
    driftFlagsLast7dResult,
    // Directive counts
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
    // Recent drift findings (last 24h)
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
    // Stale PDB evidence
    db
      .select({ cnt: count() })
      .from(claims)
      .where(
        and(
          isNotNull(claims.pdbEvidenceCheckedAt),
          lt(claims.pdbEvidenceCheckedAt, staleThreshold)
        )
      ),
    // Low confidence claims
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
    // T024: avg confidence for claims created in last 7 days
    db
      .select({ avgConf: avg(claims.confidenceScore) })
      .from(claims)
      .where(
        and(
          isNotNull(claims.confidenceScore),
          gte(claims.createdAt, sevenDaysAgo)
        )
      ),
    // T024: avg confidence for claims created 14-7 days ago (baseline)
    db
      .select({ avgConf: avg(claims.confidenceScore) })
      .from(claims)
      .where(
        and(
          isNotNull(claims.confidenceScore),
          gte(claims.createdAt, fourteenDaysAgo),
          lt(claims.createdAt, sevenDaysAgo)
        )
      ),
    // T025: gap age bucket 0-1 day
    db
      .select({ cnt: count() })
      .from(knowledgeGaps)
      .where(
        and(
          eq(knowledgeGaps.status, "open"),
          gte(knowledgeGaps.openedAt, oneDayAgo)
        )
      ),
    // T025: gap age bucket 1-7 days
    db
      .select({ cnt: count() })
      .from(knowledgeGaps)
      .where(
        and(
          eq(knowledgeGaps.status, "open"),
          gte(knowledgeGaps.openedAt, sevenDaysAgo),
          lt(knowledgeGaps.openedAt, oneDayAgo)
        )
      ),
    // T025: gap age bucket 7-30 days
    db
      .select({ cnt: count() })
      .from(knowledgeGaps)
      .where(
        and(
          eq(knowledgeGaps.status, "open"),
          gte(knowledgeGaps.openedAt, thirtyDaysAgo),
          lt(knowledgeGaps.openedAt, sevenDaysAgo)
        )
      ),
    // T025: gap age bucket 30+ days
    db
      .select({ cnt: count() })
      .from(knowledgeGaps)
      .where(
        and(
          eq(knowledgeGaps.status, "open"),
          lt(knowledgeGaps.openedAt, thirtyDaysAgo)
        )
      ),
    // T026: hypothesis gaps closed/verified in last 7 days
    db
      .select({ cnt: count() })
      .from(knowledgeGaps)
      .where(
        and(
          eq(knowledgeGaps.gapType, "hypothesis"),
          inArray(knowledgeGaps.status, ["closed_verified", "closed_resolved"]),
          gte(knowledgeGaps.updatedAt, sevenDaysAgo)
        )
      ),
    // T026: total hypothesis gaps updated in last 7 days
    db
      .select({ cnt: count() })
      .from(knowledgeGaps)
      .where(
        and(
          eq(knowledgeGaps.gapType, "hypothesis"),
          gte(knowledgeGaps.updatedAt, sevenDaysAgo)
        )
      ),
    // T027: frontier directives with completedAt set in last 7 days
    db
      .select({ cnt: count() })
      .from(frontierDirectives)
      .where(
        and(
          isNotNull(frontierDirectives.completedAt),
          gte(frontierDirectives.createdAt, sevenDaysAgo)
        )
      ),
    // T027: total frontier directives created in last 7 days
    db
      .select({ cnt: count() })
      .from(frontierDirectives)
      .where(gte(frontierDirectives.createdAt, sevenDaysAgo)),
    // T027: L2 cycles in last 24h
    db
      .select({ cnt: count() })
      .from(selfPromptLog)
      .where(gte(selfPromptLog.createdAt, oneDayAgo)),
    // T028: active directives list (pending/active, up to 10, highest priority first)
    db
      .select({
        id: frontierDirectives.id,
        directiveId: frontierDirectives.directiveId,
        triggerReason: frontierDirectives.triggerReason,
        priority: frontierDirectives.priority,
        status: frontierDirectives.status,
        createdAt: frontierDirectives.createdAt,
      })
      .from(frontierDirectives)
      .where(inArray(frontierDirectives.status, ["pending", "active"]))
      .orderBy(desc(frontierDirectives.priority))
      .limit(10),
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
    // Dream stats: last wake time
    db
      .select({ wokeAt: dreamSessions.wokeAt })
      .from(dreamSessions)
      .where(isNotNull(dreamSessions.wokeAt))
      .orderBy(desc(dreamSessions.wokeAt))
      .limit(1),
    // Dream stats: sessions in last 30 days
    db
      .select({ cnt: count() })
      .from(dreamSessions)
      .where(gte(dreamSessions.startedAt, thirtyDaysAgo)),
    // Meta stats: open (unacknowledged) alerts
    db
      .select({ cnt: count() })
      .from(metaAgentAlerts)
      .where(eq(metaAgentAlerts.acknowledged, false)),
    // Meta stats: critical alerts dispatched in last 7 days
    db
      .select({ cnt: count() })
      .from(metaAgentAlerts)
      .where(
        and(
          eq(metaAgentAlerts.severity, "critical"),
          gte(metaAgentAlerts.dispatchedAt, sevenDaysAgo)
        )
      ),
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

  // ─── Derived values ──────────────────────────────────────────────────────────

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

  // T024: confidence trend
  const avgConfNow =
    avgConfNowResult[0]?.avgConf != null
      ? Number(avgConfNowResult[0].avgConf)
      : null;
  const avgConf7dAgo =
    avgConf7dAgoResult[0]?.avgConf != null
      ? Number(avgConf7dAgoResult[0].avgConf)
      : null;
  const confidenceTrend7d =
    avgConfNow != null && avgConf7dAgo != null
      ? Math.round((avgConfNow - avgConf7dAgo) * 1000) / 1000
      : 0;

  // T026: hypothesis verification rate
  const hypothesisVerified = Number(hypothesisVerifiedResult[0]?.cnt ?? 0);
  const hypothesisTotal = Number(hypothesisTotalResult[0]?.cnt ?? 0);
  const hypothesisVerificationRate7d =
    hypothesisTotal > 0
      ? Math.round((hypothesisVerified / hypothesisTotal) * 1000) / 1000
      : 0;

  // T027: directive hit rate
  const directivesConsumed = Number(directivesConsumedResult[0]?.cnt ?? 0);
  const directivesTotal7d = Number(directivesTotal7dResult[0]?.cnt ?? 0);
  const frontierDirectiveHitRate7d =
    directivesTotal7d > 0
      ? Math.round((directivesConsumed / directivesTotal7d) * 1000) / 1000
      : 0;

  // Health score
  let score = 100;
  score -= criticalCount * 15;
  score -= warningCount * 5;
  score -= Math.min(failedItems * 2, 20);
  score -= Math.min(driftFindingCount * 3, 15);
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
    queueSnapshot: { pendingItems, failedItems },
    metaHealth: {
      score,
      grade,
      criticalCount,
      warningCount,
      driftFindingCount,
    },
    subscriptionSnapshot: { activeWebhookCount },
    staleEvidenceCount,
    lowConfidenceCount,
    claimTrends: {
      recentVerifiedCount: Number(recentVerifiedResult[0]?.cnt ?? 0),
      recentSupportedCount: Number(recentSupportedResult[0]?.cnt ?? 0),
      recentContradictedCount: Number(recentContradictedResult[0]?.cnt ?? 0),
      recentAmbiguousCount: Number(recentAmbiguousResult[0]?.cnt ?? 0),
      confidenceTrend7d,
    },
    frontierStats: {
      gapAgeDistribution: {
        bucket0to1d: Number(gapAge0to1dResult[0]?.cnt ?? 0),
        bucket1to7d: Number(gapAge1to7dResult[0]?.cnt ?? 0),
        bucket7to30d: Number(gapAge7to30dResult[0]?.cnt ?? 0),
        bucket30dPlus: Number(gapAge30dPlusResult[0]?.cnt ?? 0),
      },
      hypothesisVerificationRate7d,
    },
    selfPromptStats: {
      frontierDirectiveHitRate7d,
      cyclesLast24h: Number(cyclesLast24hResult[0]?.cnt ?? 0),
    },
    activeDirectives: activeDirectivesListResult.map(d => ({
      id: d.id,
      directiveId: d.directiveId,
      triggerReason: d.triggerReason,
      priority: d.priority,
      status: d.status,
      createdAt: d.createdAt,
    })),
    dreamStats: {
      totalCompletedSessions: Number(totalDreamSessionsResult[0]?.cnt ?? 0),
      recentSessionCount: Number(recentDreamSessionsResult[0]?.cnt ?? 0),
      pendingStagingItems: Number(pendingStagingResult[0]?.cnt ?? 0),
      lastWakeAt: lastWakeAtResult[0]?.wokeAt ?? null,
      sessionsLast30d: Number(sessionsLast30dResult[0]?.cnt ?? 0),
    },
    metaStats: {
      lastHealthScore: score,
      openAlerts: Number(openAlertsResult[0]?.cnt ?? 0),
      driftFlagsLast7d: Number(driftFlagsLast7dResult[0]?.cnt ?? 0),
    },
    directiveStats: {
      activeDirectiveCount: Number(activeDirectivesResult[0]?.cnt ?? 0),
      recentDirectiveCount: Number(recentDirectivesResult[0]?.cnt ?? 0),
    },
  };
}
