/**
 * actionExecutor.ts — Executes the prioritized action list from the Self-Prompting Engine.
 *
 * Each action type maps to an existing system capability:
 *   notify     → alertDispatcher.dispatchHighRiskAlert
 *   wiki_update → wikiEngine.updateEntityPage
 *   frontier   → frontierEngine.runFrontierEngine (targeted)
 *   reindex    → indexNow.notifyIndexNow
 *   alert      → notifyOwner
 *   gap_map    → frontierEngine.runFrontierEngine
 *   meta_check → no-op (logged only — codeGuardian runs on its own schedule)
 *
 * Authority boundary: This module calls existing system actions only.
 * It never writes directly to the knowledge graph.
 */

import type { PrioritizedAction } from "./promptEngine";
import { getDb } from "../db";
import { graphEntities, knowledgeGaps, claims } from "../../drizzle/schema";
import { eq, lt, lte, and, isNotNull } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { notifyIndexNow, claimUrl, wikiUrl } from "../seo/indexNow";
import { runFrontierEngine } from "../frontier/frontierEngine";
import { updateEntityPage } from "../wikiEngine";
import { dispatchHighRiskAlert } from "../alertDispatcher";
import { drainCoordQueue } from "../coordQueueDrainer";
import { runConfidenceRecalibration } from "../dream/confidenceRecalibrator";

export interface ActionResult {
  action: string;
  targetId: number;
  status: "ok" | "skipped" | "error";
  detail: string;
}

export async function executeAction(action: PrioritizedAction): Promise<ActionResult> {
  const { action: actionType, targetId, reasoning } = action;

  try {
    switch (actionType) {
      case "notify": {
        // Dispatch a webhook alert for a claim
        if (!targetId) return { action: actionType, targetId, status: "skipped", detail: "No targetId" };
        await dispatchHighRiskAlert({
          claimId: targetId,
          verdict: "Contradicted",
          claimText: reasoning,
          documentId: 0,
          documentTitle: "Self-Prompt Alert",
          contradictionProbability: 0.9,
          confidenceScore: null,
          reportUrl: "",
        });
        return { action: actionType, targetId, status: "ok", detail: `Webhook alert dispatched for claim ${targetId}` };
      }

      case "wiki_update": {
        // Trigger wiki recompilation for an entity
        if (!targetId) return { action: actionType, targetId, status: "skipped", detail: "No targetId" };
        const db = await getDb();
        if (!db) return { action: actionType, targetId, status: "skipped", detail: "DB unavailable" };
        const entity = await db.select().from(graphEntities).where(eq(graphEntities.id, targetId)).limit(1);
        if (!entity[0]) return { action: actionType, targetId, status: "skipped", detail: `Entity ${targetId} not found` };
        await updateEntityPage(
          entity[0].canonicalName.toLowerCase().replace(/\s+/g, "_"),
          entity[0].canonicalName,
          "entity",
          `## ${entity[0].canonicalName}\n\nEntity type: ${entity[0].entityType}. Updated by Self-Prompting Engine.`,
          "structural_biology",
        );
        return { action: actionType, targetId, status: "ok", detail: `Wiki page updated for entity ${targetId} (${entity[0].canonicalName})` };
      }

      case "frontier":
      case "gap_map": {
        // Run the Frontier Engine to detect/pursue gaps
        const result = await runFrontierEngine();
        return {
          action: actionType,
          targetId,
          status: "ok",
          detail: `Frontier Engine run: ${result.gapMapping.newGapsCreated} gaps created, ${result.hypothesisGeneration.hypothesesGenerated} hypotheses generated`,
        };
      }

      case "reindex": {
        // Ping IndexNow for a claim or entity page
        if (!targetId) return { action: actionType, targetId, status: "skipped", detail: "No targetId" };
        const url = claimUrl(targetId);
        await notifyIndexNow(url);
        return { action: actionType, targetId, status: "ok", detail: `IndexNow pinged for ${url}` };
      }

      case "alert": {
        // Send an owner notification about a system health issue
        await notifyOwner({
          title: "Self-Prompt Engine: System Alert",
          content: `Action triggered by Self-Prompting Engine:\n\nTarget: ${targetId}\nReasoning: ${reasoning}`,
        });
        return { action: actionType, targetId, status: "ok", detail: "Owner notification sent" };
      }

      case "meta_check": {
        // Meta-check is logged only — codeGuardian runs on its own schedule
        return { action: actionType, targetId, status: "ok", detail: "Meta-check noted; codeGuardian will run on next scheduled tick" };
      }

      case "drain_queue": {
        // Drain pending coord_queue items through the analysis pipeline
        const drainResult = await drainCoordQueue();
        return {
          action: actionType,
          targetId,
          status: "ok",
          detail: `Coord queue drained: ${drainResult.itemsSucceeded} succeeded, ${drainResult.itemsFailed} failed, ${drainResult.itemsSkipped} skipped`,
        };
      }

      case "reverify_stale": {
        // Find claims with stale PDB evidence (>180 days) and re-queue them
        const db = await getDb();
        if (!db) return { action: actionType, targetId, status: "skipped", detail: "DB unavailable" };
        const staleThreshold = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
        const staleClaims = await db
          .select({ id: claims.id })
          .from(claims)
          .where(and(
            isNotNull(claims.pdbEvidenceCheckedAt),
            lt(claims.pdbEvidenceCheckedAt, staleThreshold)
          ))
          .limit(20);
        if (staleClaims.length === 0) {
          return { action: actionType, targetId, status: "skipped", detail: "No stale claims found" };
        }
        // Reset pdbEvidenceCheckedAt to null so the pipeline re-checks them
        for (const c of staleClaims) {
          await db.update(claims).set({ pdbEvidenceCheckedAt: null }).where(eq(claims.id, c.id));
        }
        return {
          action: actionType,
          targetId,
          status: "ok",
          detail: `${staleClaims.length} stale claims reset for PDB re-verification`,
        };
      }

      case "recalibrate_confidence": {
        // Run confidence recalibration on low-confidence claims
        try {
          const recalResult = await runConfidenceRecalibration(true);
          return {
            action: actionType,
            targetId,
            status: "ok",
            detail: `Confidence recalibration complete: ${recalResult.totalRecalibrated} recalibrated, ${recalResult.autoApplied} auto-applied`,
          };
        } catch (err) {
          return {
            action: actionType,
            targetId,
            status: "error",
            detail: `Recalibration failed: ${String(err)}`,
          };
        }
      }

      case "converge": {
        return { action: actionType, targetId, status: "ok", detail: "Convergence gate fired — no further actions" };
      }

      default: {
        return { action: actionType, targetId, status: "skipped", detail: `Unknown action type: ${actionType}` };
      }
    }
  } catch (err) {
    return {
      action: actionType,
      targetId,
      status: "error",
      detail: `Execution failed: ${String(err)}`,
    };
  }
}

export async function executeActions(actions: PrioritizedAction[]): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions) {
    const result = await executeAction(action);
    results.push(result);
    // Non-fatal: continue even if an action errors
  }
  return results;
}
