/**
 * promptEngine.ts — LLM-driven Self-Prompting Engine core.
 *
 * Takes a SystemState, builds the master self-prompt template from the paper,
 * calls the LLM, parses the structured JSON response, and applies the
 * convergence gate.
 *
 * Authority boundary: This module only calls invokeLLM and returns a SelfPrompt.
 * It never writes to the DB or calls any action executor.
 */

import { invokeLLM } from "../_core/llm";
import type { SystemState } from "./stateCollector";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SelfPromptAction =
  | "notify"
  | "wiki_update"
  | "frontier"
  | "reindex"
  | "alert"
  | "gap_map"
  | "converge"
  | "meta_check"
  | "drain_queue"        // Drain pending coord_queue items through the analysis pipeline
  | "reverify_stale"     // Re-verify claims whose PDB evidence is >180 days old
  | "recalibrate_confidence"; // Run confidence recalibration on low-confidence claims (<0.4)

export interface PrioritizedAction {
  priority: number;          // 1–100
  action: SelfPromptAction;
  targetId: number;          // claim/gap/entity/document ID
  reasoning: string;
  expectedValue: number;     // 0–100 — used by convergence gate
}

export interface SelfPrompt {
  reasoning: string;
  actions: PrioritizedAction[];
  converge: boolean;
}

// ─── Convergence Gate ─────────────────────────────────────────────────────────
// Per the paper: converge when highest expectedValue < 20 AND no user-facing
// action is pending AND meta-agent health score > 80.

const CONVERGENCE_VALUE_THRESHOLD = 20;
const USER_FACING_ACTIONS: SelfPromptAction[] = ["notify", "alert", "wiki_update", "reindex"];

