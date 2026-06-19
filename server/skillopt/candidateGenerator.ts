/**
 * candidateGenerator.ts — SkillOpt Candidate Instruction Generator
 *
 * Generates N candidate instruction variants for a given instruction set
 * using three strategies (PRD_SKILLOPT_AGENT2MODEL §1.5):
 *
 *   A. Local edits (70%): specificity constraints, example changes, format tweaks
 *   B. Cross-pollination (20%): merge best parts of two working instructions
 *   C. LLM-Generated (10%): ask the LLM to rewrite the prompt
 *
 * The generator is budget-aware: LLM-generated candidates cost API calls,
 * so they are capped at 10% of the total candidate count.
 */

import { invokeMultiLLM } from "../_core/multiLLM";
import { logger } from "../logger";

const log = logger("skillopt/candidateGenerator");

// ─── Types ─────────────────────────────────────────────────────────────────────

export type InstructionSet =
  | "claim_extraction"
  | "evidence_lookup"
  | "confidence_scoring";

export interface CandidateGenerationConfig {
  instructionSet: InstructionSet;
  currentInstruction: string;
  /** Other instructions that are performing well (for cross-pollination) */
  referenceInstructions?: string[];
  /** How many candidates to generate */
  count: number;
  /** Whether to use LLM-generated candidates (costs API calls) */
  useLlmGeneration?: boolean;
}

export interface GeneratedCandidate {
  instruction: string;
  strategy: "local_edit" | "cross_pollination" | "llm_generated";
  /** Brief description of what was changed */
  changeDescription: string;
}

// ─── Local Edit Templates ──────────────────────────────────────────────────────

const SPECIFICITY_CONSTRAINTS: Record<InstructionSet, string[]> = {
  claim_extraction: [
    "\nCONSTRAINT: Only extract claims that name a specific entity (protein ID, PDB code, drug name, law number).",
    "\nCONSTRAINT: Each claim must include a specific measurable value (angstroms, percentage, date, count).",
    "\nCONSTRAINT: Reject claims that use vague language like 'high', 'low', 'significant' without numeric values.",
    "\nCONSTRAINT: Each claim must be independently verifiable against a public database or registry.",
    "\nCONSTRAINT: Do not extract methodological descriptions — only factual assertions about specific entities.",
  ],
  evidence_lookup: [
    "\nFOCUS: Narrow the search to exact entity identifiers (PDB ID, UniProt ID, DOI, ClinicalTrials.gov ID).",
    "\nFOCUS: Prefer structured database queries over free-text search when entity IDs are available.",
    "\nFOCUS: Return only evidence that directly addresses the claim's specific assertion, not general background.",
    "\nFOCUS: If the entity ID is not found, report 'Insufficient Evidence' rather than returning related entries.",
    "\nFOCUS: Prioritise primary sources (PDB, UniProt, ClinicalTrials) over secondary reviews.",
  ],
  confidence_scoring: [
    "\nCALIBRATION: Assign confidence 0.9+ only when evidence is from a primary source with exact value match.",
    "\nCALIBRATION: Assign confidence 0.5-0.7 when evidence is indirect or from a secondary source.",
    "\nCALIBRATION: Assign confidence below 0.4 when the entity is found but the specific value is absent.",
    "\nCALIBRATION: Never assign confidence above 0.8 for claims that require expert interpretation.",
    "\nCALIBRATION: Reduce confidence by 0.2 for each missing required field (entity ID, value, source URL).",
  ],
};

const FORMAT_VARIANTS: Record<InstructionSet, string[]> = {
  claim_extraction: [
    '\nReturn format: JSON array [{"claimText": "...", "claimType": "...", "confidence": 0.0, "entityId": "..."}]',
    '\nReturn format: JSON array [{"claimText": "...", "claimType": "...", "confidence": 0.0, "verifiableValue": "..."}]',
    "\nReturn format: JSON array with fields: claimText (string), claimType (string), confidence (0-1), entityName (string)",
  ],
  evidence_lookup: [
    '\nReturn format: JSON {"found": bool, "sourceId": "...", "sourceUrl": "...", "evidenceRaw": {...}, "confidenceScore": 0.0}',
    '\nReturn format: JSON {"found": bool, "sourceId": "...", "sourceUrl": "...", "matchType": "exact|partial|none", "confidenceScore": 0.0}',
  ],
  confidence_scoring: [
    "\nReturn: a single float between 0.0 and 1.0 representing confidence. No other text.",
    '\nReturn: JSON {"confidence": 0.0, "rationale": "...", "flags": ["..."]}}',
  ],
};

// ─── Generator ─────────────────────────────────────────────────────────────────

/**
 * Generate N candidate instruction variants.
 * Allocates candidates across strategies per PRD ratios:
 *   70% local edits, 20% cross-pollination, 10% LLM-generated
 */
