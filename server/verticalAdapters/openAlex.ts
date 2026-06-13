/**
 * verticalAdapters/openAlex.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenAlex adapter — 250M+ scholarly works, fully open, cross-domain.
 *
 * OpenAlex is the successor to Microsoft Academic Graph and the most
 * comprehensive open scholarly index. It covers all disciplines and provides:
 *   - Full citation graph (cited_by_count, references)
 *   - Concept/field classification (with confidence scores)
 *   - Open access availability
 *   - Institution and author disambiguation
 *   - Abstract (via inverted index)
 *
 * API: https://api.openalex.org/works  (no auth required, 10 req/s)
 * Polite pool: add mailto to get 100k req/day
 *
 * Lookup strategy:
 *   1. DOI direct lookup via https://api.openalex.org/works/doi:{doi}
 *   2. Title/keyword search via /works?search=...
 *   3. Returns concept tags for domain classification
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";

const OPENALEX_BASE = "https://api.openalex.org";
const POLITE_MAILTO = "citation-engine@citation.is";

const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/gi;

interface OpenAlexWork {
  id: string;
  doi?: string;
  title?: string;
  abstract_inverted_index?: Record<string, number[]>;
  publication_year?: number;
  cited_by_count?: number;
  concepts?: Array<{ display_name: string; score: number; level: number }>;
  primary_location?: {
    source?: { display_name?: string; type?: string };
    is_oa?: boolean;
  };
  open_access?: { is_oa?: boolean; oa_url?: string };
  authorships?: Array<{
    author?: { display_name?: string };
    institutions?: Array<{ display_name?: string }>;
  }>;
  type?: string;
  referenced_works_count?: number;
}

/** Reconstruct abstract from OpenAlex inverted index format */
function reconstructAbstract(invertedIndex: Record<string, number[]> | undefined): string | null {
  if (!invertedIndex) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  return words.filter(Boolean).join(" ").substring(0, 800);
}

  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
async function lookupByDoi(doi: string): Promise<EvidenceResult> {
  try {
    const res = await fetch(
      `${OPENALEX_BASE}/works/doi:${encodeURIComponent(doi)}?mailto=${POLITE_MAILTO}`,
      {
        headers: { Accept: "application/json" },
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
        confidenceFlags: [`OpenAlex DOI ${doi} not found (HTTP ${res.status})`],
      };
    }
    const work = (await res.json()) as OpenAlexWork;
    const abstract = reconstructAbstract(work.abstract_inverted_index);
    const topConcepts = (work.concepts ?? [])
      .filter(c => c.level <= 2 && c.score > 0.3)
      .slice(0, 5)
      .map(c => c.display_name);
    const citations = work.cited_by_count ?? 0;

    let confidence = 0.78;
    if (citations > 100) confidence = 0.93;
    else if (citations > 20) confidence = 0.87;
    if (abstract) confidence = Math.min(confidence + 0.04, 0.97);

    return {
      found: true,
      sourceId: work.id,
      sourceUrl: work.doi ? `https://doi.org/${work.doi}` : work.id,
      evidenceRaw: {
        openAlexId: work.id,
        doi: work.doi ?? doi,
        title: work.title ?? null,
        abstract,
        year: work.publication_year ?? null,
        citations,
        journal: work.primary_location?.source?.display_name ?? null,
        isOpenAccess: work.open_access?.is_oa ?? false,
        oaUrl: work.open_access?.oa_url ?? null,
        concepts: topConcepts,
        type: work.type ?? null,
      },
      confidenceScore: confidence,
      confidenceFlags: topConcepts.length > 0 ? [`Domains: ${topConcepts.join(", ")}`] : [],
    };
  } catch (err) {
    return {
      found: false,
      sourceId: doi,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.1,
      confidenceFlags: [`OpenAlex DOI lookup failed: ${String(err)}`],
    };
  }
}

