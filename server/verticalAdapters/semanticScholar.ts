/**
 * verticalAdapters/semanticScholar.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Semantic Scholar adapter — 200M+ papers with semantic search and citation graph.
 *
 * Semantic Scholar (Allen Institute for AI) provides:
 *   - Semantic search (not just keyword matching)
 *   - Citation graph: references and citations
 *   - Influential citations flag
 *   - TL;DR auto-generated summaries
 *   - Open access PDFs
 *   - Fields of study classification
 *
 * API: https://api.semanticscholar.org/graph/v1  (no auth for 100 req/5min)
 * Supports: DOI, arXiv ID, PubMed ID, Semantic Scholar ID
 *
 * Lookup strategy:
 *   1. Direct paper lookup by DOI or PMID
 *   2. Semantic search by claim text
 *   3. Returns influential citations count as a quality signal
 */
/**
 * Sprint 36 (Relevance Quality): added post-retrieval relevance gate on the
 * semantic search path. Semantic Scholar's ranking is good but not infallible;
 * we apply a lower threshold (SEMANTIC_RELEVANCE_THRESHOLD) to only reject
 * clearly off-topic results.
 */
import {
  registerVertical,
  type VerticalAdapter,
  type EvidenceResult,
} from "./types";
import {
  isRelevant,
  relevanceAdjustedConfidence,
  SEMANTIC_RELEVANCE_THRESHOLD,
} from "./relevanceUtils";

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const PAPER_FIELDS =
  "paperId,externalIds,title,abstract,year,citationCount,influentialCitationCount,fieldsOfStudy,tldr,openAccessPdf,publicationTypes,journal";

const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/gi;
const PMID_RE = /\bPMID:?\s*(\d{6,9})\b/i;

interface S2Paper {
  paperId: string;
  externalIds?: { DOI?: string; PubMed?: string; ArXiv?: string };
  title?: string;
  abstract?: string;
  year?: number;
  citationCount?: number;
  influentialCitationCount?: number;
  fieldsOfStudy?: string[];
  tldr?: { text: string };
  openAccessPdf?: { url: string };
  publicationTypes?: string[];
  journal?: { name?: string };
}

// eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
async function lookupByIdentifier(identifier: string): Promise<EvidenceResult> {
  try {
    // Retry up to 2 times on 429 rate-limit responses with exponential backoff
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1500));
      res = await fetch(
        `${S2_BASE}/paper/${encodeURIComponent(identifier)}?fields=${PAPER_FIELDS}`,
        {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (res.status !== 429) break;
    }
    if (!res) res = { ok: false, status: 0, json: async () => ({}) } as unknown as Response;
    if (!res.ok) {
      return {
        found: false,
        sourceId: identifier,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.2,
        confidenceFlags: [
          `Semantic Scholar: ${identifier} not found (HTTP ${res.status})`,
        ],
      };
    }
    const paper = (await res.json()) as S2Paper;
    const doi = paper.externalIds?.DOI ?? null;
    const influential = paper.influentialCitationCount ?? 0;
    const citations = paper.citationCount ?? 0;

    // Influential citations are a strong quality signal
    let confidence = 0.75;
    if (influential > 50) confidence = 0.95;
    else if (influential > 10) confidence = 0.88;
    else if (citations > 100) confidence = 0.85;
    if (paper.tldr?.text) confidence = Math.min(confidence + 0.03, 0.97);

    return {
      found: true,
      sourceId: paper.paperId,
      sourceUrl: doi
        ? `https://doi.org/${doi}`
        : `https://www.semanticscholar.org/paper/${paper.paperId}`,
      evidenceRaw: {
        s2Id: paper.paperId,
        doi,
        pmid: paper.externalIds?.PubMed ?? null,
        arxivId: paper.externalIds?.ArXiv ?? null,
        title: paper.title ?? null,
        abstract: paper.abstract ?? null,
        tldr: paper.tldr?.text ?? null,
        year: paper.year ?? null,
        citations,
        influentialCitations: influential,
        fieldsOfStudy: paper.fieldsOfStudy ?? [],
        journal: paper.journal?.name ?? null,
        isOpenAccess: !!paper.openAccessPdf,
        oaUrl: paper.openAccessPdf?.url ?? null,
        publicationTypes: paper.publicationTypes ?? [],
      },
      confidenceScore: confidence,
      confidenceFlags:
        influential > 0 ? [`${influential} influential citations`] : [],
    };
  } catch (err) {
    return {
      found: false,
      sourceId: identifier,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.1,
      confidenceFlags: [`Semantic Scholar lookup failed: ${String(err)}`],
    };
  }
}

