/**
 * types.ts — Centralised type definitions for the Self-Prompting Engine (L2).
 *
 * All types are defined here and re-exported from index.ts.
 * Individual modules import from this file instead of defining inline.
 *
 * PRD-L2 §6.1 — Type Contract
 */

// ─── Event Types ──────────────────────────────────────────────────────────────

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

// ─── System State ─────────────────────────────────────────────────────────────

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
  /** Number of distinct drift-type checks in the last 24 h */
  driftFindingCount: number;
}

/** Verdict distribution for the last 7 days — used to detect claim-quality trends. */
export interface ClaimTrends {
  recentVerifiedCount: number;
  recentSupportedCount: number;
  recentContradictedCount: number;
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
  /** 4-bucket histogram of frontier gap ages (FR-L2-T025) */
  gapAgeDistribution: GapAgeDistribution;
  /** COUNT(verified) / COUNT(total) for hypotheses in last 7 days (FR-L2-T026) */
  hypothesisVerificationRate7d: number;
}

/** Self-prompt engine performance stats */
export interface SelfPromptStats {
  /** COUNT(consumedAt IS NOT NULL) / COUNT(*) for directives in last 7 days (FR-L2-T027) */
  frontierDirectiveHitRate7d: number;
  /** Number of L2 cycles in the last 24 hours */
  cyclesLast24h: number;
}

/** Active frontier directives (FR-L2-T028) */
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
  totalCompletedSessions: number;
  recentSessionCount: number;
  pendingStagingItems: number;
  /** Last dream session wake time */
  lastWakeAt: Date | null;
  /** Sessions in last 30 days */
  sessionsLast30d: number;
}

/** Meta-agent and alert stats */
export interface MetaStats {
  /** Most recent meta-agent health score */
  lastHealthScore: number;
  /** Open (unresolved) alerts from meta_agent_alerts */
  openAlerts: number;
  /** Drift flags raised in the last 7 days */
  driftFlagsLast7d: number;
}

/** Frontier directive pipeline stats */
export interface DirectiveStats {
  activeDirectiveCount: number;
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
  staleEvidenceCount: number;
  lowConfidenceCount: number;
  claimTrends: ClaimTrends;
  frontierStats: FrontierStats;
  selfPromptStats: SelfPromptStats;
  /** Active frontier directives (not expired, not consumed) */
  activeDirectives: ActiveDirective[];
  dreamStats: DreamStats;
  metaStats: MetaStats;
  directiveStats: DirectiveStats;
}

// ─── Action Types ─────────────────────────────────────────────────────────────

export type ActionPriority = "critical" | "high" | "normal" | "low";

export type PriorityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "DEFERRED";

export type SelfPromptAction =
  | "notify"
  | "wiki_update"
  | "wiki_edit"
  | "frontier"
  | "reindex"
  | "alert"
  | "alert_dispatch"
  | "gap_map"
  | "graph_suggest"
  | "ingest_request"
  | "update_claim"
  | "converge"
  | "meta_check"
  | "drain_queue"
  | "reverify_stale"
  | "recalibrate_confidence";

export interface PrioritizedAction {
  priority: number; // 1–100
  priorityLevel: PriorityLevel;
  action: SelfPromptAction;
  targetId: number;
  reasoning: string;
  /** One-sentence justification for why this action was chosen over alternatives */
  justification: string;
  expectedValue: number; // 0–100
}

export interface SelfPrompt {
  reasoning: string;
  actions: PrioritizedAction[];
  converge: boolean;
}

// ─── Directive Types ──────────────────────────────────────────────────────────

export type FrontierDirectiveType =
  | "focus_gap"
  | "skip_mapping"
  | "prioritize_hypotheses"
  | "deep_dive_entity";

export interface FrontierDirectiveInput {
  directiveType: FrontierDirectiveType;
  targetId?: number;
  reason: string;
  confidence?: number;
  ttlMinutes?: number;
  issuedByCycleId?: number;
}

// ─── LLM Response Types ───────────────────────────────────────────────────────

export interface LlmResponse {
  reasoning: string;
  actions: PrioritizedAction[];
  directives?: FrontierDirectiveInput[];
  converge: boolean;
  convergenceReason?: string | null;
}

// ─── Execution Result Types ───────────────────────────────────────────────────

export interface ActionExecutionResult {
  action: string;
  targetId: number;
  status: "ok" | "skipped" | "error";
  detail: string;
  /** Module name that handled this action */
  delegatedTo: string;
  /** Execution duration in milliseconds */
  durationMs: number;
}

// ─── Cycle Result ─────────────────────────────────────────────────────────────

export interface SelfPromptCycleResult {
  cycleId: number | null;
  eventType: string;
  reasoning: string;
  actionsGenerated: number;
  actionsExecuted: number;
  converged: boolean;
  gateOverrode: boolean;
  gateReason: string;
  directivesPublished: number;
  durationMs: number;
  error?: string;
}
