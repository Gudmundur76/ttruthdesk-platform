/**
 * verticalAdapters/crossRef.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * CrossRef adapter — domain-agnostic DOI and citation verification.
 *
 * CrossRef indexes 130M+ DOIs across ALL academic disciplines (science,
 * engineering, humanities, law, economics, medicine). This adapter makes
 * the engine domain-agnostic: any claim that references a DOI or a
 * citable work can be verified regardless of domain.
 *
 * API: https://api.crossref.org/works/{doi}  (no auth required)
 * Rate limit: 50 req/s polite pool (with User-Agent mailto header)
 *
 * Lookup strategy:
 *   1. Extract DOI from claim text (doi:10.xxx or https://doi.org/10.xxx)
 *   2. If no DOI, search CrossRef by title/keyword
 *   3. Return metadata: title, authors, journal, year, abstract, citations
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";

const CROSSREF_BASE = "https://api.crossref.org";
const POLITE_MAILTO = "citation-engine@citation.is";

const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/gi;

interface CrossRefWork {
  DOI: string;
  title?: string[];
  abstract?: string;
  author?: Array<{ given?: string; family?: string }>;
  "container-title"?: string[];
  published?: { "date-parts": number[][] };
  "is-referenced-by-count"?: number;
  score?: number;
  URL?: string;
  type?: string;
  subject?: string[];
}

async function lookupByDoi(doi: string): Promise<EvidenceResult> {
  const start = Date.now();
  try {
    const res = await fetch(
      `${CROSSREF_BASE}/works/${encodeURIComponent(doi)}`,
      {
        headers: {
          "User-Agent": `citation-engine/1.0 (${POLITE_MAILTO})`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) {
      return {
        found: false,
        sourceId: doi,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.2,
        confidenceFlags: [`CrossRef DOI ${doi} not found (HTTP ${res.status})`],
      };
    }
    const json = (await res.json()) as { message: CrossRefWork };
    const work = json.message;
    const title = work.title?.[0] ?? "Unknown title";
    const journal = work["container-title"]?.[0] ?? null;
    const year = work.published?.["date-parts"]?.[0]?.[0] ?? null;
    const citations = work["is-referenced-by-count"] ?? 0;
    const latencyMs = Date.now() - start;

    // Confidence: higher for well-cited, peer-reviewed works
    let confidence = 0.75;
    if (citations > 100) confidence = 0.92;
    else if (citations > 10) confidence = 0.85;
    if (work.abstract) confidence = Math.min(confidence + 0.05, 0.97);

    return {
      found: true,
      sourceId: doi,
      sourceUrl: `https://doi.org/${doi}`,
      evidenceRaw: {
        doi,
        title,
        journal,
        year,
        citations,
        abstract: work.abstract ?? null,
        type: work.type ?? null,
        subjects: work.subject ?? [],
        latencyMs,
      },
      confidenceScore: confidence,
      confidenceFlags: [],
    };
  } catch (err) {
    return {
      found: false,
      sourceId: doi,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.1,
      confidenceFlags: [`CrossRef lookup failed: ${String(err)}`],
    };
  }
}

async function searchByKeyword(query: string): Promise<EvidenceResult> {
  try {
    const params = new URLSearchParams({
      query,
      rows: "3",
      select: "DOI,title,abstract,author,container-title,published,is-referenced-by-count,score,type,subject",
      mailto: POLITE_MAILTO,
    });
    const res = await fetch(`${CROSSREF_BASE}/works?${params}`, {
      headers: {
        "User-Agent": `citation-engine/1.0 (${POLITE_MAILTO})`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.15,
        confidenceFlags: [`CrossRef search failed (HTTP ${res.status})`],
      };
    }
    const json = (await res.json()) as { message: { items: CrossRefWork[] } };
    const items = json.message.items ?? [];
    if (items.length === 0) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ["CrossRef: no results for query"],
      };
    }
    const best = items[0];
    const doi = best.DOI;
    const title = best.title?.[0] ?? "Unknown";
    const score = best.score ?? 0;
    // Low relevance threshold — if score < 20 the match is likely spurious
    if (score < 20) {
      return {
        found: false,
        sourceId: doi,
        sourceUrl: `https://doi.org/${doi}`,
        evidenceRaw: { doi, title, score, note: "low relevance score" },
        confidenceScore: 0.25,
        confidenceFlags: [`CrossRef search: low relevance score (${score.toFixed(1)})`],
      };
    }
    return {
      found: true,
      sourceId: doi,
      sourceUrl: `https://doi.org/${doi}`,
      evidenceRaw: {
        doi,
        title,
        journal: best["container-title"]?.[0] ?? null,
        year: best.published?.["date-parts"]?.[0]?.[0] ?? null,
        citations: best["is-referenced-by-count"] ?? 0,
        abstract: best.abstract ?? null,
        type: best.type ?? null,
        subjects: best.subject ?? [],
        relevanceScore: score,
      },
      confidenceScore: Math.min(0.5 + score / 200, 0.85),
      confidenceFlags: [`CrossRef keyword search (relevance: ${score.toFixed(1)})`],
    };
  } catch (err) {
    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.1,
      confidenceFlags: [`CrossRef search exception: ${String(err)}`],
    };
  }
}

const crossRefAdapter: VerticalAdapter = {
  domainKey: "crossref",
  displayName: "CrossRef (All Academic Disciplines)",
  description:
    "Verifies claims against CrossRef's index of 130M+ DOIs spanning all academic " +
    "disciplines: science, engineering, medicine, law, economics, humanities, and more. " +
    "Extracts DOIs from claim text for direct lookup; falls back to keyword search. " +
    "This adapter makes the engine domain-agnostic — any citable claim can be verified.",

  claimExtractorPrompt: `
You are a universal academic claim extractor. Extract every verifiable factual claim from the text.
Focus on:
- Claims that reference a specific study, paper, or publication (with or without an explicit DOI)
- Statistical claims: percentages, effect sizes, p-values, confidence intervals
- Causal claims: "X causes Y", "X reduces Y by Z%"
- Comparative claims: "X is more effective than Y"
- Definitional claims: "X is defined as Y" (when the definition is contested or domain-specific)
- Temporal claims: "X was first demonstrated in [year]"
For each claim, extract:
- The exact claim text
- Any DOI mentioned (format: 10.xxxx/xxxxx)
- The source title or author if mentioned
- The domain/field of the claim
`,

  async lookupEvidence(claim) {
    // 1. Try to extract a DOI from the claim text
    const doiMatches = Array.from(claim.claimText.matchAll(DOI_RE));
    const doi = claim.extractedValue?.match(/^10\.\d{4,}\//)?.[0]
      ? claim.extractedValue
      : doiMatches[0]?.[1] ?? null;

    if (doi) {
      return lookupByDoi(doi);
    }

    // 2. Fall back to keyword search using the claim text
    const query = claim.claimText.substring(0, 200);
    return searchByKeyword(query);
  },

  discoverySearchTerms: [
    // CrossRef is queried via the PMC/PubMed feed system for domain-specific verticals.
    // These terms are used by the generic discovery loop for cross-domain coverage.
    "systematic review meta-analysis",
    "randomized controlled trial",
    "observational study cohort",
    "clinical guideline evidence-based",
    "retraction correction erratum",
  ],
};

registerVertical(crossRefAdapter);
