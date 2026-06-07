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
 */

import type { LoopEvent } from "../eventBus";
import type { LoopAction } from "../loopOrchestrator";
import { runFrontierEngine } from "../../frontier/frontierEngine";
import { handlePaperDiscovered } from "../../frontier/paperDiscoveredHandler";

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

export async function runFrontierLayer(
  event: LoopEvent,
  priorActions: LoopAction[]
): Promise<FrontierLayerResult> {
  const actions: LoopAction[] = [];

  // Only run if this event type warrants it
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
