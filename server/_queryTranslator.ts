// ─── Natural-language query translator ───────────────────────────────────────
// Decomposes an everyday question into 3-5 specific verifiable scientific claims
// using structured LLM output, then runs each through PubMed + verdict engine.

import { invokeMultiLLM } from "./_core/multiLLM";

export interface TranslatedClaim {
  claimText: string;
  searchQuery: string;
  proteinName: string | null;
  organism: string | null;
}

export async function translateQueryToClaims(question: string): Promise<TranslatedClaim[]> {
  const userContent = `Convert this everyday question into 3-5 specific, verifiable scientific claims that can be looked up in PubMed and protein databases.

For each claim provide:
- claimText: a specific, falsifiable scientific statement (e.g. "Salmon skin collagen type I has antimicrobial properties")
- searchQuery: an optimised PubMed search string for this claim (e.g. "salmon collagen antimicrobial peptide")
- proteinName: the primary protein involved if any (e.g. "collagen type I") — null if not applicable
- organism: the organism if any (e.g. "Salmo salar") — null if not applicable

The claims must be grounded in the subject of the question. Return only claims that could plausibly be verified against PubMed or UniProt.

Question: "${question.slice(0, 500)}"`;

  try {
    const response = await invokeMultiLLM(
      {
        messages: [
          {
            role: "system",
            content: "You are a scientific claim decomposer. Output only valid JSON matching the schema.",
          },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "translated_claims",
            strict: true,
            schema: {
              type: "object",
              properties: {
                claims: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      claimText: { type: "string" },
                      searchQuery: { type: "string" },
                      proteinName: { type: ["string", "null"] },
                      organism: { type: ["string", "null"] },
                    },
                    required: ["claimText", "searchQuery", "proteinName", "organism"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["claims"],
              additionalProperties: false,
            },
          },
        },
      },
      "draft"
    );
    const content = response.choices?.[0]?.message?.content as string | undefined;
    if (!content) return [];
    const parsed = JSON.parse(content) as { claims?: TranslatedClaim[] };
    return (parsed.claims ?? []).slice(0, 5);
  } catch {
    return [];
  }
}
