/**
 * engine.ts — Self-Prompting Engine orchestrator.
 *
 * The binding agent between FrictionEngine (Layer 1) and the Frontier Engine (Layer 2).
 * Implements the State → Prompt → Action cycle from the paper:
 *
 *   1. Receive a triggering event
 *   2. Collect the current SystemState from the DB
 *   3. Run the LLM self-prompt to generate a prioritized action list
 *   4. Apply the convergence gate (applyConvergenceGate — may override LLM decision)
 *   5. Execute actions that pass the gate
 *   6. Publish frontier directives for any "frontier" actions
 *   7. Log the full cycle to self_prompt_log
 *
 * Authority boundary:
 *   - Reads from: all tables (via stateCollector)
 *   - Writes to: self_prompt_log only (directly)
 *   - Delegates writes to: existing system modules (wikiEngine, alertDispatcher, etc.)
 *   - NEVER writes to: knowledge graph tables (graph_entities, graph_relations, claims)
 */

import { collectSystemState, type SelfPromptEvent } from "./stateCollector";
import { runSelfPrompt } from "./promptEngine";
import { executeActions } from "./actionExecutor";
import { applyConvergenceGate } from "./convergenceGate";
import {
  publishFrontierDirectives,
  type FrontierDirectiveRequest,
} from "./directivePublisher";
import { getDb } from "../db";
import { selfPromptLog, layerTelemetry } from "../../drizzle/schema";
import { logger, errData } from "../logger";
import { randomUUID } from "crypto";
const log = logger("selfPrompt/engine");

// ─── Telemetry Helper ───────────────────────────────────────────────────────────────

