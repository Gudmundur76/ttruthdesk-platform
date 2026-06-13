import { registerVertical, EvidenceResult, VerticalAdapter } from './types';

const WORLD_BANK_API_BASE = 'https://api.worldbank.org/v2';
const USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';

const worldBankAdapter: VerticalAdapter = {
  domainKey: 'world_bank',
  displayName: 'World Bank Open Data',
  description: 'Adapter for World Bank Open Data API, providing economic and development indicators.',
  claimExtractorPrompt: 'Extract World Bank indicator codes (e.g., NY.GDP.MKTP.CD, SP.POP.TOTL) from the claim text.',
  discoverySearchTerms: ['GDP', 'poverty rate', 'development indicators', 'economic data', 'global statistics', 'population', 'inflation', 'education spending'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let indicatorCode: string | null = null;

    // Try to extract indicator code from claimText
    const indicatorRegex = /[A-Z]{2}\.[A-Z]{3}\.[A-Z]{4}\.[A-Z]{2}|[A-Z]{2}\.[A-Z]{3}\.[A-Z]{3}\.[A-Z]{2}/g; // e.g., NY.GDP.MKTP.CD, SP.POP.TOTL
    const matches = claim.claimText.match(indicatorRegex);
    if (matches && matches.length > 0) {
      indicatorCode = matches[0];
    } else if (claim.extractedValue) {
      // If no regex match, check if extractedValue is a valid indicator pattern
      const extractedMatches = claim.extractedValue.match(indicatorRegex);
      if (extractedMatches && extractedMatches.length > 0) {
        indicatorCode = extractedMatches[0];
      }
    }

    if (!indicatorCode) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ['no_indicator_code_found'],
      };
    }

    const url = `${WORLD_BANK_API_BASE}/country/all/indicator/${indicatorCode}?format=json&mrv=1`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          found: false,
          sourceId: null,
          sourceUrl: url,
          evidenceRaw: { status: response.status, statusText: response.statusText },
          confidenceScore: 0.2,
          confidenceFlags: ['http_error', `status_${response.status}`],
        };
      }

      const data = await response.json();

      // World Bank API returns an array, with metadata in [0] and data in [1]
      if (data && data.length > 1 && data[1] && data[1].length > 0) {
        const latestData = data[1][0]; // Get the most recent data point
        return {
          found: true,
          sourceId: `${indicatorCode}-${latestData.country.id}-${latestData.date}`,
          sourceUrl: url,
          evidenceRaw: latestData,
          confidenceScore: 0.90,
          confidenceFlags: ['world_bank_official_data', 'indicator_match'],
        };
      } else {
        return {
          found: false,
          sourceId: null,
          sourceUrl: url,
          evidenceRaw: data,
          confidenceScore: 0.4,
          confidenceFlags: ['no_data_for_indicator'],
        };
      }
    } catch (error: any) {
      let confidence = 0.1;
      const flags = ['network_error'];
      if (error.name === 'AbortError') {
        flags.push('request_timeout');
        confidence = 0.05;
      } else if (error instanceof TypeError) {
        flags.push('invalid_url_or_network_issue');
      }

      return {
        found: false,
        sourceId: null,
        sourceUrl: url,
        evidenceRaw: { message: error.message, name: error.name },
        confidenceScore: confidence,
        confidenceFlags: flags,
      };
    }
  },
};

registerVertical(worldBankAdapter);
