/**
 * paperDiscoveredHandler.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontier Layer: paper_discovered event handler.
 *
 * When the autonomous loop receives a paper_discovered event (fired by
 * searchPubMed or autonomousIngest), this handler:
 *   1. Asks the LLM to generate 2-3 gap-closing hypothesis queries based on
 *      the paper's title and abstract snippet.
 *   2. Queues each hypothesis in coord_queue (source: "paper_discovered") for
 *      the full Truth Desk pipeline (Friction → Truth → Verdict).
 *   3. Logs each queued item to frontier_log.
 *
 * Authority boundaries (same as frontierEngine):
 *   ✅ Writes: coord_queue, frontier_log
 *   ❌ NEVER writes: graph_entities, graphRelations, claims, verdicts
 */

import { getDb } from "../db";
import { coordQueue, frontierLog } from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import type { LoopEvent } from "../autonomousLoop/eventBus";
import type { LoopAction } from "../autonomousLoop/loopOrchestrator";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaperDiscoveredPayload {
  pmid: string;
  title: string;
  abstractSnippet?: string;
  journal?: string | null;
  year?: number | null;
  authors?: string[];
  searchQuery?: string;
}

export interface PaperHypothesis {
  claimText: string;
  rationale: string;
  searchTerms: string[];
}

export interface PaperDiscoveredResult {
  hypothesesGenerated: number;
  queueItemsCreated: number;
  hypotheses: PaperHypothesis[];
}

// ─── LLM: generate gap-closing hypotheses from paper ─────────────────────────

async function generateHypothesesFromPaper(
  paper: PaperDiscoveredPayload
): Promise<PaperHypothesis[]> {
  const abstract = paper.abstractSnippet?.slice(0, 600) ?? "(no abstract)";
  const systemPrompt = `You are a scientific hypothesis generator for a protein knowledge graph.
Given a newly discovered paper, generate 2-3 gap-closing hypothesis claims that:
- Are specific, testable, and grounded in the paper's content
- Reference protein names, UniProt accessions, PDB IDs, or biological processes where possible
- Are phrased as verifiable scientific claims (e.g. "Protein X inhibits pathway Y under condition Z")
- Do NOT repeat the paper's conclusions verbatim — extrapolate to adjacent unknowns

Respond with a JSON array of objects with fields:
  claimText: string (the hypothesis as a scientific claim)
  rationale: string (why this follows from the paper, max 100 words)
  searchTerms: string[] (2-4 PubMed search terms to find supporting evidence)`;

  const userPrompt = `Paper: "${paper.title}"
Journal: ${paper.journal ?? "Unknown"} (${paper.year ?? "?"})
Abstract: ${abstract}
Original search query: ${paper.searchQuery ?? "unknown"}

Generate 2-3 gap-closing hypothesis claims.`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "paper_hypotheses",
          strict: true,
          schema: {
            type: "object",
            properties: {
              hypotheses: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    claimText: { type: "string" },
                    rationale: { type: "string" },
                    searchTerms: { type: "array", items: { type: "string" } },
                  },
                  required: ["claimText", "rationale", "searchTerms"],
                  additionalProperties: false,
                },
              },
            },
            required: ["hypotheses"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
    const hypotheses: PaperHypothesis[] = (parsed.hypotheses ?? []).slice(0, 3);
    return hypotheses.filter(
      (h) => typeof h.claimText === "string" && h.claimText.length > 10
    );
  } catch (err) {
    console.warn("[PaperDiscoveredHandler] LLM hypothesis generation failed:", err);
    return [];
  }
}

// ─── Queue a hypothesis into coord_queue ──────────────────────────────────────

async function queuePaperHypothesis(
  hypothesis: PaperHypothesis,
  pmid: string
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const [inserted] = await db.insert(coordQueue).values({
      vertical: "protein",
      priority: 45,
      status: "pending",
      source: "paper_discovered",
      title: `[Paper Hypothesis PMID:${pmid}] ${hypothesis.claimText.slice(0, 180)}`,
      result: {
        hypothesis: hypothesis.claimText,
        rationale: hypothesis.rationale,
        patternType: "gap_closure",
        searchTerms: hypothesis.searchTerms,
        sourcePmid: pmid,
        requiresVerification: true,
      } as unknown as null,
    });

    const queueItemId = (inserted as unknown as { insertId: number }).insertId;

    await db.insert(frontierLog).values({
      actionType: "hypothesis_queued",
      queueItemId,
      reasoning: {
        patternType: "gap_closure",
        claimText: hypothesis.claimText.slice(0, 300),
        confidence: "low",
        searchTerms: hypothesis.searchTerms,
        sourcePmid: pmid,
        source: "paper_discovered",
      },
      outcome: `Paper-seeded hypothesis queued as coord_queue item #${queueItemId} from PMID:${pmid}`,
    });

    return queueItemId;
  } catch (err) {
    console.warn("[PaperDiscoveredHandler] Failed to queue hypothesis:", err);
    return null;
  }
}

// ─── Public: handlePaperDiscovered ───────────────────────────────────────────

/**
 * Main entry point — called by the Frontier Layer when a paper_discovered
 * event enters the autonomous loop.
 *
 * Returns LoopAction[] so the orchestrator can record the work done.
 */
export async function handlePaperDiscovered(
  event: LoopEvent
): Promise<{ actions: LoopAction[]; result: PaperDiscoveredResult }> {
  const actions: LoopAction[] = [];
  const payload = event.payload as unknown as PaperDiscoveredPayload;

  if (!payload?.pmid || !payload?.title) {
    actions.push({
      type: "paper_discovered_skip",
      description: "paper_discovered event missing pmid or title — skipped",
      priority: 10,
      result: "skipped",
    });
    return { actions, result: { hypothesesGenerated: 0, queueItemsCreated: 0, hypotheses: [] } };
  }

  console.log(`[PaperDiscoveredHandler] Generating hypotheses for PMID:${payload.pmid} — "${payload.title.slice(0, 80)}"`);

  const hypotheses = await generateHypothesesFromPaper(payload);

  let queueItemsCreated = 0;
  for (const h of hypotheses) {
    const id = await queuePaperHypothesis(h, payload.pmid);
    if (id !== null) queueItemsCreated++;
  }

  actions.push({
    type: "paper_discovered_hypotheses",
    description: `PMID:${payload.pmid} → ${hypotheses.length} gap-closing hypotheses generated, ${queueItemsCreated} queued for verification`,
    priority: 45,
    result: queueItemsCreated > 0 ? "success" : "skipped",
  });

  console.log(`[PaperDiscoveredHandler] PMID:${payload.pmid}: ${queueItemsCreated}/${hypotheses.length} hypotheses queued`);

  return {
    actions,
    result: {
      hypothesesGenerated: hypotheses.length,
      queueItemsCreated,
      hypotheses,
    },
  };
}
