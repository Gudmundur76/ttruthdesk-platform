import { registerVertical, EvidenceResult, VerticalAdapter } from './types';

class WHOAdapter implements VerticalAdapter {
  readonly domainKey = 'who';
  readonly displayName = 'WHO (World Health Organization)';
  readonly description = 'Adapter for WHO Global Health Observatory (GHO) data.';
  readonly claimExtractorPrompt = 'Extract WHO GHO indicator codes (e.g., MDG_0000000001) from the claim text.';
  readonly discoverySearchTerms = [
    'global health statistics',
    'disease burden',
    'mortality rates',
    'WHO guidelines',
    'health indicators',
  ];

  private readonly API_BASE_URL = 'https://ghoapi.azureedge.net/api/';
  private readonly USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let indicatorCode: string | null = null;
    let query: string | null = null;

    // 1. Try to extract indicator code using regex
    const indicatorRegex = /[A-Z0-9_]{5,}/g; // Example: MDG_0000000001, WHOSIS_000001
    const matches = claim.claimText.match(indicatorRegex);
    if (matches && matches.length > 0) {
      indicatorCode = matches[0];
    }

    let apiUrl = '';
    if (indicatorCode) {
      apiUrl = `${this.API_BASE_URL}Indicator/${indicatorCode}`;
    } else {
      // 2. Fallback to keyword search if no identifier found
      query = claim.extractedValue || claim.claimText;
      apiUrl = `${this.API_BASE_URL}Indicator?$filter=substringof('${encodeURIComponent(query)}', IndicatorName) eq true`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.USER_AGENT,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`WHO API request failed: ${response.status} ${response.statusText}`);
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.1,
          confidenceFlags: ['API_ERROR', `HTTP_STATUS_${response.status}`],
        };
      }

      const data = await response.json();

      if (data && data.value && data.value.length > 0) {
        const firstResult = data.value[0];
        const sourceUrl = `https://www.who.int/data/gho/data/indicators/${firstResult.IndicatorCode}`;

        return {
          found: true,
          sourceId: firstResult.IndicatorCode,
          sourceUrl: sourceUrl,
          evidenceRaw: firstResult,
          confidenceScore: 0.90, // High confidence for official WHO data
          confidenceFlags: ['OFFICIAL_WHO_DATA'],
        };
      } else {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.2,
          confidenceFlags: ['NO_MATCH_FOUND'],
        };
      }
    } catch (error) {
      console.error('Error fetching from WHO API:', error);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ['NETWORK_ERROR', (error as Error).message],
      };
    }
  }
}

registerVertical(new WHOAdapter());
