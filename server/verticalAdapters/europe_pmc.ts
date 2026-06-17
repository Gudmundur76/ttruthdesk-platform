/**
 * Sprint 36 (Relevance Quality): added post-retrieval relevance gate on the
 * keyword search path to prevent topically-adjacent but claim-irrelevant results.
 * Refactored to reduce cyclomatic complexity below 20 by extracting helpers.
 */
import { VerticalAdapter, EvidenceResult, registerVertical } from "./types";
import { logger } from "../logger";
import {
  isRelevant,
  relevanceAdjustedConfidence,
  MIN_RELEVANCE_THRESHOLD,
} from "./relevanceUtils";

const log = logger("verticalAdapters/europe_pmc");

const PMCID_REGEX = /\b(PMC\d+)\b/i;
const PMID_REGEX = /\b(\d{7,8})\b/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type IdentifierType = "PMID" | "PMCID" | "keyword";

function resolveQuery(claim: {
  claimText: string;
  extractedValue: string | null;
}): {
  query: string;
  identifierType: IdentifierType;
} {
  const pmcidMatch = claim.claimText.match(PMCID_REGEX);
  if (pmcidMatch) return { query: pmcidMatch[1], identifierType: "PMCID" };
  const pmidMatch = claim.claimText.match(PMID_REGEX);
  if (pmidMatch) return { query: pmidMatch[1], identifierType: "PMID" };
  if (claim.extractedValue)
    return { query: claim.extractedValue, identifierType: "keyword" };
  return { query: claim.claimText, identifierType: "keyword" };
}

function computeBaseConfidence(result: Record<string, unknown>): {
  baseConfidence: number;
  confidenceFlags: string[];
} {
  const pubType = result.pubType as string[] | undefined;
  const journalTitle = (
    result.journalInfo as Record<string, Record<string, string>> | undefined
  )?.journal?.title;
  if (!journalTitle) return { baseConfidence: 0.5, confidenceFlags: [] };

  if (pubType?.includes("Review"))
    return { baseConfidence: 0.88, confidenceFlags: ["peer_reviewed"] };
  if (pubType?.includes("Journal Article"))
    return { baseConfidence: 0.88, confidenceFlags: ["peer_reviewed"] };
  if (pubType?.includes("Preprint"))
    return { baseConfidence: 0.72, confidenceFlags: ["preprint"] };
  return { baseConfidence: 0.72, confidenceFlags: ["general_publication"] };
}

function applyIdentifierBoost(
  baseConfidence: number,
  flags: string[],
  identifierType: IdentifierType,
  result: Record<string, unknown>,
  query: string
): { confidence: number; flags: string[] } {
  if (
    identifierType !== "keyword" &&
    (result.pmid === query || result.pmcid === query)
  ) {
    return {
      confidence: Math.min(1.0, baseConfidence + 0.05),
      flags: [...flags, "identifier_match"],
    };
  }
  return { confidence: baseConfidence, flags };
}

function buildSourceUrl(result: Record<string, unknown>): string {
  const fullTextUrls = (
    result.fullTextUrlList as { fullTextUrl?: { url: string }[] } | undefined
  )?.fullTextUrl;
  if (fullTextUrls?.[0]?.url) return fullTextUrls[0].url;
  return `https://europepmc.org/article/MED/${(result.pmid ?? result.pmcid) as string}`;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

const europePmcAdapter: VerticalAdapter = {
  domainKey: "europe_pmc",
  displayName: "Europe PMC",
  description:
    "Adapter for Europe PMC, a repository for life sciences research articles.",
  claimExtractorPrompt:
    "Extract any PubMed ID (PMID) or PubMed Central ID (PMCID) from the following text. If multiple are found, prioritize PMCID. If none are found, return null.",

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const { query, identifierType } = resolveQuery(claim);

    if (!query) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ["no_query_provided"],
      };
    }

    const apiUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json`;

    try {
      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          "User-Agent": "citation-engine/1.0 (citation-engine@citation.is)",
        },
      });

      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      const data = (await response.json()) as {
        hitCount: number;
        resultList?: { result?: Record<string, unknown>[] };
      };

      if (!(data.hitCount > 0 && (data.resultList?.result?.length ?? 0) > 0)) {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.3,
          confidenceFlags: ["no_results_found"],
        };
      }

      const firstResult = data.resultList!.result![0];
      const resultTitle = (firstResult.title as string) ?? "";
      const resultAbstract = (firstResult.abstractText as string) ?? "";

      // ── Sprint 36: Relevance gate (keyword search path only) ──────────────
      if (
        identifierType === "keyword" &&
        !isRelevant(
          claim.claimText,
          resultTitle,
          resultAbstract,
          MIN_RELEVANCE_THRESHOLD
        )
      ) {
        log.debug("Europe PMC keyword result rejected: low relevance", {
          claim: claim.claimText.substring(0, 80),
          resultTitle: resultTitle.substring(0, 80),
        });
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.1,
          confidenceFlags: ["low_relevance", "keyword_search_result_rejected"],
        };
      }
      // ─────────────────────────────────────────────────────────────────────

      const { baseConfidence, confidenceFlags: baseFlags } =
        computeBaseConfidence(firstResult);
      const { confidence: boostedConfidence, flags: boostedFlags } =
        applyIdentifierBoost(
          baseConfidence,
          baseFlags,
          identifierType,
          firstResult,
          query
        );

      const confidence =
        identifierType === "keyword"
          ? relevanceAdjustedConfidence(
              boostedConfidence,
              claim.claimText,
              resultTitle,
              resultAbstract
            )
          : boostedConfidence;

      return {
        found: true,
        sourceId: (firstResult.pmid ?? firstResult.pmcid ?? null) as
          | string
          | null,
        sourceUrl: buildSourceUrl(firstResult),
        evidenceRaw: firstResult,
        confidenceScore: confidence,
        confidenceFlags:
          boostedFlags.length > 0 ? boostedFlags : ["found_via_keyword_search"],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Error fetching from Europe PMC: ${msg}`);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.2,
        confidenceFlags: ["network_error", msg],
      };
    }
  },

  discoverySearchTerms: [
    "European biomedical literature",
    "open access research",
    "life sciences",
    "clinical studies",
    "molecular biology",
    "biomedical research",
    "medical journals",
    "public health",
    "genetics",
    "pharmacology",
  ],
};

registerVertical(europePmcAdapter);