/** Emit a telemetry row to layer_telemetry. Non-fatal — never throws. T052 */
async function emitTelemetry(
  eventType: "start" | "end" | "error",
  correlationId: string,
  opts?: {
    durationMs?: number;
    success?: boolean;
    errorCode?: string;
    meta?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(layerTelemetry).values({
      layer: "L2_SELF_PROMPT",
      eventType,
      correlationId,
      durationMs: opts?.durationMs,
      success: opts?.success ?? true,
      errorCode: opts?.errorCode,
      metadataJson: opts?.meta,
    });
  } catch {
    // Telemetry is non-fatal — never throw
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SelfPromptCycleResult {
  cycleId: number | null;
  eventType: string;
  reasoning: string;
  actionsGenerated: number;
  actionsExecuted: number;
  converged: boolean;
  /** Whether the convergence gate overrode the LLM’s decision */
  gateOverrode: boolean;
  /** Human-readable reason from the convergence gate */
  gateReason: string;
  /** Number of frontier directives published this cycle */
  directivesPublished: number;
  durationMs: number;
  /** Set if the cycle failed with an unrecoverable error */
  error?: string;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

// eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export async function runSelfPromptCycle(
  event: SelfPromptEvent,
  cycleCount = 0
): Promise<SelfPromptCycleResult> {
  const startMs = Date.now();
  const correlationId = randomUUID();

  // T052: Emit telemetry at cycle start
  void emitTelemetry("start", correlationId, {
    meta: { eventType: event.type, cycleCount },
  });

  // ─── Global error boundary ───────────────────────────────────────────────────────────────────────────────────
  // Any unhandled throw inside the cycle is caught here so the caller always
  // receives a structured result rather than an unhandled rejection.
  try {
    // 1. Collect system state
    const state = await collectSystemState(event);

    // 2. Run LLM self-prompt
    const promptStart = Date.now();
    const selfPrompt = await runSelfPrompt(state);
    const llmResponseMs = selfPrompt.llmResponseMs ?? Date.now() - promptStart;

    // 3. Apply convergence gate — may override the LLM’s convergence decision
    const gateResult = await applyConvergenceGate({
      llmConverged: selfPrompt.converge,
      cycleCount,
      openCriticalAlerts: state.metaHealth.criticalCount,
      staleGapsWithNoDirective: state.graphSnapshot.highPriorityGapCount,
    });

    if (gateResult.overridden) {
      log.info(
        `[SelfPromptEngine] Convergence gate overrode LLM: ${gateResult.reason} ` +
          `(llm=${selfPrompt.converge}, gate=${gateResult.converged})`
      );
    }

    // 4. Execute actions if gate allows
    const actionsToExecute = gateResult.converged ? [] : selfPrompt.actions;
    const execStart = Date.now();
    const executionResults = await executeActions(actionsToExecute);
    const executionMs = Date.now() - execStart;

    // 5. Publish frontier directives for any "frontier" actions that succeeded
    const frontierActions = actionsToExecute.filter(
      a => a.action === "frontier"
    );
    let directivesPublished = 0;
    let cycleId: number | null = null;

    if (frontierActions.length > 0) {
      // We need the cycleId first — attempt to log early so directives can reference it
      try {
        const db = await getDb();
        if (db) {
          const earlyInsert = await db.insert(selfPromptLog).values({
            eventType: event.type,
            stateSnapshot: state as unknown as Record<string, unknown>,
            reasoning: selfPrompt.reasoning,
            actions: selfPrompt.actions as unknown as Array<
              Record<string, unknown>
            >,
            converged: gateResult.converged,
            actionCount: selfPrompt.actions.length,
            executedCount: actionsToExecute.length,
            executionResults: executionResults as unknown as Array<
              Record<string, unknown>
            >,
            durationMs: Date.now() - startMs,
            claimId: event.claimId ?? null,
            documentId: event.documentId ?? null,
            gapId: event.gapId ?? null,
            // T051: New columns (partial — directivesIssued updated after publish)
            llmRawResponse: selfPrompt.llmRawResponse ?? null,
            llmResponseMs: llmResponseMs,
            executionMs: executionMs,
            totalDurationMs: Date.now() - startMs,
          });
          cycleId = (earlyInsert as { insertId?: number }).insertId ?? null;
        }
      } catch (err) {
        log.error(
          "[SelfPromptEngine] Failed to log cycle (pre-directive):",
          errData(err)
        );
      }

      const directiveRequests: FrontierDirectiveRequest[] = frontierActions.map(
        a => ({
          directiveType: "focus_gap" as const,
          targetGapId: a.targetId > 0 ? a.targetId : undefined,
          reason:
            a.justification || a.reasoning || "Self-prompt frontier action",
          confidence: a.expectedValue / 100,
          ttlMinutes: 60,
          issuedByCycleId: cycleId ?? undefined,
        })
      );

      try {
        const published = await publishFrontierDirectives(directiveRequests);
        directivesPublished = published.length;
        log.info(
          `[SelfPromptEngine] Published ${directivesPublished} frontier directive(s)`
        );
      } catch (err) {
        log.error(
          "[SelfPromptEngine] Failed to publish frontier directives:",
          errData(err)
        );
      }
    }

    const durationMs = Date.now() - startMs;

    // T052: Emit telemetry at cycle end
    void emitTelemetry("end", correlationId, {
      durationMs,
      success: true,
      meta: {
        eventType: event.type,
        actionsGenerated: selfPrompt.actions.length,
        actionsExecuted: actionsToExecute.length,
        converged: gateResult.converged,
        directivesPublished,
      },
    });

    // 6. Log the cycle to self_prompt_log (skip if already logged above)
    if (cycleId === null) {
      try {
        const db = await getDb();
        if (db) {
          const insertResult = await db.insert(selfPromptLog).values({
            eventType: event.type,
            stateSnapshot: state as unknown as Record<string, unknown>,
            reasoning: selfPrompt.reasoning,
            actions: selfPrompt.actions as unknown as Array<
              Record<string, unknown>
            >,
            converged: gateResult.converged,
            actionCount: selfPrompt.actions.length,
            executedCount: actionsToExecute.length,
            executionResults: executionResults as unknown as Array<
              Record<string, unknown>
            >,
            durationMs,
            claimId: event.claimId ?? null,
            documentId: event.documentId ?? null,
            gapId: event.gapId ?? null,
            // T051: New columns
            directivesIssued: directivesPublished,
            llmRawResponse: selfPrompt.llmRawResponse ?? null,
            llmResponseMs: llmResponseMs,
            executionMs: executionMs,
            totalDurationMs: durationMs,
          });
          cycleId = (insertResult as { insertId?: number }).insertId ?? null;
        }
      } catch (err) {
        log.error("[SelfPromptEngine] Failed to log cycle:", errData(err));
      }
    }

    log.info(
      `[SelfPromptEngine] Cycle complete: event=${event.type}, ` +
        `actions=${selfPrompt.actions.length}, executed=${actionsToExecute.length}, ` +
        `converged=${gateResult.converged}, gateOverrode=${gateResult.overridden}, ` +
        `directives=${directivesPublished}, duration=${durationMs}ms`
    );

    return {
      cycleId,
      eventType: event.type,
      reasoning: selfPrompt.reasoning,
      actionsGenerated: selfPrompt.actions.length,
      actionsExecuted: actionsToExecute.length,
      converged: gateResult.converged,
      gateOverrode: gateResult.overridden,
      gateReason: gateResult.reason,
      directivesPublished,
      durationMs,
    };
  } catch (err) {
    // Global error boundary: return a safe failure result rather than throwing
    const durationMs = Date.now() - startMs;
    const errorMsg = errData(err);
    log.error(
      `[SelfPromptEngine] Unhandled cycle error for event=${event.type}:`,
      errorMsg
    );
    // T052: Emit error telemetry
    void emitTelemetry("error", correlationId, {
      durationMs,
      success: false,
      errorCode: "CYCLE_ERROR",
      meta: { eventType: event.type, error: String(err) },
    });
    return {
      cycleId: null,
      eventType: event.type,
      reasoning: `Cycle failed with unhandled error: ${String(err)}`,
      actionsGenerated: 0,
      actionsExecuted: 0,
      converged: true, // Safe default: converge on error
      gateOverrode: false,
      gateReason: "error_boundary",
      directivesPublished: 0,
      durationMs,
      error: String(err),
    };
  }
}
