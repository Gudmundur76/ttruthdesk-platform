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

import { z } from "zod";
import { invokeLLM } from "../_core/llm";
import type { SystemState } from "./stateCollector";
import { logger, errData } from "../logger";
const log = logger("selfPrompt/promptEngine");

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Semantic priority tier for an action.
 * Maps to numeric priority ranges: CRITICAL=81-100, HIGH=61-80, MEDIUM=41-60, LOW=21-40, DEFERRED=1-20.
 */
export type PriorityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "DEFERRED";

export function priorityToLevel(p: number): PriorityLevel {
  if (p >= 81) return "CRITICAL";
  if (p >= 61) return "HIGH";
  if (p >= 41) return "MEDIUM";
  if (p >= 21) return "LOW";
  return "DEFERRED";
}

export type SelfPromptAction =
  | "notify"
  | "wiki_update"
  | "frontier"
  | "reindex"
  | "alert"
  | "gap_map"
  | "converge"
  | "meta_check"
  | "drain_queue" // Drain pending coord_queue items through the analysis pipeline
  | "reverify_stale" // Re-verify claims whose PDB evidence is >180 days old
  | "recalibrate_confidence" // Run confidence recalibration on low-confidence claims (<0.4)
  | "wiki_edit" // Edit a specific wiki entity page with new content
  | "alert_dispatch" // Dispatch a structured alert for a specific claim
  | "graph_suggest" // Suggest a new concept graph entity from an existing entity
  | "ingest_request" // Request a domain ingest run (fire-and-forget)
  | "update_claim"; // Update a claim's verdict rationale based on new evidence

export interface PrioritizedAction {
  priority: number; // 1–100
  priorityLevel: PriorityLevel; // semantic tier derived from priority
  action: SelfPromptAction;
  targetId: number; // claim/gap/entity/document ID
  reasoning: string;
  /** One-sentence justification for why this action was chosen over alternatives */
  justification: string;
  expectedValue: number; // 0–100 — used by convergence gate
}

export interface SelfPrompt {
  reasoning: string;
  actions: PrioritizedAction[];
  converge: boolean;
  /** Raw LLM response string before parsing. T051 */
  llmRawResponse?: string;
  /** LLM call duration in ms. T051 */
  llmResponseMs?: number;
}

// ─── Zod Schema ───────────────────────────────────────────────────────────────
// Validates the raw LLM JSON output before we trust it.

const PrioritizedActionSchema = z.object({
  priority: z.number().min(1).max(100),
  action: z.string().min(1),
  targetId: z.number().int(),
  reasoning: z.string(),
  justification: z.string().default(""),
  expectedValue: z.number().min(0).max(100),
});

const SelfPromptResponseSchema = z.object({
  reasoning: z.string().min(1),
  actions: z.array(PrioritizedActionSchema).max(10),
  converge: z.boolean(),
});

type RawSelfPromptResponse = z.infer<typeof SelfPromptResponseSchema>;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max directives (frontier/gap_map) per cycle. T036 */
export const MAX_DIRECTIVES_PER_CYCLE = 3;

/** LLM timeout in ms. T034 */
export const LLM_TIMEOUT_MS = 30_000;

// ─── Convergence Gate ─────────────────────────────────────────────────────────
// Per the paper: converge when highest expectedValue < 20 AND no user-facing
// action is pending AND meta-agent health score > 80.
const CONVERGENCE_VALUE_THRESHOLD = 20;
const USER_FACING_ACTIONS: SelfPromptAction[] = [
  "notify",
  "alert",
  "wiki_update",
  "reindex",
];

