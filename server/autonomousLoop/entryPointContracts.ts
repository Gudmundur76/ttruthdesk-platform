/**
 * entryPointContracts.ts — Typed entry-point contracts for each layer.
 *
 * PRD-MASTER Phase 3: Each layer MUST declare its entry-point contract
 * (accepted event types, required context fields, output event types).
 * This enables static validation and runtime enforcement.
 */

import type { LoopEventType } from "./eventBus";

export interface LayerContract {
  /** Layer identifier. */
  layerId: string;
  /** Human-readable layer name. */
  name: string;
  /** Event types this layer accepts as input. */
  acceptedEvents: LoopEventType[];
  /** Event types this layer may emit as output. */
  emittedEvents: LoopEventType[];
  /** Required context fields for this layer to operate. */
  requiredContext: string[];
  /** Whether this layer can run in parallel with others. */
  parallelSafe: boolean;
  /** Maximum execution time in milliseconds. */
  maxDurationMs: number;
}

/** Entry-point contracts for all 6 autonomous loop layers. */
export const LAYER_CONTRACTS: Record<string, LayerContract> = {
  L0: {
    layerId: "L0",
    name: "FrictionLayer",
    acceptedEvents: [
      "document_submitted",
      "paper_discovered",
      "manual_review_complete",
      "scheduled_tick",
      "loop_action_complete",
      "dream_session_complete",
    ],
    emittedEvents: ["document_submitted", "paper_discovered", "loop_action_complete"],
    requiredContext: [],
    parallelSafe: false,
    maxDurationMs: 30_000,
  },
  L1: {
    layerId: "L1",
    name: "TruthLayer",
    acceptedEvents: [
      "document_submitted",
      "paper_discovered",
      "source_data_changed",
      "source_status_change",
      "source_version_changed",
      "frontier_result_received",
    ],
    emittedEvents: ["verdict_complete", "contradiction_found", "coverage_gap"],
    requiredContext: ["documentId"],
    parallelSafe: true,
    maxDurationMs: 120_000,
  },
  L2: {
    layerId: "L2",
    name: "SelfPromptLayer",
    acceptedEvents: [
      "verdict_complete",
      "contradiction_found",
      "gap_closed",
      "hypothesis_resolved",
      "confidence_review_needed",
      "coverage_gap",
    ],
    emittedEvents: [
      "self_prompt_triggered",
      "frontier_search_requested",
      "coverage_gap",
      "gap_closed",
    ],
    requiredContext: [],
    parallelSafe: true,
    maxDurationMs: 60_000,
  },
  L3: {
    layerId: "L3",
    name: "FrontierLayer",
    acceptedEvents: [
      "frontier_search_requested",
      "contradiction_found",
      "coverage_gap",
      "dream_hypothesis_generated",
    ],
    emittedEvents: ["frontier_result_received", "paper_discovered"],
    requiredContext: [],
    parallelSafe: true,
    maxDurationMs: 90_000,
  },
  L4: {
    layerId: "L4",
    name: "MetaAgentLayer",
    acceptedEvents: [
      "system_health_change",
      "scheduled_tick",
      "dream_pattern_detected",
      "system_capability_required",
      "code_drift_detected",
      "stub_escalated",
      "pipeline_invariant_violated",
    ],
    emittedEvents: ["system_health_change", "system_capability_required"],
    requiredContext: [],
    parallelSafe: false,
    maxDurationMs: 60_000,
  },
  L5: {
    layerId: "L5",
    name: "DreamLayer",
    acceptedEvents: ["dream_pattern_detected", "dream_cycle_started"],
    emittedEvents: [
      "dream_hypothesis_generated",
      "dream_session_complete",
      "confidence_review_needed",
    ],
    requiredContext: [],
    parallelSafe: false,
    maxDurationMs: 300_000,
  },
};

/**
 * Get the contract for a specific layer.
 */
export function getLayerContract(layerId: string): LayerContract | undefined {
  return LAYER_CONTRACTS[layerId];
}

/**
 * Check whether a layer accepts a given event type.
 */
export function layerAcceptsEvent(
  layerId: string,
  eventType: LoopEventType
): boolean {
  const contract = LAYER_CONTRACTS[layerId];
  if (!contract) return false;
  return contract.acceptedEvents.includes(eventType);
}

/**
 * Validate that all layers in the routing table have contracts defined.
 */
export function validateLayerContracts(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const knownLayers = new Set(Object.keys(LAYER_CONTRACTS));
  for (const [layerId, contract] of Object.entries(LAYER_CONTRACTS)) {
    if (contract.acceptedEvents.length === 0) {
      errors.push(`Layer ${layerId} accepts no events`);
    }
    if (contract.maxDurationMs <= 0) {
      errors.push(`Layer ${layerId} has invalid maxDurationMs`);
    }
    if (!knownLayers.has(layerId)) {
      errors.push(`Layer ${layerId} is not in the known layers set`);
    }
  }
  return { valid: errors.length === 0, errors };
}
