/**
 * Sprint 36 (Relevance Quality): added post-retrieval relevance gate on the
 * keyword search path to prevent topically-adjacent but claim-irrelevant results.
 * Refactored to reduce cyclomatic complexity below 20 by extracting helpers.
 */
import { registerVertical, VerticalAdapter, EvidenceResult } from "./types";
import { logger } from "../logger";
import {
  isRelevant,
  relevanceAdjustedConfidence,
  MIN_RELEVANCE_THRESHOLD,
} from "./relevanceUtils";

const log = logger("verticalAdapters/arxiv");
const ARXIV_ID_REGEX = /(\d{4}\.\d{4,5})/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildArxivQuery(claim: {
  claimText: string;
  extractedValue: string | null;
}): string {
  const idMatch = claim.claimText.match(ARXIV_ID_REGEX);
  if (idMatch?.[1]) return `id:${idMatch[1]}`;
  if (claim.extractedValue) return claim.extractedValue;
  return claim.claimText;
}

function parseArxivEntry(entry: Element): {
  title: string;
  summary: string;
  arxivId: string | null;
  primaryLink: string | null;
  journalRef: string | null;
} {
  const title = entry.querySelector("title")?.textContent ?? "No Title";
  const summary = entry.querySelector("summary")?.textContent ?? "No Summary";
  const idLink = entry.querySelector("id")?.textContent ?? "";
  const arxivId = idLink.split("/").pop() ?? null;
  const primaryLink =
    entry.querySelector('link[rel="alternate"]')?.getAttribute("href") ?? null;
  const journalRef =
    entry.querySelector("arxiv\\:journal_ref, journal_ref")?.textContent ??
    null;
  return { title, summary, arxivId, primaryLink, journalRef };
}

function computeArxivConfidence(
  isIdLookup: boolean,
  journalRef: string | null,
  claimText: string,
  title: string,
  summary: string
): { confidenceScore: number; confidenceFlags: string[] } {
  const confidenceFlags: string[] = ["arxiv_preprint"];
  let baseConfidence = 0.65;
  if (journalRef) {
    baseConfidence = 0.8;
    confidenceFlags.push("published_journal_reference");
  }
  const confidenceScore = isIdLookup
    ? baseConfidence
    : relevanceAdjustedConfidence(baseConfidence, claimText, title, summary);
  return { confidenceScore, confidenceFlags };
}

async function fetchArxivXml(apiUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "citation-engine/1.0 (citation-engine@citation.is)",
        Accept: "application/atom+xml",
      },
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

const arxivAdapter: VerticalAdapter = {
  domainKey: "arxiv",
  displayName: "arXiv preprints",
  description: "Adapter for https://arxiv.org/",
  claimExtractorPrompt:
    "Extract any arXiv IDs (e.g., 1234.56789) or keywords from the following claim for searching scientific preprints.",
  discoverySearchTerms: [
    "machine learning",
    "physics",
    "mathematics",
    "computer science",
    "quantitative biology",
  ],

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = buildArxivQuery(claim);

    if (!query) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.0,
        confidenceFlags: ["no_search_query_generated"],
      };
    }

    const apiUrl = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=3`;

    try {
      const xmlText = await fetchArxivXml(apiUrl);
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "application/xml");
      const entries = xmlDoc.querySelectorAll("entry");

      if (entries.length === 0) {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.1,
          confidenceFlags: ["no_arxiv_entries_found"],
        };
      }

      const { title, summary, arxivId, primaryLink, journalRef } =
        parseArxivEntry(entries[0]);
      const isIdLookup = Boolean(claim.claimText.match(ARXIV_ID_REGEX));

      // ── Sprint 36: Relevance gate (keyword search path only) ──────────────
      if (
        !isIdLookup &&
        !isRelevant(claim.claimText, title, summary, MIN_RELEVANCE_THRESHOLD)
      ) {
        log.debug("arXiv keyword result rejected: low relevance", {
          claim: claim.claimText.substring(0, 80),
          title: title.substring(0, 80),
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

      const { confidenceScore, confidenceFlags } = computeArxivConfidence(
        isIdLookup,
        journalRef,
        claim.claimText,
        title,
        summary
      );

      return {
        found: true,
        sourceId: arxivId,
        sourceUrl: primaryLink,
        evidenceRaw: { title, summary, arxivId, primaryLink, journalRef },
        confidenceScore,
        confidenceFlags,
      };
    } catch (error: unknown) {
      log.error(`Error fetching from arXiv: ${(error as Error).message}`);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.2,
        confidenceFlags: ["network_error_or_api_failure"],
      };
    }
  },
};

registerVertical(arxivAdapter);
