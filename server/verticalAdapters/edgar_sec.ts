import { registerVertical, VerticalAdapter, EvidenceResult } from './types';

const edgarSecAdapter: VerticalAdapter = {
  domainKey: 'edgar_sec',
  displayName: 'EDGAR SEC filings',
  description: 'Adapter for https://data.sec.gov/ to search SEC filings like 10-K, 10-Q, and 8-K.',
  claimExtractorPrompt: 'Extract CIK numbers (e.g., CIK0000320193) or ticker symbols (e.g., AAPL) from the claim text.',
  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let query = '';
    const cikMatch = claim.claimText.match(/\bCIK(\d{10})\b/i);
    const tickerMatch = claim.claimText.match(/\b([A-Z]{1,5})\b/);

    if (cikMatch && cikMatch[1]) {
      query = `CIK${cikMatch[1]}`;
    } else if (tickerMatch && tickerMatch[1]) {
      query = tickerMatch[1];
    } else {
      query = claim.claimText;
    }

    const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(query)}&dateRange=custom&startdt=2020-01-01&forms=10-K,10-Q,8-K`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'citation-engine/1.0 (citation-engine@citation.is)',
          'Accept': 'application/json' // Assuming the search endpoint can return JSON
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`SEC search failed with status: ${response.status}`);
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: { error: `HTTP error status ${response.status}` },
          confidenceScore: 0.1,
          confidenceFlags: ['network_error'],
        };
      }

      const data = await response.json(); // Assuming JSON response

      // Basic check for results. The actual structure of SEC search results would need more detailed parsing.
      // This is a placeholder for actual evidence extraction logic.
      if (data && data.hits && data.hits.hits && data.hits.hits.length > 0) {
        const firstHit = data.hits.hits[0];
        // Assuming 'firstHit._source.fileNumber' or similar is a unique ID and 'firstHit._source.link' is the URL
        // This part needs to be adapted based on the actual SEC search API response structure.
        return {
          found: true,
          sourceId: firstHit._source.fileNumber || firstHit._id || null, // Placeholder
          sourceUrl: firstHit._source.link || `https://www.sec.gov/Archives/edgar/data/${firstHit._source.cik}/${firstHit._source.accessionNumber}/`, // Placeholder
          evidenceRaw: firstHit._source, // Placeholder for actual document content or metadata
          confidenceScore: 0.92,
          confidenceFlags: ['official_sec_filing'],
        };
      } else {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: { message: 'No relevant filings found' },
          confidenceScore: 0.2,
          confidenceFlags: ['no_match'],
        };
      }
    } catch (error: unknown) {
      console.error('Error during SEC lookup:', error);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: { error: (error as Error).message || 'Unknown network error' },
        confidenceScore: 0.1,
        confidenceFlags: ['network_error'],
      };
    }
  },
  discoverySearchTerms: [
    'SEC filing',
    'earnings report',
    'annual report',
    'financial disclosure',
    '10-K',
    '10-Q',
    '8-K',
    'CIK number',
    'ticker symbol',
  ],
};

registerVertical(edgarSecAdapter);