async function searchByKeyword(query: string): Promise<EvidenceResult> {
  try {
    const params = new URLSearchParams({
      search: query.substring(0, 200),
      per_page: "3",
      select: "id,doi,title,abstract_inverted_index,publication_year,cited_by_count,concepts,primary_location,open_access,type",
      mailto: POLITE_MAILTO,
    });
    const res = await fetch(`${OPENALEX_BASE}/works?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.15,
        confidenceFlags: [`OpenAlex search failed (HTTP ${res.status})`],
      };
    }
    const json = (await res.json()) as { results: OpenAlexWork[]; meta: { count: number } };
    const results = json.results ?? [];
    if (results.length === 0) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ["OpenAlex: no results for query"],
      };
    }
    const best = results[0];
    const abstract = reconstructAbstract(best.abstract_inverted_index);
    const topConcepts = (best.concepts ?? [])
      .filter(c => c.level <= 2 && c.score > 0.3)
      .slice(0, 5)
      .map(c => c.display_name);

    return {
      found: true,
      sourceId: best.id,
      sourceUrl: best.doi ? `https://doi.org/${best.doi}` : best.id,
      evidenceRaw: {
        openAlexId: best.id,
        doi: best.doi ?? null,
        title: best.title ?? null,
        abstract,
        year: best.publication_year ?? null,
        citations: best.cited_by_count ?? 0,
        journal: best.primary_location?.source?.display_name ?? null,
        isOpenAccess: best.open_access?.is_oa ?? false,
        concepts: topConcepts,
        type: best.type ?? null,
        totalResults: json.meta.count,
      },
      confidenceScore: 0.65,
      confidenceFlags: [
        "OpenAlex keyword search (best match)",
        ...(topConcepts.length > 0 ? [`Domains: ${topConcepts.join(", ")}`] : []),
      ],
    };
  } catch (err) {
    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.1,
      confidenceFlags: [`OpenAlex search exception: ${String(err)}`],
    };
  }
}

const openAlexAdapter: VerticalAdapter = {
  domainKey: "openalex",
  displayName: "OpenAlex (250M+ Scholarly Works)",
  description:
    "Verifies claims against OpenAlex's index of 250M+ scholarly works across all " +
    "academic disciplines. Provides citation counts, concept classification, open access " +
    "availability, and abstract reconstruction. The most comprehensive open scholarly " +
    "index available — covers science, engineering, medicine, law, economics, social " +
    "sciences, and humanities.",

  claimExtractorPrompt: `
You are a cross-domain academic claim extractor. Extract every verifiable factual claim from the text.
Focus on:
- Claims supported by academic literature across ANY field (science, law, economics, history, etc.)
- Quantitative claims with specific values, percentages, or statistics
- Causal or correlational claims between variables
- Claims about consensus or scientific agreement
- Claims about the existence or non-existence of evidence for a position
- Historical or precedent-setting claims
For each claim, extract:
- The exact claim text
- Any DOI, title, or author mentioned
- The academic field or discipline
- Whether the claim is empirical (testable) or normative (value-based)
`,

  async lookupEvidence(claim) {
    // 1. Try DOI extraction
    const doiMatches = Array.from(claim.claimText.matchAll(DOI_RE));
    const doi = claim.extractedValue?.match(/^10\.\d{4,}\//)?.[0]
      ? claim.extractedValue
      : doiMatches[0]?.[1] ?? null;

    if (doi) {
      return lookupByDoi(doi);
    }

    // 2. Keyword search
    return searchByKeyword(claim.claimText);
  },

  discoverySearchTerms: [
    "evidence synthesis systematic review",
    "meta-analysis clinical trial",
    "observational study population",
    "policy evaluation impact assessment",
    "economic analysis cost-benefit",
    "legal precedent judicial review",
    "climate change mitigation adaptation",
    "machine learning artificial intelligence evaluation",
  ],
};

registerVertical(openAlexAdapter);
