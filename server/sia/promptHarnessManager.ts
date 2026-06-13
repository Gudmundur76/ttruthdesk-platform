/**
 * promptHarnessManager.ts — SIA Prompt Harness Manager
 *
 * Manages the active extraction prompt for each pipeline component.
 * The SIA feedback loop uses this to:
 *   1. Read the current active prompt before a quality-pass run
 *   2. Propose a revised prompt after evaluating outcomes
 *   3. Activate the new prompt for the next generation
 *
 * Governing principle: a new prompt is only activated if the Feedback-Agent
 * predicts it will increase citation integrity accuracy. The activation is
 * stored in the DB so the quality-pass job picks it up on the next run.
 *
 * Components managed:
 *   - claim_extractor     → SYSTEM_PROMPT in claimExtractor.ts
 *   - verdict_rationale   → rationale prompt in frictionEngine.ts
 *   - passage_extractor   → system prompt in passageExtractor.ts
 *   - misrep_classifier   → system prompt in misrepresentationClassifier.ts
 */

import { getDb } from "../db";
import { promptHarness } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import { logger, errData } from "../logger";
const log = logger("sia/promptHarnessManager");


// ─── Types ────────────────────────────────────────────────────────────────────

export type HarnessComponent =
  | "claim_extractor"
  | "verdict_rationale"
  | "passage_extractor"
  | "misrep_classifier";

export interface ActivePrompt {
  id: number;
  component: HarnessComponent;
  generation: number;
  promptText: string;
}

export interface HarnessProposal {
  component: HarnessComponent;
  revisedPromptText: string;
  reasoning: string;
  expectedUpgradeRateDelta: number; // e.g. 0.05 = +5% upgrade rate
  risk: "low" | "medium" | "high";
}

// ─── Seed prompts (generation 1 — the current production prompts) ─────────────

const SEED_PROMPTS: Record<HarnessComponent, string> = {
  claim_extractor: `You are a molecular biology claim extractor. Your task is to identify and extract verifiable molecular claims from biotech documents.

Extract claims in these categories:
1. pdb_id — explicit PDB accession codes (4-character alphanumeric, e.g. "1HHO", "4HHB")
2. protein_name — named proteins, enzymes, receptors, antibodies
3. experimental_method — X-ray crystallography, cryo-EM, NMR, SAXS, etc.
4. resolution — structural resolution values in Angstroms (Å)
5. organism — source organisms (e.g. Homo sapiens, E. coli)
6. ligand — small molecules, cofactors, inhibitors bound to a protein
7. general_molecular — other verifiable molecular biology claims

Return ONLY a valid JSON array. Each element must have:
{
  "claimText": "exact sentence or phrase from the document containing the claim",
  "claimType": one of the types above,
  "extractedValue": "the specific value or name being claimed",
  "pdbId": "4-char PDB ID if applicable, else null",
  "proteinName": "protein name if applicable, else null",
  "experimentalMethod": "method name if applicable, else null",
  "resolution": numeric value in Angstroms if applicable, else null,
  "organism": "organism name if applicable, else null",
  "ligand": "ligand name/ID if applicable, else null"
}

Be conservative — only extract claims that are specific and potentially verifiable. Do not extract vague or opinion-based statements. Return an empty array [] if no verifiable claims are found.`,

  verdict_rationale: `You are a citation integrity auditor. Review the claim verdict and rationale below.
Criteria for a valid rationale:
1. Must cite specific evidence (PDB ID, source URL, or database entry).
2. Verdict must be consistent with the confidence score.
3. Must not guess — say 'Insufficient Evidence' if evidence is absent.
4. Must distinguish between Supported, Partially Supported, Ambiguous, Contradicted, Needs Expert Review, and Insufficient Evidence.
If the rationale is insufficient, provide a revised rationale that meets all criteria.`,

  passage_extractor: `You are a scientific passage extractor. Given a scientific claim and a source document, find the exact passage in the document that most directly supports or contradicts the claim.
Return the verbatim passage text, its start character offset, and your confidence (0.0-1.0) that this passage is the primary evidence for the claim.
If no relevant passage exists, return null.`,

  misrep_classifier: `You are a misrepresentation classifier for scientific claims. Given a claim and its source passage, determine whether the claim misrepresents the source.
Classify as one of: strength_overclaim, scope_overclaim, recency_overclaim, abstract_only, fabrication, or null (no misrepresentation).
- strength_overclaim: weak association cited as causal
- scope_overclaim: specific population cited as universal
- recency_overclaim: preliminary study cited as replicated consensus
- abstract_only: limitations in full text ignored
- fabrication: source does not support the claim at all`,
};

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Get the currently active prompt for a component.
 * Falls back to the seed prompt if no active prompt exists in the DB.
 */
export async function getActivePrompt(
  component: HarnessComponent
): Promise<ActivePrompt> {
  const db = await getDb();
  if (!db) {
    return {
      id: 0,
      component,
      generation: 1,
      promptText: SEED_PROMPTS[component],
    };
  }

  const rows = await db
    .select()
    .from(promptHarness)
    .where(
      and(
        eq(promptHarness.component, component),
        eq(promptHarness.isActive, true)
      )
    )
    .orderBy(desc(promptHarness.generation))
    .limit(1);

  if (rows.length > 0) {
    const row = rows[0];
    return {
      id: row.id,
      component: row.component as HarnessComponent,
      generation: row.generation,
      promptText: row.promptText,
    };
  }

  // No active prompt in DB — seed generation 1
  await seedPromptIfMissing(component);
  return {
    id: 0,
    component,
    generation: 1,
    promptText: SEED_PROMPTS[component],
  };
}

