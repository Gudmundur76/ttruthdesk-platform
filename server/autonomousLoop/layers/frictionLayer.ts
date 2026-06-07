/**
 * frictionLayer.ts — L0: Friction Gate
 *
 * Evaluates whether an event has a verifiable payload and is worth processing.
 * Returns shouldProcess=false for events with no actionable content.
 */

import type { LoopEvent } from "../eventBus";
import type { LoopAction } from "../loopOrchestrator";

export interface FrictionLayerResult {
  shouldProcess: boolean;
  reason?: string;
  actions: LoopAction[];
}

export async function runFrictionGate(event: LoopEvent): Promise<FrictionLayerResult> {
  const actions: LoopAction[] = [];

  // Check for empty payload
  if (!event.payload || Object.keys(event.payload).length === 0) {
    return { shouldProcess: false, reason: "empty_payload", actions };
  }

  // Event-specific payload validation
  switch (event.eventType) {
    case "document_submitted": {
      // Accept either a persisted documentId OR a Hostinger-sourced claimText
      const hasDocId = !!event.payload.documentId;
      const hasClaimText = typeof event.payload.claimText === "string" && (event.payload.claimText as string).length > 5;
      if (!hasDocId && !hasClaimText) {
        return { shouldProcess: false, reason: "missing_document_id", actions };
      }
      actions.push({
        type: "friction_check",
        description: hasDocId
          ? `Document ${event.payload.documentId} passed friction gate`
          : `Hostinger claim "${(event.payload.claimText as string).slice(0, 60)}" passed friction gate`,
        priority: 10,
        result: "success",
      });
      break;
    }

    case "verdict_complete": {
      if (!event.payload.claimId || !event.payload.verdict) {
        return { shouldProcess: false, reason: "missing_claim_id_or_verdict", actions };
      }
      actions.push({
        type: "friction_check",
        description: `Verdict for claim ${event.payload.claimId} passed friction gate`,
        priority: 10,
        result: "success",
      });
      break;
    }

    case "contradiction_found": {
      if (!event.payload.claimId) {
        return { shouldProcess: false, reason: "missing_claim_id", actions };
      }
      actions.push({
        type: "friction_check",
        description: `Contradiction for claim ${event.payload.claimId} passed friction gate`,
        priority: 60,
        result: "success",
      });
      break;
    }

    case "scheduled_tick": {
      // Always process scheduled ticks
      actions.push({
        type: "friction_check",
        description: "Scheduled tick passed friction gate",
        priority: 5,
        result: "success",
      });
      break;
    }

    default: {
      // Default: pass all other events through
      actions.push({
        type: "friction_check",
        description: `Event ${event.eventType} passed friction gate`,
        priority: 5,
        result: "success",
      });
    }
  }

  return { shouldProcess: true, actions };
}
