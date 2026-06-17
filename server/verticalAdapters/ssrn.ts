/**
 * ssrn.ts — Sprint 35
 *
 * SSRN (Social Science Research Network) adapter.
 * Queries SSRN for working papers and preprints in economics, law,
 * finance, accounting, management, and social sciences.
 *
 * Primary: CrossRef API filtered to SSRN papers (DOI prefix 10.2139)
 * Fallback: Semantic Scholar with SSRN venue filter
 */

import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/ssrn");

interface CrossRefWork {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string }>;
  "container-title"?: string[];
  ISSN?: string[];
  published?: { "date-parts"?: number[][] };
  abstract?: string;
  URL?: string;
  score?: number;
  type?: string;
  institution?: Array<{ name?: string }>;
}

interface CrossRefResponse {
  message?: {
    items?: CrossRefWork[];
    "total-results"?: number;
  };
}

interface SemanticScholarPaper {
  paperId?: string;
  title?: string;
  abstract?: string;
  year?: number;
  authors?: Array<{ name?: string }>;
  externalIds?: { DOI?: string; SSRN?: string };
  venue?: string;
  url?: string;
}

interface SemanticScholarResponse {
  data?: SemanticScholarPaper[];
  total?: number;
}

const CROSSREF_API = "https://api.crossref.org/works";
const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1/paper/search";
const SSRN_DOI_PREFIX = "10.2139/ssrn.";

function noResult(flags: string[]): EvidenceResult {
  return {
    found: false,
    sourceId: null,
    sourceUrl: null,
    evidenceRaw: null,
    confidenceScore: 0,
    confidenceFlags: flags,
  };
}

function isSsrnDoi(doi: string | undefined): boolean {
  return !!doi && doi.startsWith(SSRN_DOI_PREFIX);
}

function formatAuthors(authors: CrossRefWork["author"]): string {
  if (!authors?.length) return "Unknown";
  return authors
    .slice(0, 3)
    .map((a) => `${a.family ?? ""}, ${(a.given ?? "").charAt(0)}.`)
    .join("; ") + (authors.length > 3 ? " et al." : "");
}

function getPublicationYear(work: CrossRefWork): number | null {
  const parts = work.published?.["date-parts"]?.[0];
  return parts?.[0] ?? null;
}

class SsrnAdapter implements VerticalAdapter {
  readonly domainKey = "ssrn";
  readonly displayName = "SSRN (Social Science Research Network)";
  readonly description =
    "SSRN — working papers and preprints in economics, law, finance, accounting, management, and social sciences. Largest repository of social science research papers.";
  readonly claimExtractorPrompt =
    "Extract economic theories, legal arguments, financial models, accounting standards, management strategies, or social science hypotheses from the claim.";
  readonly discoverySearchTerms = [
    "working paper economics",
    "SSRN preprint",
    "law review article",
    "finance research paper",
    "social science working paper",
    "economics preprint",
    "management research",
    "accounting research",
    "policy working paper",
    "NBER working paper",
  ];

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    log.info("SSRN query", { query });

    // Try CrossRef with SSRN DOI prefix filter first
    const crossRefResult = await this.searchCrossRef(query);
    if (crossRefResult.found) return crossRefResult;

    // Fall back to Semantic Scholar
    return this.searchSemanticScholar(query);
  }

  private buildCrossRefResult(
    top: CrossRefWork,
    items: CrossRefWork[],
    totalResults: number,
    query: string
  ): EvidenceResult {
    const doi = top.DOI;
    const title = top.title?.[0] ?? "Unknown title";
    const authors = formatAuthors(top.author);
    const year = getPublicationYear(top);
    const isSsrn = isSsrnDoi(doi);

    const flags = ["social_science", "preprint", "working_paper"];
    if (isSsrn) flags.push("ssrn_paper");

    const ssrnId = doi?.replace(SSRN_DOI_PREFIX, "");
    const sourceUrl = ssrnId
      ? `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${ssrnId}`
      : doi
        ? `https://doi.org/${doi}`
        : `https://ssrn.com/search?query=${encodeURIComponent(query)}`;

    log.info("SSRN CrossRef result", { doi, title, isSsrn });

    return {
      found: true,
      sourceId: ssrnId ? `ssrn-${ssrnId}` : `ssrn-doi-${doi?.replace(/[^a-zA-Z0-9]/g, "-")}`,
      sourceUrl,
      evidenceRaw: { doi, ssrnId, title, authors, year, totalResults },
      confidenceScore: isSsrn ? 0.82 : 0.68,
      confidenceFlags: flags,
    };
  }

  private async searchCrossRef(query: string): Promise<EvidenceResult> {
    try {
      const params = new URLSearchParams({
        query,
        rows: "5",
        filter: "prefix:10.2139",
        "mailto": "contact@citation.is",
      });

      const url = `${CROSSREF_API}?${params.toString()}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        return noResult([`crossref_error_${res.status}`]);
      }

      const data = (await res.json()) as CrossRefResponse;
      const items = data?.message?.items ?? [];

      if (!items.length) {
        return noResult(["no_ssrn_crossref_results"]);
      }

      return this.buildCrossRefResult(
        items[0],
        items,
        data?.message?.["total-results"] ?? items.length,
        query
      );
    } catch (err) {
      log.error("SSRN CrossRef error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }

  private async searchSemanticScholar(query: string): Promise<EvidenceResult> {
    try {
      const params = new URLSearchParams({
        query,
        limit: "3",
        fields: "paperId,title,abstract,year,authors,externalIds,venue,url",
      });

      const url = `${SEMANTIC_SCHOLAR_API}?${params.toString()}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        if (res.status === 429) {
          return noResult(["semantic_scholar_rate_limited"]);
        }
        return noResult([`semantic_scholar_error_${res.status}`]);
      }

      const data = (await res.json()) as SemanticScholarResponse;
      const papers = data?.data ?? [];

      if (!papers.length) {
        return noResult(["no_semantic_scholar_results"]);
      }

      // Prefer papers with SSRN IDs
      const ssrnPapers = papers.filter((p) => p.externalIds?.SSRN);
      const top = ssrnPapers[0] ?? papers[0];
      const isSsrn = !!top.externalIds?.SSRN;

      const ssrnId = top.externalIds?.SSRN;
      const doi = top.externalIds?.DOI;
      const title = top.title ?? "Unknown title";
      const authors = top.authors?.slice(0, 3).map((a) => a.name).join("; ") ?? "Unknown";

      const flags = ["social_science", "preprint"];
      if (isSsrn) flags.push("ssrn_paper", "working_paper");

      const sourceUrl = ssrnId
        ? `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=${ssrnId}`
        : top.url ?? `https://ssrn.com/search?query=${encodeURIComponent(query)}`;

      log.info("SSRN Semantic Scholar result", { paperId: top.paperId, title, isSsrn });

      return {
        found: true,
        sourceId: ssrnId ? `ssrn-${ssrnId}` : `ssrn-ss-${top.paperId}`,
        sourceUrl,
        evidenceRaw: {
          paperId: top.paperId,
          ssrnId,
          doi,
          title,
          authors,
          year: top.year,
          abstract: top.abstract?.slice(0, 500),
          venue: top.venue,
        },
        confidenceScore: isSsrn ? 0.80 : 0.65,
        confidenceFlags: flags,
      };
    } catch (err) {
      log.error("SSRN Semantic Scholar error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }
}

registerVertical(new SsrnAdapter());
