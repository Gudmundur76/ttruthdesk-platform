/**
 * engine.ts — Self-Prompting Engine orchestrator.
 *
 * The binding agent between FrictionEngine (Layer 1) and the Frontier Engine (Layer 2).
 * Implements the State → Prompt → Action cycle from the paper:
 *
 *   1. Receive a triggering event
 *   2. Collect the current SystemState from the DB
 *   3. Run the LLM self-prompt to generate a prioritized action list
 *   4. Apply the convergence gate
 *   5. Execute actions that pass the gate
 *   6. Log the full cycle to self_prompt_log
 *
 * Authority boundary:
 *   - Reads from: all tables (via stateCollector)
 *   - Writes to: self_prompt_log only (directly)
 *   - Delegates writes to: existing system modules (wikiEngine, alertDispatcher, etc.)
 *   - NEVER writes to: knowledge graph tables (graph_entities, graph_relations, claims)
 */

import { collectSystemState, type SelfPromptEvent } from "./stateCollector";
import { runSelfPrompt, shouldConverge } from "./promptEngine";
import { executeActions } from "./actionExecutor";
import { getDb } from "../db";
import { selfPromptLog } from "../../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SelfPromptCycleResult {
  cycleId: number | null;
  eventType: string;
  reasoning: string;
  actionsGenerated: number;
  actionsExecuted: number;
  converged: boolean;
  durationMs: number;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function runSelfPromptCycle(event: SelfPromptEvent): Promise<SelfPromptCycleResult> {
  const startMs = Date.now();

  // 1. Collect system state
  const state = await collectSystemState(event);

  // 2. Run LLM self-prompt
  const selfPrompt = await runSelfPrompt(state);

  // 3. Apply convergence gate — filter out actions below threshold if converging
  const actionsToExecute = selfPrompt.converge
    ? [] // Converged: execute nothing
    : selfPrompt.actions;

  // 4. Execute actions
  const executionResults = await executeActions(actionsToExecute);

  const durationMs = Date.now() - startMs;

  // 5. Log the cycle to self_prompt_log
  let cycleId: number | null = null;
  try {
    const db = await getDb();
    if (db) {
      const insertResult = await db.insert(selfPromptLog).values({
        eventType: event.type,
        stateSnapshot: state as unknown as Record<string, unknown>,
        reasoning: selfPrompt.reasoning,
        actions: selfPrompt.actions as unknown as Array<Record<string, unknown>>,
        converged: selfPrompt.converge,
        actionCount: selfPrompt.actions.length,
        executedCount: actionsToExecute.length,
        executionResults: executionResults as unknown as Array<Record<string, unknown>>,
        durationMs,
        claimId: event.claimId ?? null,
        documentId: event.documentId ?? null,
        gapId: event.gapId ?? null,
      });
      cycleId = (insertResult as { insertId?: number }).insertId ?? null;
    }
  } catch (err) {
    console.error("[SelfPromptEngine] Failed to log cycle:", err);
  }

  console.log(
    `[SelfPromptEngine] Cycle complete: event=${event.type}, ` +
    `actions=${selfPrompt.actions.length}, executed=${actionsToExecute.length}, ` +
    `converged=${selfPrompt.converge}, duration=${durationMs}ms`
  );

  return {
    cycleId,
    eventType: event.type,
    reasoning: selfPrompt.reasoning,
    actionsGenerated: selfPrompt.actions.length,
    actionsExecuted: actionsToExecute.length,
    converged: selfPrompt.converge,
    durationMs,
  };
}
