/**
 * directivePublisher.ts — L2 Frontier Directive Publisher
 *
 * Implements FR-L2-24 through FR-L2-28 from build2_decision.docx:
 *   FR-L2-24: L2 shall generate FrontierDirective objects as first-class outputs
 *   FR-L2-25: Directives shall support four directive types
 *   FR-L2-26: Each directive shall include a confidence score (0-1)
 *   FR-L2-27: Each directive shall include a TTL (ttlMinutes, default 60, max 1440)
 *   FR-L2-28: Directives shall be published as events on the event bus
 *
 * Authority boundary: This module writes to frontier_directives and publishes
 * events. It never writes to the knowledge graph tables.
 */

import { randomUUID } from "crypto";
import { getDb } from "../db";
import { frontierDirectives } from "../../drizzle/schema";
import { publishEvent } from "../autonomousLoop/eventBus";
import { logger, errData } from "../logger";
import { CTCDecisionMemory } from "../ctcDecisionMemory";

const log = logger("selfPrompt/directivePublisher");
// MRAgent CTC decision memory — singleton, non-blocking
const ctcDecision = new CTCDecisionMemory();

// ─── Types ────────────────────────────────────────────────────────────────────

export type FrontierDirectiveType =
  | "focus_gap"
  | "skip_mapping"
  | "prioritize_hypotheses"
  | "deep_dive_entity";

export interface FrontierDirectiveRequest {
  directiveType: FrontierDirectiveType;
  /** Required for focus_gap and prioritize_hypotheses */
  targetGapId?: number;
  /** Required for deep_dive_entity */
  targetEntityId?: number;
  /** Human-readable reason for the directive (min 20 chars) */
  reason: string;
  /** Confidence score 0-1 (FR-L2-26) */
  confidence: number;
  /** TTL in minutes, default 60, max 1440 (FR-L2-27) */
  ttlMinutes?: number;
  /** The self_prompt_log cycle ID that issued this directive */
  issuedByCycleId?: number;
}

export interface FrontierDirectiveResult {
  directiveId: string;
  directiveType: FrontierDirectiveType;
  targetGapId?: number;
  targetEntityId?: number;
  reason: string;
  confidence: number;
  ttlMinutes: number;
  expiresAt: Date;
  issuedByCycleId?: number;
  dbRowId?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MINUTES = 60;
const MAX_TTL_MINUTES = 1440; // 24 hours

// ─── Validation ───────────────────────────────────────────────────────────────

function validateDirectiveRequest(req: FrontierDirectiveRequest): void {
  if (req.confidence < 0 || req.confidence > 1) {
    throw new Error(
      `FR-L2-26: confidence must be in [0, 1], got ${req.confidence}`
    );
  }
  if (req.reason.length < 20) {
    throw new Error(
      `FR-L2-15: reason must be at least 20 chars, got ${req.reason.length}`
    );
  }
  if (req.directiveType === "focus_gap" && !req.targetGapId) {
    throw new Error("focus_gap directive requires targetGapId");
  }
  if (req.directiveType === "deep_dive_entity" && !req.targetEntityId) {
    throw new Error("deep_dive_entity directive requires targetEntityId");
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Publish a frontier directive from L2 to L3.
 * Writes to frontier_directives table and publishes FRONTIER_DIRECTIVE_ISSUED event.
 */
export async function publishFrontierDirective(
  req: FrontierDirectiveRequest
): Promise<FrontierDirectiveResult> {
  validateDirectiveRequest(req);

  const directiveId = randomUUID();
  const ttlMinutes = Math.min(
    req.ttlMinutes ?? DEFAULT_TTL_MINUTES,
    MAX_TTL_MINUTES
  );
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  // Persist to DB
  let dbRowId: number | undefined;
  try {
    const db = await getDb();
    if (db) {
      const insertResult = await db.insert(frontierDirectives).values({
        directiveId,
        triggerReason: mapDirectiveTypeToTriggerReason(req.directiveType),
        priority: Math.round(req.confidence * 10), // map 0-1 confidence to 0-10 priority
        targetGapIds: req.targetGapId ? [String(req.targetGapId)] : [],
        maxIterations: 10,
        evidenceStrengthThreshold: req.confidence,
        confidence: req.confidence,
        ttlMinutes,
        expiresAt,
        status: "pending",
      });
      dbRowId = (insertResult as { insertId?: number }).insertId ?? undefined;
    }
  } catch (err) {
    log.warn(
      "[DirectivePublisher] Failed to persist directive to DB:",
      errData(err as Error)
    );
    // Non-fatal: continue with event publication
  }

  // Publish event (FR-L2-28)
  try {
    await publishEvent("convergence_gate_opened", {
      directiveId,
      directiveType: req.directiveType,
      targetGapId: req.targetGapId,
      targetEntityId: req.targetEntityId,
      reason: req.reason,
      confidence: req.confidence,
      expiresAt: expiresAt.toISOString(),
      issuedByCycleId: req.issuedByCycleId,
      ttlMinutes,
    });
  } catch (err) {
    log.warn(
      "[DirectivePublisher] Failed to publish directive event:",
      errData(err as Error)
    );
    // Non-fatal: directive was persisted; event publication is best-effort
  }

  log.info(
    `[DirectivePublisher] Issued directive ${directiveId} type=${req.directiveType} confidence=${req.confidence}`
  );

  const result: FrontierDirectiveResult = {
    directiveId,
    directiveType: req.directiveType,
    targetGapId: req.targetGapId,
    targetEntityId: req.targetEntityId,
    reason: req.reason,
    confidence: req.confidence,
    ttlMinutes,
    expiresAt,
    issuedByCycleId: req.issuedByCycleId,
    dbRowId,
  };

  // MRAgent CTC: ingest directive as episodic decision memory
  void ctcDecision.ingestDirective({
    directive_id: result.directiveId,
    directive_type:
      result.directiveType as import("../ctcDecisionMemory").DirectiveType,
    reason: result.reason,
    confidence: result.confidence,
    target_gap_id: result.targetGapId ?? undefined,
    target_entity_id: result.targetEntityId ?? undefined,
    issued_by_cycle_id:
      result.issuedByCycleId !== undefined
        ? String(result.issuedByCycleId)
        : undefined,
    issued_at: new Date().toISOString(),
    expires_at: result.expiresAt.toISOString(),
    ttl_minutes: result.ttlMinutes,
  });

  return result;
}

/**
 * Publish multiple directives in order.
 */
export async function publishFrontierDirectives(
  requests: FrontierDirectiveRequest[]
): Promise<FrontierDirectiveResult[]> {
  const results: FrontierDirectiveResult[] = [];
  for (const req of requests) {
    try {
      const result = await publishFrontierDirective(req);
      results.push(result);
    } catch (err) {
      log.error(
        `[DirectivePublisher] Failed to publish directive type=${req.directiveType}:`,
        errData(err as Error)
      );
      // Continue with remaining directives
    }
  }
  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapDirectiveTypeToTriggerReason(
  directiveType: FrontierDirectiveType
):
  | "convergence_stalled"
  | "confidence_low"
  | "gap_detected"
  | "scheduled"
  | "manual" {
  switch (directiveType) {
    case "focus_gap":
      return "gap_detected";
    case "skip_mapping":
      return "convergence_stalled";
    case "prioritize_hypotheses":
      return "confidence_low";
    case "deep_dive_entity":
      return "gap_detected";
    default:
      return "manual";
  }
}
