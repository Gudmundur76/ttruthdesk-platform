/**
 * claimExtractor.ts — Sprint 40 (domain-aware rewrite)
 *
 * Domain-aware LLM claim extractor. Routes each document to the correct
 * per-domain extraction config from domainClaimExtractor.ts, producing
 * domain-appropriate claims instead of always using the structural biology prompt.
 *
 * Breaking change from Sprint 39:
 *   - extractClaims() now accepts an optional `domain` parameter
 *   - ExtractedClaim.claimType is now `string` (was a 7-value union)
 *   - Extra domain-specific fields are returned in `domainFields` (Record<string, unknown>)
 *   - The legacy structural biology fields (pdbId, proteinName, etc.) are still
 *     populated for structural_biology domain for backwards compatibility
 */

import { invokeMultiLLM, getActiveLLMProvider } from "./_core/multiLLM";
import { getDomainExtractorConfig } from "./domainClaimExtractor";

export interface ExtractedClaim {
  claimText: string;
  /** Domain-specific claim type string (e.g. "pdb_id", "trial_id", "gdp", "earthquake") */
  claimType: string;
  extractedValue: string | null;
  /** Domain-specific structured fields (e.g. pdbId, country, magnitude) */
  domainFields: Record<string, unknown>;
  // ── Legacy structural biology fields (populated for structural_biology domain) ──
  pdbId: string | null;
  proteinName: string | null;
  experimentalMethod: string | null;
  resolution: number | null;
  organism: string | null;
  ligand: string | null;
  /** Verbatim sentence/passage from the source document this claim comes from */
  sourcePassage: string | null;
}

/**
 * Extract verifiable claims from a document using the domain-appropriate prompt.
 *
 * @param documentText - Raw text of the document (title + abstract + body)
 * @param providerOverride - Optional LLM provider override
 * @param domain - Domain label from DomainLabel type (e.g. "clinical_trial", "energy")
 *                 Defaults to "structural_biology" for backwards compatibility.
 * @param priorContext - Optional prior verification context from MRAgent memory server.
 *                       When provided, it is prepended to the system prompt so the LLM
 *                       can use past verification results to improve claim extraction.
 */
export async function extractClaims(
  documentText: string,
  providerOverride?: string,
  domain = "structural_biology",
  priorContext?: string
): Promise<ExtractedClaim[]> {
  const config = getDomainExtractorConfig(domain);

  // Truncate very long documents to avoid token limits
  const truncated =
    documentText.length > 12000
      ? documentText.substring(0, 12000) + "\n[Document truncated for analysis]"
      : documentText;

  // Build the JSON schema for this domain's claim types
  const itemProperties: Record<string, unknown> = {
    claimText: { type: "string" },
    claimType: {
      type: "string",
      enum: config.claimTypes,
    },
    extractedValue: { type: ["string", "null"] },
    sourcePassage: { type: ["string", "null"] },
    ...config.extraSchemaProperties,
  };

  const itemRequired = [
    "claimText",
    "claimType",
    "extractedValue",
    "sourcePassage",
    ...config.extraRequired,
  ];

  const response = await invokeMultiLLM(
    {
      messages: [
        {
          role: "system",
          content: priorContext
            ? `${config.systemPrompt}\n\n--- PRIOR VERIFICATION CONTEXT ---\n${priorContext}\n--- END PRIOR CONTEXT ---`
            : config.systemPrompt,
        },
        {
          role: "user",
          content: `${config.userPrefix}\n\n${truncated}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "domain_claims",
          strict: true,
          schema: {
            type: "object",
            properties: {
              claims: {
                type: "array",
                items: {
                  type: "object",
                  properties: itemProperties,
                  required: itemRequired,
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
    const content = response.choices?.[0]?.message?.content as
      | string
      | undefined;
    if (!content) return [];
    const parsed = JSON.parse(content) as { claims?: unknown[] };
    const rawClaims = parsed.claims ?? [];
    return rawClaims.map(normaliseRawClaim);
  } catch {
    // Fallback: try to parse raw JSON array
    try {
      const content = (response.choices?.[0]?.message?.content ??
        "[]") as string;
      const arr = JSON.parse(content) as unknown[];
      return Array.isArray(arr) ? arr.map(normaliseRawClaim) : [];
    } catch {
      return [];
    }
  }
}

/**
 * Normalise a raw LLM-returned claim object into ExtractedClaim shape.
 * Pulls legacy structural biology fields from domainFields for backwards compat.
 */
function normaliseRawClaim(raw: unknown): ExtractedClaim {
  const r = raw as Record<string, unknown>;
  const { claimText, claimType, extractedValue, ...rest } = r;

  return {
    claimText: String(claimText ?? ""),
    claimType: String(claimType ?? "general_molecular"),
    extractedValue: extractedValue != null ? String(extractedValue) : null,
    domainFields: rest,
    // Legacy structural biology fields — populated when present
    pdbId: typeof rest.pdbId === "string" ? rest.pdbId : null,
    proteinName: typeof rest.proteinName === "string" ? rest.proteinName : null,
    experimentalMethod:
      typeof rest.experimentalMethod === "string"
        ? rest.experimentalMethod
        : null,
    resolution: typeof rest.resolution === "number" ? rest.resolution : null,
    organism: typeof rest.organism === "string" ? rest.organism : null,
    ligand: typeof rest.ligand === "string" ? rest.ligand : null,
    sourcePassage:
      typeof rest.sourcePassage === "string" ? rest.sourcePassage : null,
  };
}

/** Returns the LLM provider name used by the last extractClaims call. */
export { getActiveLLMProvider };
