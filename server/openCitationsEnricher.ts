/**
 * openCitationsEnricher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Stage 3.5 — OpenCitations DOI enrichment helper.
 *
 * Called from analysisPipeline.ts inside the Stage 7 composite-truth loop,
 * once per claim that has a DOI in its text or extractedValue.
 *
 * Returns:
 *   { citationAuthorityScore: number, isRetracted: boolean } when a DOI is
 *   found and the OC lookup succeeds.
 *
 *   null when no DOI is present (claim is not a citation claim) or the lookup
 *   returns found:false.
 *
 * Design constraints:
 *   - Pure function wrapper — no DB writes, no side effects.
 *   - Graceful degradation: returns null on any error.
 *   - Does not call the OC adapter directly; uses the registered vertical
 *     adapter so the same mock path works in tests.
 */

import { logger, errData } from "./logger";

const log = logger("openCitationsEnricher");

/** DOI regex — same pattern as opencitations.ts for consistency */
const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/gi;

export interface OcEnrichmentResult {
  /** Citation authority score [0, 1] from OpenCitations confidence model */
  citationAuthorityScore: number;
  /** True when the OC lookup flagged a retraction notice */
  isRetracted: boolean;
  /** Raw citation count (0 if unavailable) */
  citationCount: number;
  /** DOI that was looked up */
  doi: string;
}

/**
 * Enrich a single claim with OpenCitations citation authority data.
 *
 * @param claimText   The claim text to scan for a DOI.
 * @param extractedValue  The extracted value from the claim extractor (may contain DOI).
 * @returns OcEnrichmentResult when a DOI is found and the lookup succeeds, null otherwise.
 */
export async function openCitationsEnrichClaim(
  claimText: string,
  extractedValue: string | null | undefined
): Promise<OcEnrichmentResult | null> {
  // 1. Extract DOI from extractedValue or claim text
  const doiFromValue =
    extractedValue && /^10\.\d{4,}\//.test(extractedValue)
      ? extractedValue
      : null;
  const doiMatches = Array.from(claimText.matchAll(DOI_RE));
  const doi = doiFromValue ?? doiMatches[0]?.[1] ?? null;

  if (!doi) {
    // No DOI in this claim — not a citation claim, skip enrichment
    return null;
  }

  try {
    // Lazy-import the vertical adapter registry to avoid circular deps at module load time
    const { getVertical } = await import("./verticalAdapters/types");
    const adapter = getVertical("opencitations");

    if (!adapter) {
      log.warn("[Stage3.5/OC] OpenCitations adapter not registered — skipping enrichment");
      return null;
    }

    const evidence = await adapter.lookupEvidence({
      claimText,
      extractedValue: doi,
    });

    if (!evidence.found) {
      return null;
    }

    // Detect retraction flag from confidenceFlags
    const flags = evidence.confidenceFlags ?? [];
    const isRetracted = flags.some(f =>
      f.toLowerCase().includes("retraction")
    );

    // Extract citation count from evidenceRaw if available
    const raw = evidence.evidenceRaw as Record<string, unknown> | null;
    const citationCount =
      typeof raw?.citationCount === "number" ? raw.citationCount : 0;

    return {
      citationAuthorityScore: evidence.confidenceScore,
      isRetracted,
      citationCount,
      doi,
    };
  } catch (err) {
    log.warn("[Stage3.5/OC] Enrichment lookup error (non-fatal):", errData(err));
    return null;
  }
}