export async function generateCandidates(
  config: CandidateGenerationConfig
): Promise<GeneratedCandidate[]> {
  const {
    instructionSet,
    currentInstruction,
    referenceInstructions = [],
    count,
    useLlmGeneration = true,
  } = config;

  const localCount = Math.ceil(count * 0.7);
  const crossCount = Math.ceil(count * 0.2);
  const llmCount = useLlmGeneration
    ? Math.max(1, count - localCount - crossCount)
    : 0;

  const candidates: GeneratedCandidate[] = [];

  // A. Local edits
  const constraints = SPECIFICITY_CONSTRAINTS[instructionSet] ?? [];
  const formats = FORMAT_VARIANTS[instructionSet] ?? [];
  const allLocalEdits = [...constraints, ...formats];

  for (let i = 0; i < localCount && i < allLocalEdits.length; i++) {
    const edit = allLocalEdits[i % allLocalEdits.length];
    candidates.push({
      instruction: currentInstruction.trimEnd() + edit,
      strategy: "local_edit",
      changeDescription: `Appended specificity constraint: ${edit.slice(0, 60)}...`,
    });
  }

  // Fill remaining local slots with shuffled combinations
  while (
    candidates.filter(c => c.strategy === "local_edit").length < localCount
  ) {
    const c1 = constraints[Math.floor(Math.random() * constraints.length)];
    const c2 = formats[Math.floor(Math.random() * formats.length)];
    if (c1 && c2) {
      candidates.push({
        instruction: currentInstruction.trimEnd() + c1 + c2,
        strategy: "local_edit",
        changeDescription: "Combined constraint + format variant",
      });
    } else {
      break;
    }
  }

  // B. Cross-pollination
  if (referenceInstructions.length > 0) {
    for (let i = 0; i < crossCount; i++) {
      const ref = referenceInstructions[i % referenceInstructions.length];
      // Extract the last paragraph of the reference instruction (usually the return format)
      const refLines = ref.trim().split("\n");
      const refTail = refLines.slice(-Math.min(4, refLines.length)).join("\n");
      candidates.push({
        instruction: currentInstruction.trimEnd() + "\n\n" + refTail,
        strategy: "cross_pollination",
        changeDescription: `Cross-pollinated return format from reference instruction ${i + 1}`,
      });
    }
  }

  // C. LLM-Generated (10% — costs API calls)
  if (useLlmGeneration && llmCount > 0) {
    for (let i = 0; i < llmCount; i++) {
      try {
        const rewritten = await generateLlmCandidate(
          instructionSet,
          currentInstruction
        );
        if (rewritten) {
          candidates.push({
            instruction: rewritten,
            strategy: "llm_generated",
            changeDescription:
              "LLM-rewritten to improve claim extraction accuracy",
          });
        }
      } catch (err) {
        log.warn(
          `[CandidateGenerator] LLM generation failed (non-fatal): ${String(err)}`
        );
      }
    }
  }

  log.info(
    `[CandidateGenerator] Generated ${candidates.length} candidates ` +
      `(local: ${candidates.filter(c => c.strategy === "local_edit").length}, ` +
      `cross: ${candidates.filter(c => c.strategy === "cross_pollination").length}, ` +
      `llm: ${candidates.filter(c => c.strategy === "llm_generated").length})`
  );

  return candidates.slice(0, count);
}

/**
 * Ask the LLM to rewrite the instruction to improve accuracy.
 * Constrained: output must be a valid instruction, not an explanation.
 */
async function generateLlmCandidate(
  instructionSet: InstructionSet,
  currentInstruction: string
): Promise<string | null> {
  const systemPrompt = `You are a prompt engineer specialising in scientific claim verification systems.
Your task is to rewrite an instruction prompt to improve its accuracy on a benchmark dataset.

Rules:
1. Output ONLY the rewritten instruction. No explanations, no markdown, no preamble.
2. The rewritten instruction must be a valid system/user prompt — not an explanation of changes.
3. Preserve the core task description. Only improve specificity, constraints, and format.
4. Do not add fictional examples or hallucinated entity IDs.
5. Keep the instruction under 500 words.`;

  const userPrompt = `Instruction set: ${instructionSet}

Current instruction (needs improvement):
---
${currentInstruction}
---

Rewrite this instruction to improve its F1 score on a scientific claim verification benchmark.
Focus on: specificity of entity requirements, clarity of verifiability criteria, and output format precision.
Output ONLY the rewritten instruction text.`;

  try {
    const response = await invokeMultiLLM(
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 600,
      },
      "quality"
    );
    const text = response?.choices?.[0]?.message?.content?.trim();
    if (!text || text.length < 50) return null;
    return text;
  } catch {
    return null;
  }
}