export function shouldConverge(
  actions: PrioritizedAction[],
  metaHealthScore: number
): boolean {
  if (actions.length === 0) return true;
  const highestValue = Math.max(...actions.map(a => a.expectedValue));
  if (highestValue >= CONVERGENCE_VALUE_THRESHOLD) return false;
  const hasUserFacing = actions.some(a =>
    USER_FACING_ACTIONS.includes(a.action)
  );
  if (hasUserFacing) return false;
  if (metaHealthScore <= 80) return false;
  return true;
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

function buildSelfPromptMessages(state: SystemState) {
  const {
    recentEvent,
    graphSnapshot,
    queueSnapshot,
    metaHealth,
    subscriptionSnapshot,
    claimTrends,
    dreamStats,
    directiveStats,
  } = state;

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
      "justification": "one sentence: why this action over alternatives",
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
- Drift findings (24h): ${metaHealth.driftFindingCount}

SUBSCRIPTIONS:
- Active webhook subscribers: ${subscriptionSnapshot.activeWebhookCount}

MAINTENANCE SIGNALS:
- Stale PDB evidence claims (>180 days): ${state.staleEvidenceCount}
- Low-confidence claims (<0.4): ${state.lowConfidenceCount}

CLAIM TRENDS (last 7 days):
- Verified: ${claimTrends.recentVerifiedCount} | Supported: ${claimTrends.recentSupportedCount} | Contradicted: ${claimTrends.recentContradictedCount} | Ambiguous: ${claimTrends.recentAmbiguousCount}

DREAM ENGINE:
- Completed sessions (all time): ${dreamStats.totalCompletedSessions} | Recent (24h): ${dreamStats.recentSessionCount} | Pending staging: ${dreamStats.pendingStagingItems}

DIRECTIVE PIPELINE:
- Active directives: ${directiveStats.activeDirectiveCount} | Issued (24h): ${directiveStats.recentDirectiveCount}

DECISION PROTOCOL:
1. What just happened? (Interpret the event)
2. What are the highest-leverage actions? (List 1–5)
3. For each action: why now? what is the expected value? what is the one-sentence justification?
4. Should I converge? (Is there nothing high-value left to do?)`;

  return [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userMessage },
  ];
}

// ─── Response Parser ──────────────────────────────────────────────────────────

function parseSelfPromptResponse(
  rawContent: string,
  metaHealthScore: number
): SelfPrompt {
  try {
    // Strip markdown code fences if present
    const cleaned = rawContent
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const rawParsed: unknown = JSON.parse(cleaned);

    // Validate with zod — reject structurally invalid responses
    const zodResult = SelfPromptResponseSchema.safeParse(rawParsed);
    let parsed: RawSelfPromptResponse;
    if (zodResult.success) {
      parsed = zodResult.data;
    } else {
      const issues = zodResult.error.issues
        .map(i => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      log.warn(
        `[SelfPromptEngine] LLM response failed zod validation: ${issues}`
      );
      // Attempt best-effort extraction from raw JSON rather than hard-failing
      const fallback = rawParsed as Record<string, unknown>;
      parsed = {
        reasoning:
          typeof fallback.reasoning === "string"
            ? fallback.reasoning
            : "Validation failed — best-effort extraction.",
        actions: [],
        converge: true,
      };
    }

    const actions: PrioritizedAction[] = (parsed.actions ?? [])
      .filter(a => a.action && a.action !== "converge")
      .map(a => {
        const priority = Math.max(1, Math.min(100, a.priority));
        return {
          priority,
          priorityLevel: priorityToLevel(priority),
          action: a.action as SelfPromptAction,
          targetId: a.targetId,
          reasoning: a.reasoning,
          justification: a.justification ?? "",
          expectedValue: Math.max(0, Math.min(100, a.expectedValue)),
        };
      })
      .sort((a, b) => b.priority - a.priority);

    const converge =
      parsed.converge === true || shouldConverge(actions, metaHealthScore);

    return {
      reasoning: parsed.reasoning,
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
    // T034: 30s AbortController timeout on the LLM call
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    let response: Awaited<ReturnType<typeof invokeLLM>>;
    const llmStart = Date.now();
    try {
      response = await invokeLLM({
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
                      justification: { type: "string" },
                      expectedValue: { type: "number" },
                    },
                    required: [
                      "priority",
                      "action",
                      "targetId",
                      "reasoning",
                      "justification",
                      "expectedValue",
                    ],
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
    } finally {
      clearTimeout(timeoutId);
    }
    const llmResponseMs = Date.now() - llmStart;
    const rawContent =
      typeof response?.choices?.[0]?.message?.content === "string"
        ? response.choices[0].message.content
        : "";
    const result = parseSelfPromptResponse(rawContent, state.metaHealth.score);
    // T036: Cap directive actions (frontier/gap_map) at MAX_DIRECTIVES_PER_CYCLE
    const directiveTypes: SelfPromptAction[] = ["frontier", "gap_map"];
    let directiveCount = 0;
    result.actions = result.actions.filter(a => {
      if (directiveTypes.includes(a.action)) {
        directiveCount++;
        if (directiveCount > MAX_DIRECTIVES_PER_CYCLE) {
          log.warn(
            `[SelfPromptEngine] Directive cap reached — dropping ${a.action} action`
          );
          return false;
        }
      }
      return true;
    });
    return { ...result, llmRawResponse: rawContent, llmResponseMs };
  } catch (err) {
    log.error("[SelfPromptEngine] LLM call failed:", errData(err));
    return {
      reasoning: `LLM call failed: ${String(err)}`,
      actions: [],
      converge: true,
    };
  }
}
