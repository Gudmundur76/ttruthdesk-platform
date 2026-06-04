/**
 * LLM Claim Extractor
 * Uses the built-in LLM to extract structured molecular claims from biotech documents.
 */

import { invokeMultiLLM, getActiveLLMProvider } from "./_core/multiLLM";

export interface ExtractedClaim {
  claimText: string;
  claimType:
    | "pdb_id"
    | "protein_name"
    | "experimental_method"
    | "resolution"
    | "organism"
    | "ligand"
    | "general_molecular";
  extractedValue: string | null;
  pdbId: string | null;
  proteinName: string | null;
  experimentalMethod: string | null;
  resolution: number | null;
  organism: string | null;
  ligand: string | null;
}

const SYSTEM_PROMPT = `You are a molecular biology claim extractor. Your task is to identify and extract verifiable molecular claims from biotech documents.

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

Be conservative — only extract claims that are specific and potentially verifiable. Do not extract vague or opinion-based statements. Return an empty array [] if no verifiable claims are found.`;

export async function extractClaims(documentText: string, providerOverride?: string): Promise<ExtractedClaim[]> {
  // Truncate very long documents to avoid token limits
  const truncated = documentText.length > 12000 ? documentText.substring(0, 12000) + "\n[Document truncated for analysis]" : documentText;

  const response = await invokeMultiLLM(
    {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Extract all verifiable molecular claims from this biotech document:\n\n${truncated}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "molecular_claims",
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
                  claimType: {
                    type: "string",
                    enum: [
                      "pdb_id",
                      "protein_name",
                      "experimental_method",
                      "resolution",
                      "organism",
                      "ligand",
                      "general_molecular",
                    ],
                  },
                  extractedValue: { type: ["string", "null"] },
                  pdbId: { type: ["string", "null"] },
                  proteinName: { type: ["string", "null"] },
                  experimentalMethod: { type: ["string", "null"] },
                  resolution: { type: ["number", "null"] },
                  organism: { type: ["string", "null"] },
                  ligand: { type: ["string", "null"] },
                },
                required: [
                  "claimText",
                  "claimType",
                  "extractedValue",
                  "pdbId",
                  "proteinName",
                  "experimentalMethod",
                  "resolution",
                  "organism",
                  "ligand",
                ],
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
  "draft",
  providerOverride
  );

  try {
    const content = response.choices?.[0]?.message?.content as string | undefined;
    if (!content) return [];
    const parsed = JSON.parse(content);
    return parsed.claims ?? [];
  } catch {
    // Fallback: try to parse raw JSON array
    try {
      const content = (response.choices?.[0]?.message?.content ?? "[]") as string;
      const arr = JSON.parse(content);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
}

/** Returns the LLM provider name used by the last extractClaims call. */
export { getActiveLLMProvider };
