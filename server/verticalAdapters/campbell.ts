/**
 * campbell.ts — Sprint 35
 *
 * Campbell Collaboration adapter.
 * Queries the Campbell Collaboration for systematic reviews and
 * meta-analyses in social science, education, crime, and international development.
 *
 * API: https://www.campbellcollaboration.org/api/
 * Docs: https://www.campbellcollaboration.org/
 */

import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/campbell");

interface CampbellReview {
  id: number;
  title: string;
  abstract?: string;
  doi?: string;
  url?: string;
  published_at?: string;
  authors?: string[];
  group?: string;
  status?: string;
  type?: string;
}

interface CampbellSearchResponse {
  data?: CampbellReview[];
  meta?: {
    total?: number;
    per_page?: number;
    current_page?: number;
  };
}

const CAMPBELL_API_BASE = "https://www.campbellcollaboration.org/api";

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

class CampbellAdapter implements VerticalAdapter {
  readonly domainKey = "campbell";
  readonly displayName = "Campbell Collaboration";
  readonly description =
    "Campbell Collaboration — systematic reviews and meta-analyses in social science, education, crime and justice, and international development. Gold standard for evidence-based policy.";
  readonly claimExtractorPrompt =
    "Extract social policy interventions, educational programs, crime prevention strategies, or development programs from the claim. Focus on causal claims about what works in social policy.";
  readonly discoverySearchTerms = [
    "systematic review social science",
    "meta-analysis education",
    "evidence-based policy",
    "crime prevention intervention",
    "social program effectiveness",
    "Campbell Collaboration review",
    "international development evidence",
    "what works social policy",
  ];

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    log.info("Campbell query", { query });

    return this.searchReviews(query);
  }

  private async searchReviews(query: string): Promise<EvidenceResult> {
    try {
      // Campbell Collaboration public search API
      const url = `${CAMPBELL_API_BASE}/reviews?q=${encodeURIComponent(query)}&per_page=3&page=1`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "citation.is/1.0 (evidence verification; contact@citation.is)",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        if (res.status === 404) {
          return noResult(["campbell_not_found"]);
        }
        if (res.status === 429) {
          return noResult(["campbell_rate_limited"]);
        }
        return noResult([`http_error_${res.status}`]);
      }

      const data = (await res.json()) as CampbellSearchResponse;
      const reviews = data?.data ?? [];

      if (!reviews.length) {
        return noResult(["no_campbell_reviews"]);
      }

      const top = reviews[0];
      const flags = ["campbell_systematic_review", "social_science", "evidence_synthesis"];

      if (top.status === "published") flags.push("published_review");
      if (top.type === "systematic_review") flags.push("systematic_review");
      if (top.type === "meta_analysis") flags.push("meta_analysis");

      const reviewUrl = top.url ?? `https://www.campbellcollaboration.org/library/${top.id}`;

      log.info("Campbell result", {
        id: top.id,
        title: top.title,
        group: top.group,
      });

      return {
        found: true,
        sourceId: `campbell-${top.id}`,
        sourceUrl: reviewUrl,
        evidenceRaw: {
          id: top.id,
          title: top.title,
          abstract: top.abstract?.slice(0, 500),
          doi: top.doi,
          publishedAt: top.published_at,
          group: top.group,
          status: top.status,
          type: top.type,
          totalResults: data?.meta?.total ?? reviews.length,
        },
        confidenceScore: 0.88,
        confidenceFlags: flags,
      };
    } catch (err) {
      log.error("Campbell fetch error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }
}

registerVertical(new CampbellAdapter());
