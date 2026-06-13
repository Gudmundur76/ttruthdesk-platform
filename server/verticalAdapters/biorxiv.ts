import { registerVertical, EvidenceResult, VerticalAdapter } from './types';

const BIORXIV_DOI_REGEX = /10\.1101\/[^\s]+/g;

const biorxivAdapter: VerticalAdapter = {
  domainKey: 'biorxiv',
  displayName: 'bioRxiv and medRxiv Preprints',
  description: 'Preprint server for biology and medicine research.',
  claimExtractorPrompt: 'Extract bioRxiv/medRxiv DOIs (e.g., 10.1101/YYYY.MM.DD.XXXXXX) from the claim text.',
  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const userAgent = 'citation-engine/1.0 (citation-engine@citation.is)';
    const headers = { 'User-Agent': userAgent };

    let doi: string | undefined;

    // Try to extract DOI from claimText first
    const doiMatches = claim.claimText.match(BIORXIV_DOI_REGEX);
    if (doiMatches && doiMatches.length > 0) {
      doi = doiMatches[0];
    } else if (claim.extractedValue && claim.extractedValue.match(BIORXIV_DOI_REGEX)) {
      // Fallback to extractedValue if it looks like a DOI
      doi = claim.extractedValue;
    }

    if (!doi) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.0,
        confidenceFlags: ['no_doi_found'],
      };
    }

    const biorxivUrl = `https://api.biorxiv.org/details/biorxiv/${doi}/na/json`;
    const medrxivUrl = `https://api.biorxiv.org/details/medrxiv/${doi}/na/json`;

    for (const apiUrl of [biorxivUrl, medrxivUrl]) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(apiUrl, { headers, signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          if (data.collection && data.collection.length > 0) {
            const article = data.collection[0];
            return {
              found: true,
              sourceId: article.doi || doi,
              sourceUrl: article.biorxiv_url || article.medrxiv_url || `https://www.biorxiv.org/content/${doi}`,
              evidenceRaw: article,
              confidenceScore: 0.60, // Preprints are not peer-reviewed
              confidenceFlags: ['preprint', 'not_peer_reviewed'],
            };
          }
        }
      } catch (error: any) {
        console.error(`Error fetching from ${apiUrl}:`, error.message);
        // Continue to the next URL if one fails
      }
    }

    // If no DOI found or all API calls failed
    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.1, // Low confidence due to error or not found
      confidenceFlags: ['api_error_or_not_found'],
    };
  },
  discoverySearchTerms: [
    'preprint biology',
    'preprint medicine',
    'bioRxiv',
    'medRxiv',
    'early research findings',
    'unreviewed research',
    'scientific preprints',
    'biological sciences preprints',
    'medical sciences preprints'
  ],
};

registerVertical(biorxivAdapter);
