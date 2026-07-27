/**
 * eventSchemas.ts — Typed event envelope and Zod payload schemas.
 *
 * PRD-MASTER FR-MASTER-03: Every event must carry:
 *   - eventId      UUID v4 (globally unique per event instance)
 *   - correlationId UUID (propagated from parent event through the claim pipeline)
 *   - ttl          epoch ms (default: now + 7 days)
 *   - sourceLayer  which layer or component published this event
 *   - timestamp    ISO 8601 string
 *
 * All payload schemas are Zod-validated. publishEvent() rejects invalid
 * payloads at runtime with SCHEMA_VALIDATION_ERROR.
 *
 * build1_foundation Phase 138
 */
import { z } from "zod";

// ─── Source Layer Enum ────────────────────────────────────────────────────────
export const SourceLayerEnum = z.enum([
  "L0_FRICTION",
  "L1_TRUTH",
  "L2_SELF_PROMPT",
  "L3_FRONTIER",
  "L4_META",
  "L5_DREAM",
  "ORCHESTRATOR",
  "SYSTEM",
  "API",
]);
export type SourceLayer = z.infer<typeof SourceLayerEnum>;

// ─── Typed Event Envelope ─────────────────────────────────────────────────────
/**
 * TypedEventEnvelope — the mandatory metadata wrapper for every event.
 * Consumers receive this alongside the payload.
 */
export interface TypedEventEnvelope {
  /** UUID v4 — globally unique per event instance */
  eventId: string;
  /** UUID — propagated from parent event through the claim pipeline */
  correlationId: string;
  /** Epoch ms — event expires after this time */
  ttl: number;
  /** Which layer or component published this event */
  sourceLayer: SourceLayer;
  /** ISO 8601 timestamp of when the event was published */
  timestamp: string;
}

/** Default TTL: 7 days from now */
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Create a new TypedEventEnvelope with a fresh eventId and current timestamp */
export function createEnvelope(
  sourceLayer: SourceLayer,
  correlationId?: string
): TypedEventEnvelope {
  return {
    eventId: crypto.randomUUID(),
    correlationId: correlationId ?? crypto.randomUUID(),
    ttl: Date.now() + DEFAULT_TTL_MS,
    sourceLayer,
    timestamp: new Date().toISOString(),
  };
}

// ─── Payload Schemas ──────────────────────────────────────────────────────────
// One Zod schema per LoopEventType. These are validated on every publishEvent() call.

export const DocumentSubmittedPayload = z.object({
  documentId: z.number().int().positive(),
  userId: z.number().int().positive().optional(),
  verticalDomain: z.string().optional(),
});

export const PaperDiscoveredPayload = z.object({
  pmid: z.string().optional(),
  doi: z.string().optional(),
  title: z.string(),
  source: z
    .enum([
      "pubmed",
      "biorxiv",
      "pdb_linked",
      "crossref",
      "uniprot",
      "pdb",
      "rcsb",
      "chembl",
      "openalex",
      "semantic_scholar",
      "arxiv",
      "europepmc",
      "ncbi",
      "domain-ingest",
      // Internal pipeline sources
      "autonomousIngest",
      "copilot_pubmed",
      "copilot_uniprot",
      "copilot_query",
      "dream_session",
      "dream_state",
      "dream_staging_approved",
      "frontier_hypothesis",
      "self_prompt_cron",
      "cron",
    ])
    .optional(),
  autoIngestedPaperId: z.number().int().positive().optional(),
});

export const SourceDataChangedPayload = z.object({
  sourceId: z.string().or(z.number()),
  changeType: z.enum(["retracted", "updated", "new_version"]).optional(),
  affectedClaimIds: z.array(z.number().int().positive()).optional(),
});

export const VerdictCompletePayload = z.object({
  claimId: z.number().int().positive(),
  documentId: z.number().int().positive(),
  verdict: z.string(),
  confidenceScore: z.number().min(0).max(1).optional(),
});

export const ContradictionFoundPayload = z.object({
  claimId: z.number().int().positive(),
  contradictingSourceId: z.string().or(z.number()).optional(),
  contradictionType: z.string().optional(),
});

export const GapClosedPayload = z.object({
  gapId: z.string(),
  claimId: z.number().int().positive().optional(),
  resolvedBy: z.string().optional(),
});

export const SourceStatusChangePayload = z.object({
  sourceId: z.string().or(z.number()),
  newStatus: z.enum(["active", "retracted", "unavailable", "updated"]),
});

