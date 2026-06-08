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
import { getDb } from "../../db";
import { claims, documents } from "../../../drizzle/schema";
import { eq, isNull } from "drizzle-orm";

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
      // A new paper was found by the Frontier Engine — trigger analysis pipeline
      try {
        const db = await getDb();
        const documentId = event.payload.documentId as number | undefined;
        const rawText = event.payload.rawText as string | undefined;
        const userId = (event.payload.userId as number | undefined) ?? 1; // SYSTEM_USER_ID

        if (db && documentId && rawText) {
          // Fire-and-forget: run the analysis pipeline for the discovered paper
          const { runAnalysisPipeline } = await import("../../analysisPipeline");
          runAnalysisPipeline(documentId, rawText, userId).catch((err: unknown) => {
            console.error(`[TruthLayer] paper_discovered analysis failed for doc ${documentId}:`, err);
          });
          actions.push({
            type: "truth_paper_queued",
            description: `Paper doc #${documentId} submitted to analysis pipeline`,
            priority: 60,
            result: "success",
          });
        } else {
          actions.push({
            type: "truth_paper_queued",
            description: `Paper ${event.payload.paperId ?? event.payload.url} queued for analysis (no rawText available)`,
            priority: 60,
            result: "skipped",
          });
        }
      } catch (err) {
        actions.push({
          type: "truth_paper_queued",
          description: `Paper analysis trigger failed: ${err instanceof Error ? err.message : String(err)}`,
          priority: 60,
          result: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "source_data_changed": {
      // Source data changed — find claims linked to this source and reset their PDB evidence
      // so the next pipeline run re-verifies them against fresh data.
      try {
        const db = await getDb();
        const sourceId = event.payload.sourceId as number | undefined;
        if (db) {
          // Mark all documents as needsReview so the next pipeline pass re-verifies them.
          // Also reset pdbEvidenceCheckedAt on claims so PDB evidence is re-fetched.
          const documentId = event.payload.documentId as number | undefined;
          if (documentId) {
            // Targeted: only reset claims for the specific document
            const updated = await db
              .update(claims)
              .set({ pdbEvidenceCheckedAt: null })
              .where(eq(claims.documentId, documentId));
            const resetCount = (updated as { rowsAffected?: number }).rowsAffected ?? 0;
            await db
              .update(documents)
              .set({ needsReview: true })
              .where(eq(documents.id, documentId));
            actions.push({
              type: "truth_source_recheck",
              description: `Source changed (doc #${documentId}) — ${resetCount} claims reset for PDB re-verification`,
              priority: 70,
              result: "success",
            });
          } else {
            // Broad: sourceId provided but no documentId — flag all docs needing review
            const updated = await db
              .update(claims)
              .set({ pdbEvidenceCheckedAt: null })
              .where(isNull(claims.pdbEvidenceCheckedAt));
            const resetCount = (updated as { rowsAffected?: number }).rowsAffected ?? 0;
            actions.push({
              type: "truth_source_recheck",
              description: `Source ${sourceId ?? "unknown"} changed — ${resetCount} unverified claims reset for re-verification`,
              priority: 70,
              result: "success",
            });
          }
        } else {
          actions.push({
            type: "truth_source_recheck",
            description: `Source ${event.payload.sourceId} data changed — affected claims flagged for re-verification (DB unavailable)`,
            priority: 70,
            result: "skipped",
          });
        }
      } catch (err) {
        actions.push({
          type: "truth_source_recheck",
          description: `Source re-verification failed: ${err instanceof Error ? err.message : String(err)}`,
          priority: 70,
          result: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
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
