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
} from "../../drizzle/schema";
import { eq, count, and, gte, lte, lt, sql, isNotNull } from "drizzle-orm";

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
  staleEvidenceCount: number;   // Claims with pdbEvidenceCheckedAt > 180 days ago
  lowConfidenceCount: number;   // Claims with confidenceScore < 0.4
}

// ─── State Collector ──────────────────────────────────────────────────────────

export async function collectSystemState(event: SelfPromptEvent): Promise<SystemState> {
  const db = await getDb();

  if (!db) {
    // DB unavailable — return a minimal safe state
    return {
      recentEvent: event,
      graphSnapshot: { entityCount: 0, contradictionCount: 0, openGapCount: 0, highPriorityGapCount: 0 },
      queueSnapshot: { pendingItems: 0, failedItems: 0 },
      metaHealth: { score: 100, grade: "A", criticalCount: 0, warningCount: 0 },
      subscriptionSnapshot: { activeWebhookCount: 0 },
      staleEvidenceCount: 0,
      lowConfidenceCount: 0,
    };
  }

  const [
    entityCountResult,
    contradictionCountResult,
    openGapCountResult,
    highPriorityGapCountResult,
    pendingQueueResult,
    failedQueueResult,
    recentCriticalResult,
    recentWarningResult,
    activeWebhookResult,
    staleEvidenceResult,
    lowConfidenceResult,
  ] = await Promise.all([
    // Graph entity count
    db.select({ cnt: count() }).from(graphEntities),
    // Contradiction edge count
    db.select({ cnt: count() }).from(graphRelations).where(eq(graphRelations.relationType, "contradicts")),
    // Open gap count
    db.select({ cnt: count() }).from(knowledgeGaps).where(eq(knowledgeGaps.status, "open")),
    // High-priority gaps (score > 50)
    db.select({ cnt: count() }).from(knowledgeGaps).where(
      and(eq(knowledgeGaps.status, "open"), gte(knowledgeGaps.priorityScore, 50))
    ),
    // Pending queue items
    db.select({ cnt: count() }).from(coordQueue).where(eq(coordQueue.status, "pending")),
    // Failed queue items
    db.select({ cnt: count() }).from(coordQueue).where(eq(coordQueue.status, "failed")),
    // Recent critical meta-agent checks (last 24h)
    db.select({ cnt: count() }).from(metaAgentChecks).where(
      and(
        eq(metaAgentChecks.severity, "critical"),
        gte(metaAgentChecks.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    ),
    // Recent warning meta-agent checks (last 24h)
    db.select({ cnt: count() }).from(metaAgentChecks).where(
      and(
        eq(metaAgentChecks.severity, "warning"),
        gte(metaAgentChecks.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    ),
    // Active webhook subscriptions
    db.select({ cnt: count() }).from(webhookAlerts).where(eq(webhookAlerts.active, true)),
    // Stale PDB evidence: claims where pdbEvidenceCheckedAt is older than 180 days
    db.select({ cnt: count() }).from(claims).where(
      and(
        isNotNull(claims.pdbEvidenceCheckedAt),
        lt(claims.pdbEvidenceCheckedAt, new Date(Date.now() - 180 * 24 * 60 * 60 * 1000))
      )
    ),
    // Low confidence claims: confidenceScore < 0.4 and not null
    db.select({ cnt: count() }).from(claims).where(
      and(
        isNotNull(claims.confidenceScore),
        lte(claims.confidenceScore, 0.4)
      )
    ),
  ]);

  const entityCount = entityCountResult[0]?.cnt ?? 0;
  const contradictionCount = contradictionCountResult[0]?.cnt ?? 0;
  const openGapCount = openGapCountResult[0]?.cnt ?? 0;
  const highPriorityGapCount = highPriorityGapCountResult[0]?.cnt ?? 0;
  const pendingItems = pendingQueueResult[0]?.cnt ?? 0;
  const failedItems = failedQueueResult[0]?.cnt ?? 0;
  const criticalCount = recentCriticalResult[0]?.cnt ?? 0;
  const warningCount = recentWarningResult[0]?.cnt ?? 0;
  const activeWebhookCount = activeWebhookResult[0]?.cnt ?? 0;
  const staleEvidenceCount = Number(staleEvidenceResult[0]?.cnt ?? 0);
  const lowConfidenceCount = Number(lowConfidenceResult[0]?.cnt ?? 0);

  // Compute a simple health score: start at 100, deduct for issues
  let score = 100;
  score -= criticalCount * 15;
  score -= warningCount * 5;
  score -= Math.min(failedItems * 2, 20); // cap at -20 for queue failures
  score = Math.max(0, Math.min(100, score));

  const grade =
    score >= 90 ? "A" :
    score >= 80 ? "B" :
    score >= 70 ? "C" :
    score >= 60 ? "D" : "F";

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
    },
    subscriptionSnapshot: {
      activeWebhookCount,
    },
    staleEvidenceCount,
    lowConfidenceCount,
  };
}