export const SystemHealthChangePayload = z.object({
  component: z.string(),
  previousStatus: z.string().optional(),
  newStatus: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const HypothesisResolvedPayload = z.object({
  hypothesisId: z.string().or(z.number()),
  resolution: z.enum(["confirmed", "rejected", "inconclusive"]),
  evidenceStrength: z.number().min(0).max(1).optional(),
});

export const ManualReviewCompletePayload = z.object({
  claimId: z.number().int().positive(),
  reviewerId: z.number().int().positive(),
  verdict: z.string(),
  notes: z.string().optional(),
});

export const ScheduledTickPayload = z.object({
  tickType: z.string().optional(),
  scheduledAt: z.string().optional(),
});

export const LoopActionCompletePayload = z.object({
  actionType: z.string(),
  result: z.string().optional(),
  affectedEntityId: z.number().int().positive().optional(),
});

export const DreamPatternDetectedPayload = z.object({
  patternType: z.string(),
  strength: z.number().min(0).max(1).optional(),
  relatedClaimIds: z.array(z.number().int().positive()).optional(),
});

export const ConfidenceReviewNeededPayload = z.object({
  claimId: z.number().int().positive(),
  currentConfidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});

export const DreamSessionCompletePayload = z.object({
  sessionId: z.string().or(z.number()),
  hypothesesGenerated: z.number().int().nonnegative().optional(),
  hypothesesPromoted: z.number().int().nonnegative().optional(),
});

export const SourceVersionChangedPayload = z.object({
  sourceId: z.string().or(z.number()),
  previousVersion: z.string().optional(),
  newVersion: z.string(),
});

export const CoverageGapPayload = z.object({
  gapId: z.string(),
  gapType: z.string().optional(),
  priority: z.number().int().min(1).max(10).optional(),
});

export const SystemCapabilityRequiredPayload = z.object({
  capability: z.string(),
  requestedBy: z.string().optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).optional(),
});

// ─── New build1_foundation event types ───────────────────────────────────────

export const FrontierDirectivePayload = z.object({
  directiveId: z.string().uuid(),
  triggerReason: z.enum([
    "convergence_stalled",
    "confidence_low",
    "gap_detected",
    "scheduled",
    "manual",
  ]),
  priority: z.number().int().min(1).max(10).default(5),
  targetGapIds: z.array(z.string()),
  maxIterations: z.number().int().positive().default(10),
  evidenceStrengthThreshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.6 as number),
});

export const FrontierCompletePayload = z.object({
  directiveId: z.string().uuid(),
  frontierSessionId: z.number().int().positive().optional(),
  iterationsUsed: z.number().int().nonnegative(),
  reason: z.enum(["complete", "max_iterations_reached", "cancelled"]),
  hypothesesGenerated: z.number().int().nonnegative().optional(),
});

export const DreamSessionRequestPayload = z.object({
  requestId: z.string().uuid(),
  evidenceIds: z.array(z.string().or(z.number())),
  minEvidenceStrength: z
    .number()
    .min(0)
    .max(1)
    .default(0.7 as number),
  scheduledFor: z.string().optional(), // ISO 8601
});

export const DreamSessionApprovedPayload = z.object({
  requestId: z.string().uuid(),
  approvedAt: z.string(), // ISO 8601
  filteredEvidenceCount: z.number().int().nonnegative(),
});

export const DreamCompletePayload = z.object({
  requestId: z.string().uuid(),
  sessionId: z.string().or(z.number()),
  hypothesesGenerated: z.number().int().nonnegative(),
  hypothesesPromoted: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
});


export const DreamHypothesisStagedPayload = z.object({
  sessionEventId: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});
// ─── Schema Registry ──────────────────────────────────────────────────────────
// Maps every LoopEventType (including new build1 types) to its Zod schema.
// publishEvent() uses this to validate payloads at runtime.

export type ExtendedLoopEventType =
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
  | "dream_session_complete"
  | "source_version_changed"
  | "coverage_gap"
  | "system_capability_required"
  | "frontier_directive"
  | "frontier_complete"
  | "dream_session_request"
  | "dream_session_approved"
  | "dream_complete"
  | "dream_hypothesis_staged";

export const EVENT_PAYLOAD_SCHEMAS: Record<
  ExtendedLoopEventType,
  z.ZodType<unknown>
> = {
  document_submitted: DocumentSubmittedPayload,
  paper_discovered: PaperDiscoveredPayload,
  source_data_changed: SourceDataChangedPayload,
  verdict_complete: VerdictCompletePayload,
  contradiction_found: ContradictionFoundPayload,
  gap_closed: GapClosedPayload,
  source_status_change: SourceStatusChangePayload,
  system_health_change: SystemHealthChangePayload,
  hypothesis_resolved: HypothesisResolvedPayload,
  manual_review_complete: ManualReviewCompletePayload,
  scheduled_tick: ScheduledTickPayload,
  loop_action_complete: LoopActionCompletePayload,
  dream_pattern_detected: DreamPatternDetectedPayload,
  confidence_review_needed: ConfidenceReviewNeededPayload,
  dream_session_complete: DreamSessionCompletePayload,
  source_version_changed: SourceVersionChangedPayload,
  coverage_gap: CoverageGapPayload,
  system_capability_required: SystemCapabilityRequiredPayload,
  frontier_directive: FrontierDirectivePayload,
  frontier_complete: FrontierCompletePayload,
  dream_session_request: DreamSessionRequestPayload,
  dream_session_approved: DreamSessionApprovedPayload,
  dream_complete: DreamCompletePayload,
  dream_hypothesis_staged: DreamHypothesisStagedPayload,
};

/**
 * Validate an event payload against its registered Zod schema.
 * Throws with code SCHEMA_VALIDATION_ERROR if validation fails.
 */
export function validateEventPayload(
  eventType: ExtendedLoopEventType,
  payload: Record<string, unknown>
): void {
  const schema = EVENT_PAYLOAD_SCHEMAS[eventType];
  if (!schema) return; // unknown event types pass through (backward compat)
  const result = schema.safeParse(payload);
  if (!result.success) {
    const err = new Error(
      `SCHEMA_VALIDATION_ERROR: invalid payload for event "${eventType}": ${result.error.message}`
    );
    (err as Error & { code: string }).code = "SCHEMA_VALIDATION_ERROR";
    throw err;
  }
}
