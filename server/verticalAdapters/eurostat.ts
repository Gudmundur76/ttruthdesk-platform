import { registerVertical, EvidenceResult, VerticalAdapter } from './types';
class EurostatAdapter implements VerticalAdapter {
  domainKey = 'eurostat';
  displayName = 'Eurostat';
  description = 'Adapter for EU statistical office at https://ec.europa.eu/eurostat/api/dissemination/';
  claimExtractorPrompt = 'Extract Eurostat dataset codes (e.g., nama_10_gdp, tps00001) from the claim text.';
  discoverySearchTerms = ['European statistics', 'EU economy', 'population data', 'trade statistics', 'social indicators'];

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const defaultResult: EvidenceResult = {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.1,
      confidenceFlags: ['network-error'],
    };

    let datasetCode: string | null = null;

    // Try to extract dataset code from extractedValue first, then from claimText
    if (claim.extractedValue) {
      // Assuming extractedValue is already a dataset code or contains one
      const extractedCodeMatch = claim.extractedValue.match(/\b([A-Z0-9_]+)\b/i);
      if (extractedCodeMatch) {
        datasetCode = extractedCodeMatch[1].toUpperCase();
      }
    }

    if (!datasetCode) {
      // Fallback to extracting from claimText if not found in extractedValue
      const claimCodeMatch = claim.claimText.match(/\b([A-Z0-9_]+)\b/i);
      if (claimCodeMatch) {
        datasetCode = claimCodeMatch[1].toUpperCase();
      }
    }

    if (!datasetCode) {
      return { ...defaultResult, confidenceFlags: ['no-identifier-found'], confidenceScore: 0.05 };
    }

    const apiUrl = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${datasetCode}?format=JSON`;

    try {
      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          'User-Agent': 'citation-engine/1.0 (citation-engine@citation.is)',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Eurostat API error: ${response.status} ${response.statusText}`);
        return { ...defaultResult, confidenceFlags: ['api-error', `http-status-${response.status}`] };
      }

      const data = await response.json();

      // Basic validation of the data structure
      if (data && data.dataset && data.dimension) {
        return {
          found: true,
          sourceId: datasetCode,
          sourceUrl: apiUrl,
          evidenceRaw: data,
          confidenceScore: 0.90,
          confidenceFlags: ['official-source', 'eurostat', 'data-found'],
        };
      } else {
        console.warn(`Eurostat API returned unexpected data structure for ${datasetCode}`);
        return { ...defaultResult, confidenceFlags: ['data-structure-mismatch'], confidenceScore: 0.2 };
      }
    } catch (error) {
      console.error(`Error fetching Eurostat data for ${datasetCode}:`, error);
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        return { ...defaultResult, confidenceFlags: ['network-timeout'] };
      }
      return { ...defaultResult, confidenceFlags: ['network-error', (error as Error).message] };
    }
  }
}

registerVertical(new EurostatAdapter());
