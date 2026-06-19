/**
 * routingTable.ts — Declarative event→layer routing map.
 *
 * PRD-MASTER FR-MASTER-01: All event routing MUST be defined in a single
 * declarative table. No ad-hoc if/else chains in the orchestrator.
 *
 * Each entry maps a LoopEventType to the ordered list of layer IDs that
 * should process it, plus optional metadata (priority, description).
 */

import type { LoopEventType } from "./eventBus";

export interface RouteEntry {
  /** Ordered list of layer IDs to invoke for this event type. */
  layers: string[];
  /** Default queue priority (1 = highest, 5 = lowest). */
  priority: 1 | 2 | 3 | 4 | 5;
  /** Human-readable description for observability. */
  description: string;
}

/**
 * ROUTING_TABLE maps every known LoopEventType to its processing route.
 *
 * Layer IDs correspond to the autonomous loop layers:
 *   L0 = frictionLayer (data ingestion / friction)
 *   L1 = truthLayer
 *   L2 = selfPromptLayer
 *   L3 = frontierLayer
 *   L4 = metaAgentLayer
 *   L5 = dreamLayer
 */
export const ROUTING_TABLE: Record<LoopEventType, RouteEntry> = {
  document_submitted: {
    layers: ["L0", "L1"],
    priority: 2,
    description: "New document submitted — friction check then truth engine",
  },
  paper_discovered: {
    layers: ["L0", "L1"],
    priority: 2,
    description: "Paper discovered — friction check then truth engine",
  },
  source_data_changed: {
    layers: ["L1"],
    priority: 2,
    description: "Source data changed — re-verify affected claims",
  },
  verdict_complete: {
    layers: ["L2"],
    priority: 3,
    description: "Verdict complete — check if self-prompt needed",
  },
  contradiction_found: {
    layers: ["L2", "L3"],
    priority: 2,
    description: "Contradiction found — self-prompt then frontier search",
  },
  gap_closed: {
    layers: ["L2"],
    priority: 3,
    description: "Coverage gap closed — self-prompt recalibration",
  },
  source_status_change: {
    layers: ["L1"],
    priority: 2,
    description: "Source status changed — halt/resume truth engine",
  },
  system_health_change: {
    layers: ["L4"],
    priority: 1,
    description: "System health changed — critical meta-agent alert",
  },
  hypothesis_resolved: {
    layers: ["L2"],
    priority: 3,
    description: "Hypothesis resolved — self-prompt recalibration",
  },
  manual_review_complete: {
    layers: ["L0"],
    priority: 2,
    description: "Manual review complete — re-evaluate through friction",
  },
  scheduled_tick: {
    layers: ["L0", "L4"],
    priority: 4,
    description: "Periodic tick — ingestion check + meta-agent health",
  },
  loop_action_complete: {
    layers: ["L0"],
    priority: 4,
    description: "Loop action complete — state change triggers new event",
  },
  dream_pattern_detected: {
    layers: ["L5", "L4"],
    priority: 5,
    description:
      "Dream pattern detected — dream layer + meta-agent health check",
  },
  confidence_review_needed: {
    layers: ["L2"],
    priority: 3,
    description: "Confidence review needed — self-prompt recalibration",
  },
  dream_session_complete: {
    layers: ["L0"],
    priority: 5,
    description: "Dream session complete — new knowledge available to friction",
  },
  source_version_changed: {
    layers: ["L1"],
    priority: 2,
    description:
      "Source version changed — re-verify claims from changed source",
  },
  coverage_gap: {
    layers: ["L2", "L3"],
    priority: 3,
    description: "Coverage gap detected — self-prompt then frontier search",
  },
  system_capability_required: {
    layers: ["L4"],
    priority: 1,
    description: "System capability required — meta-agent spawns dev task",
  },
  frontier_search_requested: {
    layers: ["L3"],
    priority: 3,
    description: "Frontier search requested",
  },
  frontier_result_received: {
    layers: ["L1", "L2"],
    priority: 3,
    description: "Frontier result received — re-verify then self-prompt",
  },
  dream_hypothesis_generated: {
    layers: ["L5", "L3"],
    priority: 5,
    description: "Dream hypothesis generated — frontier validation",
  },
  dream_cycle_started: {
    layers: ["L5"],
    priority: 5,
    description: "Dream cycle started — low priority background processing",
  },
  code_drift_detected: {
    layers: ["L4"],
    priority: 3,
    description: "Code drift detected — meta-agent alert",
  },
  stub_escalated: {
    layers: ["L4"],
    priority: 3,
    description: "Stub escalated to overdue — meta-agent alert",
  },
  pipeline_invariant_violated: {
    layers: ["L4"],
    priority: 1,
    description: "Pipeline invariant violated — critical meta-agent alert",
  },
  self_prompt_triggered: {
    layers: ["L2"],
    priority: 2,
    description: "Self-prompt cycle triggered",
  },
  authority_violation: {
    layers: ["L4"],
    priority: 1,
    description: "Authority enforcement violation",
  },
  layer_telemetry_recorded: {
    layers: ["L4"],
    priority: 3,
    description: "Layer telemetry recorded",
  },
  pipeline_stage_complete: {
    layers: ["L1"],
    priority: 3,
    description: "Pipeline stage completed",
  },
  convergence_gate_opened: {
    layers: ["L2"],
    priority: 2,
    description: "Convergence gate opened",
  },
  dream_queue_processed: {
    layers: ["L5"],
    priority: 3,
    description: "Dream queue processed",
  },
  l0_scan_completed: {
    layers: ["L0"],
    priority: 5,
    description: "L0 friction scan completed telemetry event",
  },
  l0_scan_failed: {
    layers: ["L0"],
    priority: 5,
    description: "L0 friction scan failed telemetry event",
  },
  frontier_directive: {
    layers: ["L3"],
    priority: 3,
    description: "Build3: L3 Frontier directive from Self-Prompt engine (FR-L3-23)",
  },
};

/**
 * Look up the route for a given event type.
 * Returns undefined if the event type is not in the routing table.
 */
export function getRoute(eventType: LoopEventType): RouteEntry | undefined {
  return ROUTING_TABLE[eventType];
}

/**
 * Get all event types routed through a specific layer.
 */
export function getEventsForLayer(layerId: string): LoopEventType[] {
  return (Object.entries(ROUTING_TABLE) as [LoopEventType, RouteEntry][])
    .filter(([, entry]) => entry.layers.includes(layerId))
    .map(([eventType]) => eventType);
}

/**
 * Validate that all entries in the routing table have at least one layer.
 * Used in tests and startup assertions.
 */
export function validateRoutingTable(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const [eventType, entry] of Object.entries(ROUTING_TABLE)) {
    if (!entry.layers || entry.layers.length === 0) {
      errors.push(`Event type "${eventType}" has no layers defined`);
    }
    if (!entry.description) {
      errors.push(`Event type "${eventType}" has no description`);
    }
  }
  return { valid: errors.length === 0, errors };
}