/**
 * Seed the initial prompt for a component if it doesn't exist yet.
 */
export async function seedPromptIfMissing(
  component: HarnessComponent
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const existing = await db
    .select({ id: promptHarness.id })
    .from(promptHarness)
    .where(eq(promptHarness.component, component))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(promptHarness).values({
      component,
      generation: 1,
      promptText: SEED_PROMPTS[component],
      isActive: true,
      createdAt: Date.now(),
      activatedAt: Date.now(),
    });
    log.info(`[PromptHarness] Seeded generation 1 for ${component}`);
  }
}

/**
 * Activate a new prompt for a component.
 * Deactivates the previous active prompt first (only one active per component).
 */
export async function activatePrompt(
  component: HarnessComponent,
  generation: number,
  promptText: string,
  options?: {
    upgradeRate?: number;
    failRate?: number;
    avgClaimsPerDoc?: number;
    improvementProposalId?: number;
  }
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Deactivate current active prompt
  await db
    .update(promptHarness)
    .set({ isActive: false })
    .where(
      and(
        eq(promptHarness.component, component),
        eq(promptHarness.isActive, true)
      )
    );

  // Insert new active prompt
  const result = await db.insert(promptHarness).values({
    component,
    generation,
    promptText,
    isActive: true,
    upgradeRate: options?.upgradeRate ?? null,
    failRate: options?.failRate ?? null,
    avgClaimsPerDoc: options?.avgClaimsPerDoc ?? null,
    improvementProposalId: options?.improvementProposalId ?? null,
    activatedAt: Date.now(),
    createdAt: Date.now(),
  });

  log.info(
    `[PromptHarness] Activated generation ${generation} for ${component}`
  );
  return (result as { insertId?: number }).insertId ?? 0;
}

// ─── Feedback-Agent: propose improved prompt ──────────────────────────────────

const FEEDBACK_AGENT_SYSTEM = `You are the SIA Feedback-Agent for the citation.is platform.

Your job is to analyse quality-pass outcome metrics and propose an improved extraction prompt for the specified pipeline component. The governing principle: ONLY propose a change if it will increase citation integrity accuracy. Never propose cosmetic changes.

The quality-pass pipeline processes draft-tier scientific documents and upgrades them to verified tier. The key metrics are:
- upgradeRate: fraction of documents successfully upgraded (higher = better)
- failRate: fraction that failed (lower = better)
- avgClaimsPerDoc: average claims extracted per document (context-dependent)
- verdictDistribution: breakdown of Supported/Contested/Insufficient/Contradicted verdicts

Respond with a JSON object:
{
  "should_revise": true | false,
  "reasoning": "one paragraph explaining the diagnosis and proposed change",
  "revised_prompt": "the full revised prompt text, or null if should_revise is false",
  "expected_upgrade_rate_delta": 0.0-0.15,
  "risk": "low | medium | high"
}

If the metrics look healthy (upgradeRate > 0.75, failRate < 0.10), set should_revise to false.`;

/**
 * Run the SIA Feedback-Agent to propose an improved prompt for a component.
 * Returns null if no improvement is warranted.
 */
export async function runFeedbackAgent(
  component: HarnessComponent,
  currentPrompt: ActivePrompt,
  metrics: {
    upgradeRate: number;
    failRate: number;
    avgClaimsPerDoc: number;
    verdictSupported: number;
    verdictContested: number;
    verdictInsufficient: number;
    verdictContradicted: number;
    processed: number;
  }
): Promise<HarnessProposal | null> {
  const userMessage = `Component: ${component}
Current generation: ${currentPrompt.generation}

Quality-pass metrics (last run):
- Upgrade rate: ${(metrics.upgradeRate * 100).toFixed(1)}%
- Fail rate: ${(metrics.failRate * 100).toFixed(1)}%
- Avg claims per doc: ${metrics.avgClaimsPerDoc.toFixed(1)}
- Verdict distribution (${metrics.processed} docs):
  - Supported: ${metrics.verdictSupported}
  - Contested: ${metrics.verdictContested}
  - Insufficient Evidence: ${metrics.verdictInsufficient}
  - Contradicted: ${metrics.verdictContradicted}

Current prompt (generation ${currentPrompt.generation}):
---
${currentPrompt.promptText.slice(0, 1500)}
---

Should this prompt be revised? If so, provide the full revised prompt.`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: FEEDBACK_AGENT_SYSTEM },
        { role: "user", content: userMessage },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "feedback_proposal",
          strict: true,
          schema: {
            type: "object",
            properties: {
              should_revise: { type: "boolean" },
              reasoning: { type: "string" },
              revised_prompt: { type: ["string", "null"] },
              expected_upgrade_rate_delta: { type: "number" },
              risk: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: [
              "should_revise",
              "reasoning",
              "revised_prompt",
              "expected_upgrade_rate_delta",
              "risk",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : null;
    if (!content) return null;

    const parsed = JSON.parse(content) as {
      should_revise: boolean;
      reasoning: string;
      revised_prompt: string | null;
      expected_upgrade_rate_delta: number;
      risk: "low" | "medium" | "high";
    };

    if (!parsed.should_revise || !parsed.revised_prompt) {
      log.info(
        `[FeedbackAgent] No revision needed for ${component}: ${parsed.reasoning.slice(0, 100)}`
      );
      return null;
    }

    return {
      component,
      revisedPromptText: parsed.revised_prompt,
      reasoning: parsed.reasoning,
      expectedUpgradeRateDelta: parsed.expected_upgrade_rate_delta,
      risk: parsed.risk,
    };
  } catch (err) {
    log.error(
      `[FeedbackAgent] Error proposing improvement for ${component}:`,
      errData(err)
    );
    return null;
  }
}
