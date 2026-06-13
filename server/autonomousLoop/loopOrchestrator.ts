/**
 * loopOrchestrator.ts — The Autonomous Loop orchestrator.
 *
 * Routes each event through the correct layers (L0-L4), collects actions,
 * evaluates the convergence gate, and persists a loop_run record.
 *
 * Layer routing per spec:
 *   L0 (Friction)    — Is this worth processing?
 *   L1 (Truth)       — What does the evidence say?
 *   L2 (Self-Prompt) — What does this result mean?
 *   L3 (Frontier)    — What should we verify next?
 *   L4 (Meta-Agent)  — Is the system itself healthy?
 */

import { getDb } from "../db";
import { loopRun, loopConfig } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  type LoopEvent,
  publishEvent,
  markEventProcessed,
  markEventSkipped,
  markEventFailed,
  getPendingEventCount,
} from "./eventBus";
import { runFrictionGate } from "./layers/frictionLayer";
import { runTruthLayer } from "./layers/truthLayer";
import { runSelfPromptLayer } from "./layers/selfPromptLayer";
import { runFrontierLayer } from "./layers/frontierLayer";
import { runMetaLayer } from "./layers/metaLayer";
import { shouldConverge, type ConvergenceInput } from "./convergenceGate";
import { getSafeModeStatus } from "./safeModeController";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LoopAction {
  type: string;
  description: string;
  priority: number;
  result: "success" | "skipped" | "failed";
  error?: string;
}

export interface LoopRunResult {
  loopRunId: number;
  eventId: number;
  eventType: string;
  layersExecuted: number[];
  actionsExecuted: LoopAction[];
  converged: boolean;
  convergenceReason?: string;
  healthScore?: number;
  safeModeTriggered: boolean;
  durationMs: number;
}

// ─── Main Orchestrator ─────────────────────────────────────────────────────────

/**
 * Process a single event through the autonomous loop.
 * Returns the loop run result.
 */
