/**
 * frontierLayer.ts — L3: Frontier Layer
 *
 * Decides whether to run the Frontier Engine based on the event type
 * and the actions already taken in L0-L2.
 *
 * The Frontier Engine runs when:
 *   - A verdict_complete event fires (especially Insufficient Evidence)
 *   - A gap_closed event fires (may reveal new gaps)
 *   - A scheduled_tick fires
 *
 * Additionally handles frontier_directive events by storing them in the
 * DirectiveStore for consumption at the next cycle start (FR-L3-23).
 */

import type { LoopEvent } from "../eventBus";
import type { LoopAction } from "../loopOrchestrator";
import { runFrontierEngine } from "../../frontier/frontierEngine";
import { handlePaperDiscovered } from "../../frontier/paperDiscoveredHandler";
import { directiveStore, type FrontierDirective } from "../../frontier/directiveStore";
import { logger } from "../../logger";

const log = logger("frontier/frontierLayer");

export interface FrontierLayerResult {
  ran: boolean;
  actions: LoopAction[];
}

const FRONTIER_TRIGGER_EVENTS = new Set([
  "verdict_complete",
  "gap_closed",
  "hypothesis_resolved",
  "scheduled_tick",
  "paper_discovered",
]);

/**
 * Called when a frontier_directive event is received from the event bus.
 * Stores the directive for application at the next cycle start (FR-L3-23, FR-L3-26).
 */
export function onDirectiveReceived(payload: {
  directiveId: string;
  triggerReason: string;
  priority: number;
  targetGapIds: string[];
  maxIterations: number;
  evidenceStrengthThreshold: number;
}): void {
  // Map the event bus payload to a FrontierDirective.
  // The triggerReason maps to directive types:
  //   gap_detected → focus_gap (if targetGapIds present)
  //   convergence_stalled → skip_mapping
  //   confidence_low → prioritize_hypotheses
  //   scheduled / manual → focus_gap or no-op
  const targetGapId = payload.targetGapIds[0];

  let type: FrontierDirective["type"] = "focus_gap";
  if (payload.triggerReason === "convergence_stalled") {
    type = "skip_mapping";
  } else if (payload.triggerReason === "confidence_low") {
    type = "prioritize_hypotheses";
  } else if (payload.targetGapIds.length > 0) {
    type = "focus_gap";
  }

  const directive: FrontierDirective = {
    directiveId: payload.directiveId,
    type,
    targetGapId,
    ttlSeconds: 3600,
    createdAt: new Date(),
  };

  directiveStore.add(directive);
  log.info("[FrontierLayer] Directive received and stored", {
    directiveId: directive.directiveId,
    type: directive.type,
  });
}

export async function runFrontierLayer(
  event: LoopEvent,
  priorActions: LoopAction[]
): Promise<FrontierLayerResult> {
  const actions: LoopAction[] = [];

  // Handle frontier_directive events — store and return (FR-L3-23)
  if (event.eventType === "frontier_directive") {
    const payload = event.payload as Parameters<typeof onDirectiveReceived>[0];
    onDirectiveReceived(payload);
    actions.push({
      type: "frontier_directive_stored",
      description: `Frontier directive stored: ${payload.directiveId}`,
      priority: 30,
      result: "success",
    });
    return { ran: true, actions };
  }

  // Only run the full engine for trigger events
  if (!FRONTIER_TRIGGER_EVENTS.has(event.eventType)) {
    return { ran: false, actions };
  }

  // Don't run if prior actions already triggered a frontier run
  const alreadyRan = priorActions.some((a) => a.type.startsWith("frontier_"));
  if (alreadyRan) {
    return { ran: false, actions };
  }

  // paper_discovered: generate gap-closing hypotheses from the paper, then
  // also run the full Frontier Engine to pick up any new structural gaps.
  if (event.eventType === "paper_discovered") {
    try {
      const { actions: paperActions } = await handlePaperDiscovered(event);
      actions.push(...paperActions);
    } catch (err) {
      actions.push({
        type: "paper_discovered_hypotheses",
        description: `Paper hypothesis generation failed: ${err instanceof Error ? err.message : String(err)}`,
        priority: 45,
        result: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { ran: true, actions };
  }

  try {
    const result = await runFrontierEngine();
    actions.push({
      type: "frontier_engine_run",
      description: `Frontier Engine: ${result.gapMapping.newGapsCreated} new gaps, ${result.hypothesisGeneration.hypothesesGenerated} hypotheses, ${result.pursuitResults.length} pursuit tasks`,
      priority: 50,
      result: "success",
    });
    return { ran: true, actions };
  } catch (err) {
    actions.push({
      type: "frontier_engine_run",
      description: `Frontier Engine failed: ${err instanceof Error ? err.message : String(err)}`,
      priority: 50,
      result: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return { ran: true, actions };
  }
}
