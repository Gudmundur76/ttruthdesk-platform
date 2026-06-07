/**
 * truthLayer.ts — L1: Truth Layer
 *
 * Handles events that require re-verification of claims against evidence:
 *   - source_data_changed: re-run affected claims through the pipeline
 *   - source_status_change: halt/resume claims from that source
 *   - document_submitted: trigger analysis pipeline
 *   - paper_discovered: queue for analysis
 */

import type { LoopEvent } from "../eventBus";
import type { LoopAction } from "../loopOrchestrator";

export interface TruthLayerResult {
  actions: LoopAction[];
  verdicts: Array<{ claimId: number; verdict: string }>;
}

export async function runTruthLayer(event: LoopEvent): Promise<TruthLayerResult> {
  const actions: LoopAction[] = [];
  const verdicts: Array<{ claimId: number; verdict: string }> = [];

  switch (event.eventType) {
    case "document_submitted": {
      // The analysis pipeline is already triggered by the submit mutation.
      // Here we just record the action for the loop run log.
      actions.push({
        type: "truth_pipeline_triggered",
        description: `Analysis pipeline triggered for document ${event.payload.documentId}`,
        priority: 80,
        result: "success",
      });
      break;
    }

    case "paper_discovered": {
      // A new paper was found by the Frontier Engine — queue it for analysis
      actions.push({
        type: "truth_paper_queued",
        description: `Paper ${event.payload.paperId ?? event.payload.url} queued for analysis`,
        priority: 60,
        result: "success",
      });
      break;
    }

    case "source_data_changed": {
      // Source data changed — mark affected claims for re-verification
      actions.push({
        type: "truth_source_recheck",
        description: `Source ${event.payload.sourceId} data changed — affected claims flagged for re-verification`,
        priority: 70,
        result: "success",
      });
      break;
    }

    case "source_status_change": {
      const status = event.payload.status as string;
      if (status === "retracted" || status === "offline") {
        actions.push({
          type: "truth_source_halt",
          description: `Source ${event.payload.sourceId} is ${status} — halting dependent claims`,
          priority: 90,
          result: "success",
        });
      } else {
        actions.push({
          type: "truth_source_resume",
          description: `Source ${event.payload.sourceId} is ${status} — resuming dependent claims`,
          priority: 50,
          result: "success",
        });
      }
      break;
    }

    default:
      break;
  }

  return { actions, verdicts };
}
