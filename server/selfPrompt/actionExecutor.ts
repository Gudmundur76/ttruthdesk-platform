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
import { graphEntities, claims } from "../../drizzle/schema";
import { eq, lt, and, isNotNull } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { notifyIndexNow, claimUrl } from "../seo/indexNow";
import { runFrontierEngine } from "../frontier/frontierEngine";
import { updateEntityPage } from "../wikiEngine";
import { dispatchHighRiskAlert } from "../alertDispatcher";
import { drainCoordQueue } from "../coordQueueDrainer";
import { runConfidenceRecalibration } from "../dream/confidenceRecalibrator";
import { logger } from "../logger";

const log = logger("selfPrompt/actionExecutor");

// ─── Constants ────────────────────────────────────────────────────────────────────

/** Maximum number of actions executed per cycle. Actions beyond this cap are skipped. */
const MAX_ACTIONS_PER_CYCLE = 5;

/** Per-action execution timeout in milliseconds. Prevents a single slow action from blocking the cycle. */
const ACTION_TIMEOUT_MS = 30_000;

/** Total execution budget for all actions in a cycle. T047 */
const TOTAL_CYCLE_TIMEOUT_MS = 30_000;

/**
 * SQL injection guard: reject any targetId-derived string that contains
 * SQL keywords or special characters that could be injected into raw queries.
 * Note: Drizzle ORM uses parameterised queries, so this is a defence-in-depth
 * measure for any code paths that interpolate targetId into strings.
 */
const SQL_INJECTION_PATTERN =
  /\b(select|insert|update|delete|drop|alter|create|exec|execute|union|truncate|declare|cast|convert|xp_|sp_)\b|[;'"\\]/i;

export function containsSqlInjection(value: string): boolean {
  return SQL_INJECTION_PATTERN.test(value);
}

/**
 * Wrap a promise with a timeout. Rejects with a descriptive error if the
 * promise does not resolve within `ms` milliseconds.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Action timed out after ${ms}ms: ${label}`)),
        ms
      )
    ),
  ]);
}

export interface ActionResult {
  action: string;
  targetId: number;
  status: "ok" | "skipped" | "error";
  detail: string;
  /** Optional: name of the subsystem that handled this action. T048 */
  delegatedTo?: string;
  /** Execution duration in milliseconds. T048 */
  durationMs?: number;
}

// eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export async function executeAction(
  action: PrioritizedAction
): Promise<ActionResult> {
  const { action: actionType, targetId, reasoning } = action;

  try {
    switch (actionType) {
      case "notify": {
        // Dispatch a webhook alert for a claim
        if (!targetId)
          return {
            action: actionType,
            targetId,
            status: "skipped",
            detail: "No targetId",
          };
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
        return {
          action: actionType,
          targetId,
          status: "ok",
          detail: `Webhook alert dispatched for claim ${targetId}`,
        };
      }

      case "wiki_update": {
        // Trigger wiki recompilation for an entity
        if (!targetId)
          return {
            action: actionType,
            targetId,
            status: "skipped",
            detail: "No targetId",
          };
        const db = await getDb();
        if (!db)
          return {
            action: actionType,
            targetId,
            status: "skipped",
            detail: "DB unavailable",
          };
        const entity = await db
          .select()
          .from(graphEntities)
          .where(eq(graphEntities.id, targetId))
          .limit(1);
        if (!entity[0])
          return {
            action: actionType,
            targetId,
            status: "skipped",
            detail: `Entity ${targetId} not found`,
          };
        await updateEntityPage(
          entity[0].canonicalName.toLowerCase().replace(/\s+/g, "_"),
          entity[0].canonicalName,
          "entity",
          `## ${entity[0].canonicalName}\n\nEntity type: ${entity[0].entityType}. Updated by Self-Prompting Engine.`,
          "structural_biology"
        );
        return {
          action: actionType,
          targetId,
          status: "ok",
          detail: `Wiki page updated for entity ${targetId} (${entity[0].canonicalName})`,
        };
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
        if (!targetId)
          return {
            action: actionType,
            targetId,
            status: "skipped",
            detail: "No targetId",
          };
        const url = claimUrl(targetId);
        await notifyIndexNow(url);
        return {
          action: actionType,
          targetId,
          status: "ok",
          detail: `IndexNow pinged for ${url}`,
        };
      }

      case "alert": {
        // Send an owner notification about a system health issue
        await notifyOwner({
          title: "Self-Prompt Engine: System Alert",
          content: `Action triggered by Self-Prompting Engine:\n\nTarget: ${targetId}\nReasoning: ${reasoning}`,
        });
        return {
          action: actionType,
          targetId,
          status: "ok",
          detail: "Owner notification sent",
        };
      }

      case "meta_check": {
        // Meta-check is logged only — codeGuardian runs on its own schedule
        return {
          action: actionType,
          targetId,
          status: "ok",
          detail:
            "Meta-check noted; codeGuardian will run on next scheduled tick",
        };
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
        if (!db)
          return {
            action: actionType,
            targetId,
            status: "skipped",
            detail: "DB unavailable",
          };
        const staleThreshold = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
        const staleClaims = await db
          .select({ id: claims.id })
          .from(claims)
          .where(
            and(
              isNotNull(claims.pdbEvidenceCheckedAt),
              lt(claims.pdbEvidenceCheckedAt, staleThreshold)
            )
          )
          .limit(20);
        if (staleClaims.length === 0) {
          return {
            action: actionType,
            targetId,
            status: "skipped",
            detail: "No stale claims found",
          };
        }
        // Reset pdbEvidenceCheckedAt to null so the pipeline re-checks them
        for (const c of staleClaims) {
          await db
            .update(claims)
            .set({ pdbEvidenceCheckedAt: null })
            .where(eq(claims.id, c.id));
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
        return {
          action: actionType,
          targetId,
          status: "ok",
          detail: "Convergence gate fired — no further actions",
        };
      }

      default: {
        return {
          action: actionType,
          targetId,
          status: "skipped",
          detail: `Unknown action type: ${actionType}`,
        };
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

export async function executeActions(
  actions: PrioritizedAction[]
): Promise<ActionResult[]> {
  // 1. Sort by priority descending (highest first) — promptEngine already sorts,
  //    but we re-sort here as a defensive measure in case callers bypass promptEngine.
  const sorted = [...actions].sort((a, b) => b.priority - a.priority);

  // 2. Deduplicate: keep only the highest-priority action per action type.
  //    This prevents the LLM from queuing the same action type multiple times.
  const seen = new Set<string>();
  const deduped: PrioritizedAction[] = [];
  for (const action of sorted) {
    if (!seen.has(action.action)) {
      seen.add(action.action);
      deduped.push(action);
    } else {
      log.warn(
        `[ActionExecutor] Duplicate action type '${action.action}' (targetId=${action.targetId}) skipped — already queued.`
      );
    }
  }

  // 3. Cap at MAX_ACTIONS_PER_CYCLE
  const capped = deduped.slice(0, MAX_ACTIONS_PER_CYCLE);
  if (deduped.length > MAX_ACTIONS_PER_CYCLE) {
    log.warn(
      `[ActionExecutor] ${deduped.length - MAX_ACTIONS_PER_CYCLE} action(s) beyond the ${MAX_ACTIONS_PER_CYCLE}-action cap were dropped.`
    );
  }

  // 4. Execute sequentially with per-action timeout and total cycle budget (T047/T048)
  const results: ActionResult[] = [];
  const cycleStart = Date.now();
  for (const action of capped) {
    const elapsed = Date.now() - cycleStart;
    const remaining = TOTAL_CYCLE_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      log.warn(
        `[ActionExecutor] Total cycle timeout (${TOTAL_CYCLE_TIMEOUT_MS}ms) reached — skipping remaining ${capped.length - results.length} action(s).`
      );
      // Mark remaining actions as skipped
      for (const skipped of capped.slice(results.length)) {
        results.push({
          action: skipped.action,
          targetId: skipped.targetId,
          status: "skipped",
          detail: "Skipped: total cycle timeout reached",
          durationMs: 0,
        });
      }
      break;
    }
    const actionStart = Date.now();
    const perActionMs = Math.min(ACTION_TIMEOUT_MS, remaining);
    const result = await withTimeout(
      executeAction(action),
      perActionMs,
      `${action.action}(targetId=${action.targetId})`
    ).catch((err: unknown) => ({
      action: action.action,
      targetId: action.targetId,
      status: "error" as const,
      detail: `Timeout or unexpected error: ${String(err)}`,
    }));
    const actionDurationMs = Date.now() - actionStart;
    results.push({
      ...result,
      durationMs: actionDurationMs,
      delegatedTo: getDelegatedTo(action.action),
    });
    // Non-fatal: continue even if an action errors
  }
  return results;
}

/** Map action types to their delegated subsystem name. T048 */
function getDelegatedTo(actionType: string): string {
  const map: Record<string, string> = {
    notify: "alertDispatcher",
    wiki_update: "wikiEngine",
    frontier: "frontierEngine",
    gap_map: "frontierEngine",
    reindex: "indexNow",
    alert: "notificationService",
    meta_check: "codeGuardian",
    drain_queue: "coordQueueDrainer",
    reverify_stale: "pipelineQueue",
    recalibrate_confidence: "confidenceRecalibrator",
    converge: "selfPromptEngine",
  };
  return map[actionType] ?? "unknown";
}
