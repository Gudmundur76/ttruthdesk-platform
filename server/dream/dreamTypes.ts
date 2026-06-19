/**
 * dreamTypes.ts — Shared types for the L5 Dream State engine
 *
 * Defines DreamEvent (FR-L5-32), DreamPriority (FR-L5-36),
 * ProposedGraphMutation (FR-L5-13), and per-cycle budget types (FR-L5-07).
 *
 * Build3 — L5 Dream State
 */

// ─── Dream Priority (FR-L5-36) ─────────────────────────────────────────────────
/**
 * Priority classification for dream events.
 *   recalibrate = highest  (confidence changes need immediate attention)
 *   alert       = highest  (anomaly or risk detected)
 *   hypothesize = medium-high (new hypothesis ready for pursuit)
 *   consolidate = medium   (structural cleanup complete)
 */
export type DreamPriority = "recalibrate" | "alert" | "hypothesize" | "consolidate";

// ─── Dream Event (FR-L5-32) ────────────────────────────────────────────────────
/**
 * DreamEvent extends the base AutonomousEvent concept with dream-specific fields.
 * Published to dream_event_queue after each cycle and on session completion.
 */
export interface DreamEvent {
  /** Always "dream_state" — identifies the producer (FR-L5-32) */
  source: "dream_state";
  /** Priority classification for queue ordering (FR-L5-36) */
  dreamPriority: DreamPriority;
  /** Which dream cycle produced this event (1-5) (FR-L5-32) */
  cycleNumber: 1 | 2 | 3 | 4 | 5;
  /** Strength of evidence supporting this event (0.0-1.0) (FR-L5-32) */
  evidenceStrength: number;
  /** Whether this event should auto-trigger downstream actions (FR-L5-33) */
  autoTrigger: boolean;
  /** Downstream layers weight dream findings at 1.5x (FR-L5-37) */
  dreamOrigin: true;
  /** Session that produced this event */
  sessionId: number;
  /** Structured payload describing what was found */
  payload: Record<string, unknown>;
  /** ISO timestamp when this event was created */
  createdAt: Date;
}

// ─── Per-Cycle Budget (FR-L5-07) ──────────────────────────────────────────────
/**
 * Budget allocated to a single dream cycle.
 * Computed as: remaining_budget_ms / remaining_cycles
 */
export interface CycleBudget {
  /** Maximum milliseconds this cycle is allowed to run */
  budgetMs: number;
  /** Which cycle number this budget is for (1-5) */
  cycleNumber: 1 | 2 | 3 | 4 | 5;
  /** Timestamp when this cycle started */
  startedAt: number;
}

// ─── Proposed Graph Mutation (FR-L5-13) ───────────────────────────────────────
/**
 * Staged mutation from C1 Graph Consolidation.
 * Never applied directly — requires autoApply: true or admin approval (FR-L5-13).
 */
export interface ProposedGraphMutation {
  /** Type of mutation being proposed */
  type: "delete_orphan_entity" | "collapse_duplicate_edge" | "merge_entity";
  /** ID of the entity or edge being mutated */
  targetId: number;
  /** Human-readable reason for the proposed mutation */
  reason: string;
  /** Whether this mutation can be auto-applied without admin review */
  autoApply: boolean;
  /** Session that proposed this mutation */
  sessionId: number;
  /** Cycle number that proposed this mutation (always 1 for C1) */
  cycleNumber: 1;
}

// ─── LLM Circuit Breaker State (NFR-L5-03) ────────────────────────────────────
/**
 * Tracks consecutive LLM failures across C4 and C5.
 * After 3 consecutive failures, C4 and C5 are skipped for the session.
 */
export interface DreamLLMCircuitState {
  consecutiveFailures: number;
  isOpen: boolean;
  openedAt: Date | null;
}

// ─── Confidence History Entry (FR-L5-26) ──────────────────────────────────────
/**
 * Written by C4 ConfidenceRecalibrator to confidence_history.
 * Never directly updates claims.confidence.
 */
export interface ConfidenceHistoryEntry {
  claimId: number;
  sessionId: number;
  oldConfidence: number;
  newConfidence: number;
  /** Which rule triggered the change (R1-R4) */
  ruleTriggered: "R1" | "R2" | "R3" | "R4";
  /** Evidence supporting the change */
  evidence: string;
  createdAt: Date;
}

// ─── Dream Session Report (FR-L5-39) ──────────────────────────────────────────
export interface DreamSessionReport {
  sessionId: number;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  cyclesCompleted: number;
  eligibilitySnapshot: {
    eligible: boolean;
    reason: string;
    pendingEventCount: number;
    lastSessionAt: Date | null;
    systemHealth: number;
  };
  perCycleReports: {
    cycle: number;
    name: string;
    durationMs: number;
    result: Record<string, unknown>;
    skipped: boolean;
    skipReason?: string;
  }[];
  eventsPublished: DreamEvent[];
  aggregateRiskLevel: "low" | "medium" | "high";
  recommendedFollowUpActions: string[];
}
