import { registerVertical, EvidenceResult, VerticalAdapter } from './types';

class CochraneAdapter implements VerticalAdapter {
  readonly domainKey = 'cochrane';
  readonly displayName = 'Cochrane Library';
  readonly description = 'Systematic reviews from Cochrane Library';
  readonly claimExtractorPrompt = 'Extract Cochrane DOIs (e.g., 10.1002/14651858.CD000001) from the claim text.';
  readonly discoverySearchTerms = [
    'systematic review',
    'meta-analysis',
    'randomised controlled trial',
    'clinical evidence',
    'Cochrane review',
  ];

  private readonly COCHRANE_DOI_REGEX = /10\.1002\/14651858\.[A-Za-z0-9.]+/g;
  private readonly API_BASE_URL = 'https://www.cochranelibrary.com/api/search/cochrane';
  private readonly USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let query = '';
    let sourceUrl: string | null = null;

    // Try to extract DOI first
    const doiMatch = claim.claimText.match(this.COCHRANE_DOI_REGEX);
    if (doiMatch && doiMatch.length > 0) {
      query = `doi:"${doiMatch[0]}"`;
      sourceUrl = `https://www.cochranelibrary.com/cdsr/doi/${doiMatch[0]}/full`;
    } else if (claim.extractedValue) {
      // Fallback to extractedValue if available
      query = `title:"${claim.extractedValue}" OR abstract:"${claim.extractedValue}"`;
    } else {
      // Fallback to claimText keyword search
      query = `title:"${claim.claimText}" OR abstract:"${claim.claimText}"`;
    }

    if (!query) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ['no_search_query_generated'],
      };
    }

    const apiUrl = `${this.API_BASE_URL}?query=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          'User-Agent': this.USER_AGENT,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Cochrane API error: ${response.status} ${response.statusText}`);
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.2,
          confidenceFlags: ['api_http_error'],
        };
      }

      const data = await response.json();

      if (data && data.results && data.results.length > 0) {
        const firstResult = data.results[0];
        const resultDoi = firstResult.doi || (doiMatch && doiMatch[0]);
        const resultSourceUrl = sourceUrl || (resultDoi ? `https://www.cochranelibrary.com/cdsr/doi/${resultDoi}/full` : null);

        return {
          found: true,
          sourceId: resultDoi || null,
          sourceUrl: resultSourceUrl,
          evidenceRaw: firstResult,
          confidenceScore: 0.95,
          confidenceFlags: ['cochrane_review_gold_standard'],
        };
      } else {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.3,
          confidenceFlags: ['no_results_found'],
        };
      }
    } catch (error) {
      console.error('Error fetching from Cochrane Library:', error);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ['network_or_parsing_error'],
      };
    }
  }
}

registerVertical(new CochraneAdapter());
