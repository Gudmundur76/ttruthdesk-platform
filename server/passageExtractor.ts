/**
 * passageExtractor.ts
 *
 * Citation-first passage extraction (Phase 100).
 *
 * Given a claim text and the raw source document text, this module uses the
 * LLM to locate the exact sentence or short passage in the source that the
 * claim is derived from.  The result is stored on the claims row as:
 *
 *   sourcePassage      — verbatim excerpt (≤ 500 chars)
 *   passageConfidence  — 0.0–1.0 alignment score
 *   passageStartChar   — character offset in rawText where the passage begins
 *   passageEndChar     — character offset in rawText where the passage ends
 *
 * Design principles (Truth Doctrine §3):
 *  - A citation is an assertion, not a pointer.  Every verdict must be
 *    traceable to a specific span of text in the source.
 *  - If no passage can be found with confidence ≥ 0.4, the result is null
 *    (not fabricated).  The caller should treat null as "passage not yet
 *    extracted" rather than "no passage exists".
 *  - Extraction is non-fatal: pipeline failures fall back gracefully.
 */

import { invokeLLM } from "./_core/llm";

export interface PassageResult {
  sourcePassage: string;
  passageConfidence: number;
  passageStartChar: number;
  passageEndChar: number;
}

/**
 * Extract the source passage for a single claim from the raw document text.
 *
 * @param claimText   The claim as extracted by the LLM claim extractor
 * @param rawText     The full raw text of the source document
 * @returns           PassageResult or null if no passage found with confidence ≥ 0.4
 */
export async function extractPassageForClaim(
  claimText: string,
  rawText: string
): Promise<PassageResult | null> {
  if (!rawText || rawText.trim().length < 20) return null;

  // Truncate rawText to 8 000 chars to stay within LLM context limits.
  // The claim extractor already operates on the same window, so the passage
  // should always be present in this range.
  const textWindow = rawText.slice(0, 8000);

  const systemPrompt = `You are a citation passage extractor.
Your job is to find the exact sentence or short passage (≤ 500 characters) in the provided source text that most directly supports or is the origin of the given claim.

Rules:
1. Return ONLY a JSON object — no markdown, no explanation.
2. The "passage" field must be a verbatim substring of the source text (copy-paste exact).
3. The "confidence" field is a float 0.0–1.0 representing how certain you are that this passage is the origin of the claim.
4. If no passage with confidence ≥ 0.4 exists, return {"passage": null, "confidence": 0}.
5. Keep the passage to a single sentence or at most two consecutive sentences.`;

  const userPrompt = `CLAIM: ${claimText}

SOURCE TEXT:
${textWindow}

Return JSON: {"passage": "<verbatim text or null>", "confidence": <0.0-1.0>}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "passage_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              passage: {
                oneOf: [{ type: "string" }, { type: "null" }],
                description: "Verbatim passage from source text, or null",
              },
              confidence: {
                type: "number",
                description: "Alignment confidence 0.0–1.0",
              },
            },
            required: ["passage", "confidence"],
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
      passage: string | null;
      confidence: number;
    };

    if (!parsed.passage || parsed.confidence < 0.4) return null;

    // Find the character offsets of the passage in the original text window
    const startChar = textWindow.indexOf(parsed.passage);
    if (startChar === -1) {
      // LLM hallucinated a passage not in the text — discard
      return null;
    }
    const endChar = startChar + parsed.passage.length;

    return {
      sourcePassage: parsed.passage,
      passageConfidence: Math.min(1.0, Math.max(0.0, parsed.confidence)),
      passageStartChar: startChar,
      passageEndChar: endChar,
    };
  } catch {
    // Non-fatal — passage extraction failure should never block the pipeline
    return null;
  }
}
