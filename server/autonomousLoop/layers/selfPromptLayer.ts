/**
 * selfPromptLayer.ts — L2: Self-Prompt Layer
 *
 * Interprets the meaning of events and decides what to do next.
 * Fires the existing Self-Prompting Engine for verdict_complete,
 * contradiction_found, gap_closed, and hypothesis_resolved events.
 */

import type { LoopEvent } from "../eventBus";
import type { LoopAction } from "../loopOrchestrator";
import { runSelfPromptCycle } from "../../selfPrompt/engine";
import type { SelfPromptEvent } from "../../selfPrompt/stateCollector";

export interface SelfPromptLayerResult {
  actions: LoopAction[];
}

export async function runSelfPromptLayer(event: LoopEvent): Promise<SelfPromptLayerResult> {
  const actions: LoopAction[] = [];

  try {
    const triggerType: SelfPromptEvent["type"] =
      event.eventType === "verdict_complete"
        ? "verdict_assigned"
        : event.eventType === "contradiction_found"
          ? "contradiction_found"
          : event.eventType === "gap_closed"
            ? "gap_closed"
            : event.eventType === "document_submitted"
              ? "user_submitted"
              : event.eventType === "scheduled_tick"
                ? "scheduled_tick"
                : "verdict_assigned";

    const selfPromptEvent: SelfPromptEvent = {
      type: triggerType,
      description: `Autonomous loop event: ${event.eventType} (id=${event.id})`,
      documentId: event.payload.documentId as number | undefined,
      claimId: event.payload.claimId as number | undefined,
    };

    const result = await runSelfPromptCycle(selfPromptEvent);

    actions.push({
      type: "self_prompt_cycle",
      description: `Self-prompt cycle completed: ${result.actionsExecuted} actions, converged=${result.converged}`,
      priority: 40,
      result: "success",
    });
  } catch (err) {
    actions.push({
      type: "self_prompt_cycle",
      description: `Self-prompt cycle failed: ${err instanceof Error ? err.message : String(err)}`,
      priority: 40,
      result: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { actions };
}