export function shouldConverge(
  actions: PrioritizedAction[],
  metaHealthScore: number
): boolean {
  if (actions.length === 0) return true;
  const highestValue = Math.max(...actions.map((a) => a.expectedValue));
  if (highestValue >= CONVERGENCE_VALUE_THRESHOLD) return false;
  const hasUserFacing = actions.some((a) => USER_FACING_ACTIONS.includes(a.action));
  if (hasUserFacing) return false;
  if (metaHealthScore <= 80) return false;
  return true;
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function buildSelfPromptMessages(state: SystemState) {
  const { recentEvent, graphSnapshot, queueSnapshot, metaHealth, subscriptionSnapshot } = state;

  const systemPrompt = `You are the Self-Prompting Engine of Truth Desk — a recursively autonomous scientific verification system.
You do not answer user questions. You decide what Truth Desk should do next based on what just happened.

RULES:
- NEVER skip Truth Desk verification for any claim
- NEVER assign verdicts — only queue actions for verified systems
- CONVERGE when highest expectedValue < ${CONVERGENCE_VALUE_THRESHOLD} and no user-facing action pending
- PRIORITIZE user-facing actions (notify, alert, wiki_update, reindex) over internal maintenance
- Generate 1–5 actions maximum per cycle
- Each action must have a specific targetId (claim/gap/entity/document ID); use 0 if unknown

AVAILABLE ACTIONS:
- notify: Send webhook alert to subscribers for a claim/entity
- wiki_update: Trigger wiki recompilation for an entity
- frontier: Submit a gap/hypothesis to the Frontier Engine queue
- reindex: Ping IndexNow for SEO reindexing of a claim/entity page
- alert: Send meta-agent alert for a system health issue
- gap_map: Trigger Frontier gap mapping scan
- meta_check: Trigger a meta-agent health check
- drain_queue: Drain pending coord_queue items through the analysis pipeline (use when pendingItems > 0)
- reverify_stale: Re-verify claims whose PDB evidence is >180 days old (use when staleEvidenceCount > 0)
- recalibrate_confidence: Run confidence recalibration on low-confidence claims (use when lowConfidenceCount > 0)
- converge: Stop — no high-value action remaining

OUTPUT FORMAT (strict JSON, no markdown):
{
  "reasoning": "string explaining your interpretation of the event and why you chose these actions",
  "actions": [
    {
      "priority": 1-100,
      "action": "notify|wiki_update|frontier|reindex|alert|gap_map|meta_check|drain_queue|reverify_stale|recalibrate_confidence|converge",
      "targetId": number,
      "reasoning": "why this specific action matters now",
      "expectedValue": 0-100
    }
  ],
  "converge": boolean
}`;

  const userMessage = `CURRENT STATE:
- Event: ${recentEvent.type} — ${recentEvent.description}
- Claim ID: ${recentEvent.claimId ?? "N/A"}
- Verdict: ${recentEvent.verdict ?? "N/A"}
- Entity ID: ${recentEvent.entityId ?? "N/A"}
- Gap ID: ${recentEvent.gapId ?? "N/A"}
- Document ID: ${recentEvent.documentId ?? "N/A"}

GRAPH SNAPSHOT:
- Entities: ${graphSnapshot.entityCount}
- Contradiction edges: ${graphSnapshot.contradictionCount}
- Open knowledge gaps: ${graphSnapshot.openGapCount}
- High-priority gaps (score > 50): ${graphSnapshot.highPriorityGapCount}

QUEUE SNAPSHOT:
- Pending items: ${queueSnapshot.pendingItems}
- Failed items: ${queueSnapshot.failedItems}

META-AGENT HEALTH:
- Score: ${metaHealth.score}/100 (${metaHealth.grade})
- Critical findings (24h): ${metaHealth.criticalCount}
- Warning findings (24h): ${metaHealth.warningCount}

SUBSCRIPTIONS:
- Active webhook subscribers: ${subscriptionSnapshot.activeWebhookCount}

MAINTENANCE SIGNALS:
- Stale PDB evidence claims (>180 days): ${state.staleEvidenceCount}
- Low-confidence claims (<0.4): ${state.lowConfidenceCount}

DECISION PROTOCOL:
1. What just happened? (Interpret the event)
2. What are the highest-leverage actions? (List 1–5)
3. For each action: why now? what is the expected value?
4. Should I converge? (Is there nothing high-value left to do?)`;

  return [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
  ];
}

// ─── Response Parser ──────────────────────────────────────────────────────────

function parseSelfPromptResponse(rawContent: string, metaHealthScore: number): SelfPrompt {
  try {
    // Strip markdown code fences if present
    const cleaned = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as {
      reasoning?: string;
      actions?: Array<{
        priority?: number;
        action?: string;
        targetId?: number;
        reasoning?: string;
        expectedValue?: number;
      }>;
      converge?: boolean;
    };

    const actions: PrioritizedAction[] = (parsed.actions ?? [])
      .filter((a) => a.action && a.action !== "converge")
      .map((a) => ({
        priority: typeof a.priority === "number" ? Math.max(1, Math.min(100, a.priority)) : 50,
        action: (a.action as SelfPromptAction) ?? "converge",
        targetId: typeof a.targetId === "number" ? a.targetId : 0,
        reasoning: a.reasoning ?? "",
        expectedValue: typeof a.expectedValue === "number" ? Math.max(0, Math.min(100, a.expectedValue)) : 0,
      }))
      .sort((a, b) => b.priority - a.priority);

    const converge = parsed.converge === true || shouldConverge(actions, metaHealthScore);

    return {
      reasoning: parsed.reasoning ?? "No reasoning provided.",
      actions,
      converge,
    };
  } catch {
    // Parse failure → safe convergence
    return {
      reasoning: `Failed to parse self-prompt response: ${rawContent.slice(0, 200)}`,
      actions: [],
      converge: true,
    };
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function runSelfPrompt(state: SystemState): Promise<SelfPrompt> {
  const messages = buildSelfPromptMessages(state);

  try {
    const response = await invokeLLM({
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "self_prompt_response",
          schema: {
            type: "object",
            properties: {
              reasoning: { type: "string" },
              actions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    priority: { type: "number" },
                    action: { type: "string" },
                    targetId: { type: "number" },
                    reasoning: { type: "string" },
                    expectedValue: { type: "number" },
                  },
                  required: ["priority", "action", "targetId", "reasoning", "expectedValue"],
                  additionalProperties: false,
                },
              },
              converge: { type: "boolean" },
            },
            required: ["reasoning", "actions", "converge"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = typeof response?.choices?.[0]?.message?.content === "string"
      ? response.choices[0].message.content
      : "";
    return parseSelfPromptResponse(rawContent, state.metaHealth.score);
  } catch (err) {
    console.error("[SelfPromptEngine] LLM call failed:", err);
    return {
      reasoning: `LLM call failed: ${String(err)}`,
      actions: [],
      converge: true,
    };
  }
}
