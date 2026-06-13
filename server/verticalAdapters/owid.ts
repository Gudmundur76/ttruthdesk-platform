import { VerticalAdapter, EvidenceResult, registerVertical } from './types';

const owidAdapter: VerticalAdapter = {
  domainKey: 'owid',
  displayName: 'Our World in Data',
  description: 'Adapter for Our World in Data (https://ourworldindata.org/)',
  claimExtractorPrompt: 'Extract the core statistical claim, trend, or data point related to global trends, health, climate, or development. If an Our World in Data chart URL or slug is mentioned, include it.',
  discoverySearchTerms: [
    'global trends',
    'long-run data',
    'development statistics',
    'climate data',
    'health trends'
  ],
  lookupEvidence: async (claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> => {
    try {
      const headers = {
        'User-Agent': 'citation-engine/1.0 (citation-engine@citation.is)'
      };

      const slugRegex = /ourworldindata\.org\/grapher\/([a-zA-Z0-9-]+)/i;
      const match = claim.claimText.match(slugRegex) || (claim.extractedValue && claim.extractedValue.match(slugRegex));
      
      let slug = match ? match[1] : null;

      if (slug) {
        const csvUrl = `https://ourworldindata.org/grapher/${slug}.csv`;
        const response = await fetch(csvUrl, {
          headers,
          signal: AbortSignal.timeout(10_000)
        });

        if (response.ok) {
          const csvText = await response.text();
          return {
            found: true,
            sourceId: slug,
            sourceUrl: `https://ourworldindata.org/grapher/${slug}`,
            evidenceRaw: { csvPreview: csvText.substring(0, 500) },
            confidenceScore: 0.85,
            confidenceFlags: ['peer-reviewed underlying sources']
          };
        }
      }

      const query = encodeURIComponent(claim.extractedValue || claim.claimText);
      const searchUrl = `https://ourworldindata.org/search?q=${query}`;
      
      const searchResponse = await fetch(searchUrl, {
        headers,
        signal: AbortSignal.timeout(10_000)
      });

      if (searchResponse.ok) {
        const html = await searchResponse.text();
        const grapherLinkRegex = /href="\/grapher\/([^"]+)"/i;
        const searchMatch = html.match(grapherLinkRegex);

        if (searchMatch) {
          const foundSlug = searchMatch[1];
          return {
            found: true,
            sourceId: foundSlug,
            sourceUrl: `https://ourworldindata.org/grapher/${foundSlug}`,
            evidenceRaw: { searchMatch: true, query: decodeURIComponent(query) },
            confidenceScore: 0.85,
            confidenceFlags: ['peer-reviewed underlying sources']
          };
        }
      }

      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.0,
        confidenceFlags: []
      };

    } catch (error) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: { error: error instanceof Error ? error.message : String(error) },
        confidenceScore: 0.0,
        confidenceFlags: ['error']
      };
    }
  }
};

registerVertical(owidAdapter);