export async function processEvent(event: LoopEvent): Promise<LoopRunResult> {
  const startTime = Date.now();
  const layersExecuted: number[] = [];
  const actionsExecuted: LoopAction[] = [];
  let converged = false;
  let convergenceReason: string | undefined;
  let healthScore: number | undefined;
  let safeModeTriggered = false;

  try {
    // ── L0: Friction Gate ────────────────────────────────────────────────────
    if (event.entryLayer <= 0) {
      const frictionResult = await runFrictionGate(event);
      layersExecuted.push(0);

      if (!frictionResult.shouldProcess) {
        // Event has no verifiable payload or is redundant → CONVERGE
        await markEventSkipped(event.id, frictionResult.reason ?? "friction_gate_rejected");
        converged = true;
        convergenceReason = frictionResult.reason ?? "friction_gate_rejected";
        return await persistLoopRun({
          event, layersExecuted, actionsExecuted,
          converged, convergenceReason, healthScore,
          safeModeTriggered, startTime,
        });
      }

      actionsExecuted.push(...frictionResult.actions);
    }

    // ── Check Safe Mode ──────────────────────────────────────────────────────
    const safeMode = await getSafeModeStatus();
    if (safeMode.active) {
      // In safe mode: only user-submitted claims, no frontier generation
      if (event.eventType !== "document_submitted" && event.eventType !== "manual_review_complete") {
        await markEventSkipped(event.id, `safe_mode: ${safeMode.reason}`);
        converged = true;
        convergenceReason = `safe_mode_active: ${safeMode.reason}`;
        safeModeTriggered = true;
        return await persistLoopRun({
          event, layersExecuted, actionsExecuted,
          converged, convergenceReason, healthScore,
          safeModeTriggered, startTime,
        });
      }
    }

    // ── L1: Truth Layer ──────────────────────────────────────────────────────
    if (event.entryLayer <= 1 && (
      event.eventType === "source_data_changed" ||
      event.eventType === "source_status_change" ||
      event.eventType === "source_version_changed" ||
      event.eventType === "document_submitted" ||
      event.eventType === "paper_discovered"
    )) {
      const truthResult = await runTruthLayer(event);
      layersExecuted.push(1);
      actionsExecuted.push(...truthResult.actions);

      // Publish verdict_complete events for each verdict
      for (const verdict of truthResult.verdicts) {
        await publishEvent("verdict_complete", {
          claimId: verdict.claimId,
          verdict: verdict.verdict,
          documentId: event.payload.documentId,
          triggeredBy: event.id,
        });
      }
    }

    // ── L2: Self-Prompt Layer ────────────────────────────────────────────────
    if (event.entryLayer <= 2 && (
      event.eventType === "verdict_complete" ||
      event.eventType === "contradiction_found" ||
      event.eventType === "gap_closed" ||
      event.eventType === "coverage_gap" ||
      event.eventType === "hypothesis_resolved" ||
      event.eventType === "loop_action_complete" ||
      event.eventType === "scheduled_tick" ||
      event.eventType === "confidence_review_needed"
    )) {
      const selfPromptResult = await runSelfPromptLayer(event);
      layersExecuted.push(2);
      actionsExecuted.push(...selfPromptResult.actions);
    }

    // ── L3: Frontier Layer ───────────────────────────────────────────────────
    if (!safeMode.active) {
      const frontierResult = await runFrontierLayer(event, actionsExecuted);
      if (frontierResult.ran) {
        layersExecuted.push(3);
        actionsExecuted.push(...frontierResult.actions);
      }
    }

    // ── L4: Meta-Agent Layer ─────────────────────────────────────────────────
    const metaResult = await runMetaLayer(event, actionsExecuted);
    layersExecuted.push(4);
    actionsExecuted.push(...metaResult.actions);
    healthScore = metaResult.healthScore;

    if (metaResult.safeModeTriggered) {
      safeModeTriggered = true;
    }

    // ── L5: Dream Layer ──────────────────────────────────────────────────────
    // dream_pattern_detected → route to meta-agent for health check (already L4)
    // dream_session_complete → publish paper_discovered for each new hypothesis
    if (event.eventType === "dream_session_complete") {
      const hypotheses = (event.payload.hypotheses as Array<{ entityId?: number; gapId?: number }>) ?? [];
      for (const h of hypotheses.slice(0, 5)) {
        if (h.gapId) {
          await publishEvent("gap_closed", {
            gapId: h.gapId,
            triggeredBy: event.id,
            source: "dream_session",
          });
        }
      }
      actionsExecuted.push({
        type: "dream_wake",
        description: `Dream session complete: ${hypotheses.length} hypotheses published back to loop`,
        priority: 60,
        result: "success",
      });
    }

    // ── Convergence Gate ─────────────────────────────────────────────────────
    const pendingCount = await getPendingEventCount();
    const convergenceInput: ConvergenceInput = {
      pendingActions: actionsExecuted,
      metaHealthScore: healthScore ?? 100,
      pendingEventCount: pendingCount,
    };
    const convergenceCheck = shouldConverge(convergenceInput);
    converged = convergenceCheck.converge;
    if (converged) {
      convergenceReason = convergenceCheck.reason;
    }

    const loopRunId = await persistLoopRun({
      event, layersExecuted, actionsExecuted,
      converged, convergenceReason, healthScore,
      safeModeTriggered, startTime,
    });

    await markEventProcessed(event.id, loopRunId.loopRunId);
    return loopRunId;

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await markEventFailed(event.id, errorMessage);
    throw err;
  }
}

// ─── Persist Loop Run ──────────────────────────────────────────────────────────

async function persistLoopRun(params: {
  event: LoopEvent;
  layersExecuted: number[];
  actionsExecuted: LoopAction[];
  converged: boolean;
  convergenceReason?: string;
  healthScore?: number;
  safeModeTriggered: boolean;
  startTime: number;
}): Promise<LoopRunResult> {
  const db = await getDb();
  const durationMs = Date.now() - params.startTime;

  // Encode layers as bitmask
  const layersBitmask = params.layersExecuted.reduce((acc, l) => acc | (1 << l), 0);

  let loopRunId = 0;
  if (db) {
    const [result] = await db.insert(loopRun).values({
      eventQueueId: params.event.id,
      eventType: params.event.eventType,
      layersExecuted: layersBitmask,
      actionsExecuted: params.actionsExecuted,
      converged: params.converged,
      convergenceReason: params.convergenceReason,
      healthScore: params.healthScore,
      safeModeTriggered: params.safeModeTriggered,
      durationMs,
    });
    loopRunId = result.insertId;
  }

  return {
    loopRunId,
    eventId: params.event.id,
    eventType: params.event.eventType,
    layersExecuted: params.layersExecuted,
    actionsExecuted: params.actionsExecuted,
    converged: params.converged,
    convergenceReason: params.convergenceReason,
    healthScore: params.healthScore,
    safeModeTriggered: params.safeModeTriggered,
    durationMs,
  };
}

// ─── Loop Config ───────────────────────────────────────────────────────────────

export async function getLoopConfig() {
  const db = await getDb();
  if (!db) return null;
  const [config] = await db.select().from(loopConfig).where(eq(loopConfig.id, 1));
  return config ?? null;
}
