/**
 * selfPromptLayer.ts — L2: Self-Prompt Layer
 *
 * Interprets the meaning of events and decides what to do next.
 * Implements the full 4-verdict action matrix from the Autonomous Loop spec:
 *
 *   Supported          → update graph, check gaps, notify subscribers, reindex
 *   Contradicted       → alert subscribers, wiki lint, generate explanation
 *   Insufficient Evid. → create gap record, Frontier pursue, expand search, queue hypothesis
 *   Partially Supported→ update graph (partial), flag for expert review, notify subs
 *
 * Also handles: contradiction_found, gap_closed, hypothesis_resolved,
 *               manual_review_complete, scheduled_tick
 */

import type { LoopEvent } from "../eventBus";
import type { LoopAction } from "../loopOrchestrator";
import { runSelfPromptCycle } from "../../selfPrompt/engine";
import type { SelfPromptEvent } from "../../selfPrompt/stateCollector";
import { publishEvent } from "../eventBus";
import { scanLocalContradictions } from "../../contradictionDetector";

export interface SelfPromptLayerResult {
  actions: LoopAction[];
}

// ─── Verdict-specific action matrices ─────────────────────────────────────────

async function handleSupportedVerdict(event: LoopEvent): Promise<LoopAction[]> {
  const actions: LoopAction[] = [];
  const { documentId, claimId } = event.payload as {
    documentId?: number;
    claimId?: number;
  };

  // 1. Update graph — log to wiki audit trail
  try {
    if (documentId) {
      const { appendLog } = await import("../../wikiEngine");
      await appendLog(
        "update",
        `Claim #${claimId} Supported — graph updated`,
        1,
        `claim-${claimId}`,
        documentId
      );
      actions.push({
        type: "wiki_update",
        description: `Graph updated for document #${documentId} (Supported verdict)`,
        priority: 80,
        result: "success",
      });
    }
  } catch (err) {
    actions.push({
      type: "wiki_update",
      description: `Graph update failed: ${err instanceof Error ? err.message : String(err)}`,
      priority: 80,
      result: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Check gaps — fire gap_closed event so Frontier layer can close matching gaps
  try {
    publishEvent("gap_closed", {
      documentId,
      claimId,
      reason: "supported_verdict_may_close_gap",
    }).catch(() => {});
    actions.push({
      type: "gap_check",
      description: `Gap closure check triggered for claim #${claimId}`,
      priority: 60,
      result: "success",
    });
  } catch {
    // non-fatal
  }

  // 3. Notify subscribers — route a MetaFinding for new Supported claim
  try {
    if (documentId) {
      const { routeFinding } = await import("../../metaAgent/alertRouter");
      await routeFinding({
        checkType: "new_supported_claim",
        severity: "info",
        confidence: 0.9,
        summary: `New Supported verdict on claim #${claimId} in document #${documentId}`,
        details: { documentId, claimId },
        actionTaken: "alerted",
      });
      actions.push({
        type: "notify_subscribers",
        description: `Subscribers notified of Supported verdict (claim #${claimId})`,
        priority: 50,
        result: "success",
      });
    }
  } catch {
    // non-fatal
  }

  // 4. Reindex — notify IndexNow for SEO
  try {
    if (documentId) {
      const { notifyIndexNow } = await import("../../seo/indexNow");
      const baseUrl =
        process.env.VITE_FRONTEND_FORGE_API_URL ?? "https://localhost:3000";
      await notifyIndexNow(`${baseUrl}/report/${documentId}`);
      actions.push({
        type: "reindex",
        description: `Document #${documentId} submitted to IndexNow`,
        priority: 30,
        result: "success",
      });
    }
  } catch {
    // non-fatal
  }

  return actions;
}

async function handleContradictedVerdict(
  event: LoopEvent
): Promise<LoopAction[]> {
  const actions: LoopAction[] = [];
  const { documentId, claimId } = event.payload as {
    documentId?: number;
    claimId?: number;
  };

  // 1. Alert subscribers — contradiction is high-priority
  try {
    if (documentId) {
      const { routeFinding } = await import("../../metaAgent/alertRouter");
      await routeFinding({
        checkType: "contradiction_detected",
        severity: "warning",
        confidence: 0.85,
        summary: `Contradiction detected on claim #${claimId} in document #${documentId}`,
        details: { documentId, claimId },
        actionTaken: "alerted",
      });
      actions.push({
        type: "alert_subscribers",
        description: `Contradiction alert sent for claim #${claimId}`,
        priority: 90,
        result: "success",
      });
    }
  } catch {
    // non-fatal
  }

  // 2. Wiki lint — append to wiki audit log
  try {
    if (documentId) {
      const { appendLog } = await import("../../wikiEngine");
      await appendLog(
        "update",
        `Contradiction detected on claim #${claimId} — entity page requires review`,
        2,
        `claim-${claimId}`,
        documentId
      );
      actions.push({
        type: "wiki_lint",
        description: `Wiki audit log updated for contradiction on claim #${claimId}`,
        priority: 70,
        result: "success",
      });
    }
  } catch {
    // non-fatal
  }

  // 3. Generate explanation — Self-Prompt cycle with contradiction context
  try {
    const selfPromptEvent: SelfPromptEvent = {
      type: "contradiction_found",
      description: `Contradiction on claim #${claimId} in document #${documentId}. Generate explanation and next steps.`,
      documentId,
      claimId,
    };
    const result = await runSelfPromptCycle(selfPromptEvent);
    actions.push({
      type: "contradiction_explanation",
      description: `Contradiction explanation generated: ${result.actionsExecuted} actions`,
      priority: 60,
      result: "success",
    });
  } catch (err) {
    actions.push({
      type: "contradiction_explanation",
      description: `Contradiction explanation failed: ${err instanceof Error ? err.message : String(err)}`,
      priority: 60,
      result: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return actions;
}

async function handleInsufficientEvidence(
  event: LoopEvent
): Promise<LoopAction[]> {
  const actions: LoopAction[] = [];
  const { documentId, claimId } = event.payload as {
    documentId?: number;
    claimId?: number;
  };

  // 1. Create gap record — run Frontier Engine to detect and persist the gap
  try {
    if (documentId && claimId) {
      const { runFrontierEngine } = await import(
        "../../frontier/frontierEngine"
      );
      const frontierResult = await runFrontierEngine();
      actions.push({
        type: "gap_record_created",
        description: `Gap record created for insufficient evidence on claim #${claimId}. Frontier mapped ${frontierResult.gapMapping.total} gaps.`,
        priority: 85,
        result: "success",
      });
    }
  } catch (err) {
    actions.push({
      type: "gap_record_created",
      description: `Gap creation failed: ${err instanceof Error ? err.message : String(err)}`,
      priority: 85,
      result: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Frontier pursue — publish gap_closed event to trigger Frontier layer
  try {
    publishEvent("gap_closed", {
      documentId,
      claimId,
      reason: "insufficient_evidence_gap_pursuit",
    }).catch(() => {});
    actions.push({
      type: "frontier_pursue",
      description: `Frontier pursuit triggered for claim #${claimId}`,
      priority: 75,
      result: "success",
    });
  } catch {
    // non-fatal
  }

  // 3. Expand search — run Inverse Prompt Engine to generate new questions
  try {
    const { runInversePromptEngine } = await import(
      "../../inversePrompt/inversePromptEngine"
    );
    const inverseResult = await runInversePromptEngine();
    actions.push({
      type: "expand_search",
      description: `Inverse Prompt Engine generated ${inverseResult.candidatesGenerated} new questions (${inverseResult.passedGate} passed gate)`,
      priority: 65,
      result: "success",
    });
  } catch {
    // non-fatal
  }

  // 4. Queue hypothesis — Self-Prompt cycle with gap context
  try {
    const selfPromptEvent: SelfPromptEvent = {
      type: "verdict_assigned",
      description: `Insufficient evidence for claim #${claimId}. Generate hypothesis for pursuit.`,
      documentId,
      claimId,
    };
    const result = await runSelfPromptCycle(selfPromptEvent);
    actions.push({
      type: "hypothesis_queued",
      description: `Hypothesis queued: ${result.actionsExecuted} self-prompt actions`,
      priority: 55,
      result: "success",
    });
  } catch {
    // non-fatal
  }

  return actions;
}

async function handlePartiallySupported(
  event: LoopEvent
): Promise<LoopAction[]> {
  const actions: LoopAction[] = [];
  const { documentId, claimId } = event.payload as {
    documentId?: number;
    claimId?: number;
  };

  // 1. Update graph (partial) — wiki audit log with partial confidence
  try {
    if (documentId) {
      const { appendLog } = await import("../../wikiEngine");
      await appendLog(
        "update",
        `Claim #${claimId} Partially Supported — graph updated with partial confidence`,
        2,
        `claim-${claimId}`,
        documentId
      );
      actions.push({
        type: "wiki_update_partial",
        description: `Graph updated (partial) for document #${documentId}`,
        priority: 70,
        result: "success",
      });
    }
  } catch {
    // non-fatal
  }

  // 2. Flag for expert review
  try {
    if (documentId) {
      const { routeFinding } = await import("../../metaAgent/alertRouter");
      await routeFinding({
        checkType: "partial_support_expert_review",
        severity: "info",
        confidence: 0.7,
        summary: `Claim #${claimId} is Partially Supported — flagged for expert review`,
        details: { documentId, claimId },
        actionTaken: "queuedFix",
        recommended_action: "investigate",
      });
      actions.push({
        type: "expert_review_flag",
        description: `Claim #${claimId} flagged for expert review (Partially Supported)`,
        priority: 60,
        result: "success",
      });
    }
  } catch {
    // non-fatal
  }

  // 3. Notify subscribers
  try {
    if (documentId) {
      const { routeFinding } = await import("../../metaAgent/alertRouter");
      await routeFinding({
        checkType: "partial_support_detected",
        severity: "info",
        confidence: 0.7,
        summary: `Claim #${claimId} is Partially Supported — requires additional evidence`,
        details: { documentId, claimId },
        actionTaken: "alerted",
      });
      actions.push({
        type: "notify_subscribers",
        description: `Subscribers notified of Partially Supported verdict (claim #${claimId})`,
        priority: 45,
        result: "success",
      });
    }
  } catch {
    // non-fatal
  }

  return actions;
}

// ─── Main Layer Entry Point ────────────────────────────────────────────────────

export async function runSelfPromptLayer(
  event: LoopEvent
): Promise<SelfPromptLayerResult> {
  const actions: LoopAction[] = [];

  try {
    const verdict = event.payload.verdict as string | undefined;

    // Route to verdict-specific action matrix
    if (event.eventType === "verdict_complete" && verdict) {
      let verdictActions: LoopAction[] = [];

      if (verdict === "Supported") {
        verdictActions = await handleSupportedVerdict(event);
      } else if (verdict === "Contradicted") {
        verdictActions = await handleContradictedVerdict(event);
      } else if (verdict === "Insufficient Evidence") {
        verdictActions = await handleInsufficientEvidence(event);
      } else if (verdict === "Partially Supported") {
        verdictActions = await handlePartiallySupported(event);
      } else {
        // Ambiguous, Out of Scope, Needs Expert Review — generic self-prompt cycle
        const selfPromptEvent: SelfPromptEvent = {
          type: "verdict_assigned",
          description: `Verdict '${verdict}' on claim #${event.payload.claimId} — assess next steps`,
          documentId: event.payload.documentId as number | undefined,
          claimId: event.payload.claimId as number | undefined,
        };
        const result = await runSelfPromptCycle(selfPromptEvent);
        verdictActions.push({
          type: "self_prompt_cycle",
          description: `Self-prompt cycle for ${verdict}: ${result.actionsExecuted} actions`,
          priority: 40,
          result: "success",
        });
      }

      actions.push(...verdictActions);
      // Reactive local contradiction scan — fire-and-forget, never blocks the layer
      if (event.payload.claimId) {
        scanLocalContradictions(event.payload.claimId as number).catch(
          () => {}
        );
      }
    } else {
      // Non-verdict events: contradiction_found, gap_closed, hypothesis_resolved,
      // manual_review_complete, scheduled_tick — use generic self-prompt cycle
      const triggerType: SelfPromptEvent["type"] =
        event.eventType === "contradiction_found"
          ? "contradiction_found"
          : event.eventType === "gap_closed"
            ? "gap_closed"
            : event.eventType === "document_submitted"
              ? "user_submitted"
              : event.eventType === "scheduled_tick" ||
                  event.eventType === "confidence_review_needed"
                ? "scheduled_tick" // confidence review uses scheduled_tick semantics
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
    }
  } catch (err) {
    actions.push({
      type: "self_prompt_cycle",
      description: `Self-prompt layer failed: ${err instanceof Error ? err.message : String(err)}`,
      priority: 40,
      result: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { actions };
}
