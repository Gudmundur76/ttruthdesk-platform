/**
 * authorityEnforcer.ts — Runtime authority enforcement.
 *
 * PRD-MASTER FR-MASTER-02: The orchestrator MUST enforce authority boundaries
 * at runtime. A layer may only emit events that its contract declares as
 * emittedEvents. Violations are logged to layer_telemetry and rejected.
 */

import { getDb } from "../db";
import { layerTelemetry } from "../../drizzle/schema";
import { LAYER_CONTRACTS } from "./entryPointContracts";
import type { LoopEventType } from "./eventBus";
import { LayerError } from "./layerError";

export interface AuthorityViolation {
  layerId: string;
  attemptedEvent: LoopEventType;
  reason: string;
  timestamp: number;
}

/**
 * Check whether a layer is authorised to emit a given event type.
 * Returns null if authorised, or an AuthorityViolation if not.
 */
export function checkEmitAuthority(
  layerId: string,
  eventType: LoopEventType
): AuthorityViolation | null {
  const contract = LAYER_CONTRACTS[layerId];
  if (!contract) {
    return {
      layerId,
      attemptedEvent: eventType,
      reason: `Layer "${layerId}" has no registered contract`,
      timestamp: Date.now(),
    };
  }
  if (!contract.emittedEvents.includes(eventType)) {
    return {
      layerId,
      attemptedEvent: eventType,
      reason: `Layer "${layerId}" is not authorised to emit "${eventType}"`,
      timestamp: Date.now(),
    };
  }
  return null;
}

/**
 * Enforce emit authority and throw a LayerError if violated.
 * Also persists the violation to layer_telemetry for observability.
 */
export async function enforceEmitAuthority(
  layerId: string,
  eventType: LoopEventType,
  correlationId?: string
): Promise<void> {
  const violation = checkEmitAuthority(layerId, eventType);
  if (!violation) return;

  // Persist violation to telemetry
  try {
    const db = await getDb();
    if (db) {
      await db.insert(layerTelemetry).values({
        layer: (layerId as "L0_FRICTION" | "L1_TRUTH" | "L2_SELF_PROMPT" | "L3_FRONTIER" | "L4_META" | "L5_DREAM" | "ORCHESTRATOR"),
        correlationId: correlationId ?? null,
        eventType: "error",
        durationMs: 0,
        success: false,
        errorCode: "AUTHORITY_VIOLATION",
        metadataJson: violation as unknown as Record<string, unknown>,
      });
    }
  } catch {
    // Telemetry failure must not mask the authority violation
  }

  throw new LayerError(violation.reason, {
    severity: "fatal",
    context: {
      layerId,
      eventType,
      correlationId,
    },
  });
}

/**
 * Check whether a layer is authorised to receive a given event type.
 */
export function checkReceiveAuthority(
  layerId: string,
  eventType: LoopEventType
): AuthorityViolation | null {
  const contract = LAYER_CONTRACTS[layerId];
  if (!contract) {
    return {
      layerId,
      attemptedEvent: eventType,
      reason: `Layer "${layerId}" has no registered contract`,
      timestamp: Date.now(),
    };
  }
  if (!contract.acceptedEvents.includes(eventType)) {
    return {
      layerId,
      attemptedEvent: eventType,
      reason: `Layer "${layerId}" does not accept event type "${eventType}"`,
      timestamp: Date.now(),
    };
  }
  return null;
}

/**
 * Get all authority violations for a given set of layer→event pairs.
 * Used for batch pre-flight checks before dispatching events.
 */
export function batchCheckAuthority(
  pairs: Array<{ layerId: string; eventType: LoopEventType; direction: "emit" | "receive" }>
): AuthorityViolation[] {
  const violations: AuthorityViolation[] = [];
  for (const { layerId, eventType, direction } of pairs) {
    const violation =
      direction === "emit"
        ? checkEmitAuthority(layerId, eventType)
        : checkReceiveAuthority(layerId, eventType);
    if (violation) violations.push(violation);
  }
  return violations;
}