async function semanticSearch(query: string): Promise<EvidenceResult> {
  try {
    const params = new URLSearchParams({
      query: query.substring(0, 200),
      limit: "3",
      fields: PAPER_FIELDS,
    });
    const res = await fetch(`${S2_BASE}/paper/search?${params}`, {
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
        confidenceFlags: [
          `Semantic Scholar search failed (HTTP ${res.status})`,
        ],
      };
    }
    const json = (await res.json()) as { data: S2Paper[]; total: number };
    const results = json.data ?? [];
    if (results.length === 0) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ["Semantic Scholar: no results for query"],
      };
    }
    const best = results[0];
    const doi = best.externalIds?.DOI ?? null;
    const influential = best.influentialCitationCount ?? 0;
    const title = best.title ?? null;
    const abstract = best.abstract ?? null;

    // ── Sprint 36: Relevance gate ──────────────────────────────────────────────
    // Semantic Scholar does semantic ranking, so we use a lower threshold
    // than keyword-only adapters. We only reject clearly off-topic results.
    if (!isRelevant(query, title, abstract, SEMANTIC_RELEVANCE_THRESHOLD)) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ["low_relevance", "semantic_search_result_rejected"],
      };
    }
    // ─────────────────────────────────────────────────────────────────────

    const baseConfidence = 0.62;
    const adjustedConfidence = relevanceAdjustedConfidence(
      baseConfidence,
      query,
      title,
      abstract
    );

    return {
      found: true,
      sourceId: best.paperId,
      sourceUrl: doi
        ? `https://doi.org/${doi}`
        : `https://www.semanticscholar.org/paper/${best.paperId}`,
      evidenceRaw: {
        s2Id: best.paperId,
        doi,
        title,
        abstract,
        tldr: best.tldr?.text ?? null,
        year: best.year ?? null,
        citations: best.citationCount ?? 0,
        influentialCitations: influential,
        fieldsOfStudy: best.fieldsOfStudy ?? [],
        journal: best.journal?.name ?? null,
        totalResults: json.total,
      },
      confidenceScore: adjustedConfidence,
      confidenceFlags: [
        "Semantic Scholar semantic search (best match)",
        ...(influential > 0 ? [`${influential} influential citations`] : []),
      ],
    };
  } catch (err) {
    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.1,
      confidenceFlags: [`Semantic Scholar search exception: ${String(err)}`],
    };
  }
}

const semanticScholarAdapter: VerticalAdapter = {
  domainKey: "semantic_scholar",
  displayName: "Semantic Scholar (AI-Powered Literature Search)",
  description:
    "Verifies claims against Semantic Scholar's index of 200M+ papers using semantic " +
    "search (not just keyword matching). Provides influential citation counts, TL;DR " +
    "summaries, and field-of-study classification. Particularly strong for AI, computer " +
    "science, biomedical, and interdisciplinary claims.",

  claimExtractorPrompt: `
You are a scientific claim extractor with expertise in identifying claims that require literature verification.
Extract every verifiable factual claim from the text, with special attention to:
- Claims about AI, machine learning, and computer science research
- Interdisciplinary claims that span multiple fields
- Claims about research methodology and statistical validity
- Claims about the state of scientific consensus
- Claims that cite specific papers, authors, or research groups
- Claims about the reproducibility or replication of findings
For each claim, extract:
- The exact claim text
- Any paper identifier (DOI, arXiv ID, PMID, Semantic Scholar ID)
- The research domain or field
- Whether the claim is about a specific finding or a broader consensus
`,

  async lookupEvidence(claim) {
    // 1. Try DOI
    const doiMatches = Array.from(claim.claimText.matchAll(DOI_RE));
    const doi = doiMatches[0]?.[1] ?? null;
    if (doi) return lookupByIdentifier(`DOI:${doi}`);

    // 2. Try PMID
    const pmidMatch = claim.claimText.match(PMID_RE);
    if (pmidMatch) return lookupByIdentifier(`PMID:${pmidMatch[1]}`);

    // 3. Try arXiv pattern
    const arxivMatch = claim.claimText.match(/\barXiv:(\d{4}\.\d{4,5})\b/i);
    if (arxivMatch) return lookupByIdentifier(`ARXIV:${arxivMatch[1]}`);

    // 4. Semantic search
    return semanticSearch(claim.claimText);
  },

  discoverySearchTerms: [
    "deep learning neural network benchmark",
    "large language model evaluation",
    "reproducibility replication crisis",
    "systematic review methodology",
    "causal inference observational study",
    "climate model projection uncertainty",
    "drug efficacy randomized trial",
    "economic inequality measurement",
  ],
};

registerVertical(semanticScholarAdapter);
