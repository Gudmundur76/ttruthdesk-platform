/**
 * misrepresentationClassifier.ts
 *
 * Phase 101: Misrepresentation Classification
 *
 * Classifies HOW a claim misrepresents its source when the verdict is
 * Contradicted or Partially Supported. Fires as a non-fatal background task
 * after passage extraction in analysisPipeline.ts.
 *
 * Categories (aligned with the Truth Doctrine distortion stack):
 *   amplification      — overstates magnitude, scope, or certainty
 *   selective_omission — omits key qualifications, limitations, or contradicting data
 *   scope_drift        — generalises beyond the population/context studied
 *   causal_overclaim   — asserts causation where source shows only correlation
 *   fabrication        — attributes content not present in the source at all
 *   none               — verdict is contested but no specific pattern detected
 *   unknown            — classification not yet run (default)
 */

import { invokeLLM } from "./_core/llm";
import { logger, errData } from "./logger";
const log = logger("misrepresentationClassifier");


export type MisrepresentationType =
  | "amplification"
  | "selective_omission"
  | "scope_drift"
  | "causal_overclaim"
  | "fabrication"
  | "none"
  | "unknown";

export interface MisrepresentationResult {
  misrepresentationType: MisrepresentationType;
  /** 0.0–1.0 confidence that this category is correct */
  classificationConfidence: number;
  /** One-sentence explanation of why this category was chosen */
  reasoning: string;
}

/** Verdicts that warrant misrepresentation classification */
const CONTESTED_VERDICTS = new Set(["Contradicted", "Partially Supported"]);

/**
 * Classify the misrepresentation pattern for a contested claim.
 *
 * Returns null if:
 *  - the verdict is not Contradicted or Partially Supported
 *  - the source passage is missing or too short
 *  - the LLM call fails (non-fatal)
 *
 * @param claimText   The claim being evaluated
 * @param verdict     The verdict assigned by the verdict engine
 * @param sourcePassage The verbatim passage from the source document (from Phase 100)
 */
export async function classifyMisrepresentation(
  claimText: string,
  verdict: string,
  sourcePassage: string | null | undefined
): Promise<MisrepresentationResult | null> {
  // Only classify contested verdicts
  if (!CONTESTED_VERDICTS.has(verdict)) {
    return null;
  }

  // Need a meaningful source passage to classify against
  if (!sourcePassage || sourcePassage.trim().length < 30) {
    return null;
  }

  const systemPrompt = `You are a scientific citation integrity analyst. Your task is to classify how a scientific claim misrepresents its source passage.

MISREPRESENTATION CATEGORIES:
- amplification: The claim overstates the magnitude, scope, or certainty of the source finding (e.g., "cures" instead of "may reduce", "all patients" instead of "some patients")
- selective_omission: The claim omits key qualifications, limitations, or contradicting data present in the source (e.g., ignores "in mice only", drops "under specific conditions")
- scope_drift: The claim generalises a finding beyond the population, context, or conditions studied (e.g., applies a finding from elderly patients to all adults)
- causal_overclaim: The claim asserts causation where the source only shows correlation or association (e.g., "causes" instead of "is associated with")
- fabrication: The claim attributes specific content, numbers, or conclusions that do not appear in the source passage at all
- none: The claim is contested but does not clearly fit any of the above patterns

Respond ONLY with valid JSON matching this schema:
{
  "misrepresentationType": "amplification" | "selective_omission" | "scope_drift" | "causal_overclaim" | "fabrication" | "none",
  "classificationConfidence": <number 0.0-1.0>,
  "reasoning": "<one sentence explaining why this category was chosen>"
}`;

  const userPrompt = `CLAIM: "${claimText}"

SOURCE PASSAGE: "${sourcePassage}"

VERDICT: ${verdict}

Classify the misrepresentation pattern. If the claim does not clearly fit any category, use "none".`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "misrepresentation_classification",
          strict: true,
          schema: {
            type: "object",
            properties: {
              misrepresentationType: {
                type: "string",
                enum: [
                  "amplification",
                  "selective_omission",
                  "scope_drift",
                  "causal_overclaim",
                  "fabrication",
                  "none",
                ],
              },
              classificationConfidence: { type: "number" },
              reasoning: { type: "string" },
            },
            required: [
              "misrepresentationType",
              "classificationConfidence",
              "reasoning",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response?.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(
      typeof raw === "string" ? raw : JSON.stringify(raw)
    ) as {
      misrepresentationType: MisrepresentationType;
      classificationConfidence: number;
      reasoning: string;
    };

    // Validate the type is one of the known values
    const validTypes: MisrepresentationType[] = [
      "amplification",
      "selective_omission",
      "scope_drift",
      "causal_overclaim",
      "fabrication",
      "none",
    ];
    if (!validTypes.includes(parsed.misrepresentationType)) {
      return null;
    }

    // Clamp confidence to [0, 1]
    const confidence = Math.max(
      0,
      Math.min(1, parsed.classificationConfidence ?? 0)
    );

    return {
      misrepresentationType: parsed.misrepresentationType,
      classificationConfidence: confidence,
      reasoning: parsed.reasoning ?? "",
    };
  } catch (err) {
    // Non-fatal: log and return null so the pipeline continues
    log.warn("[MisrepresentationClassifier] Classification failed:", errData(err));
    return null;
  }
}
