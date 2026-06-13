import { registerVertical, VerticalAdapter, EvidenceResult } from './types';

class OpenFDAAdapter implements VerticalAdapter {
  domainKey = 'openfda_labels';
  displayName = 'OpenFDA Drug Labels';
  description = 'Search for FDA-approved drug labels on api.fda.gov.';
  claimExtractorPrompt = 'Extract NDC codes (e.g., 0002-8212-01) or drug names from the claim text.';
  discoverySearchTerms = ['drug label', 'contraindication', 'side effects', 'dosage', 'FDA approved drug'];

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let query = '';
    const ndcRegex = /\b(?:\d{4}-\d{4}-\d{2}|\d{5}-\d{3}-\d{2}|\d{5}-\d{4}-\d{1}|\d{5}-\d{4}-\d{2})\b/g;
    const ndcMatch = claim.claimText.match(ndcRegex);

    if (ndcMatch && ndcMatch.length > 0) {
      query = `openfda.product_ndc:"${ndcMatch[0]}"`;
    } else if (claim.extractedValue) {
      query = `openfda.brand_name:"${claim.extractedValue}" OR products.brand_name:"${claim.extractedValue}"`;
    } else {
      query = `openfda.brand_name:"${claim.claimText}" OR products.brand_name:"${claim.claimText}"`;
    }

    const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(query)}&limit=3`;

    try {
      
      
      

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          'User-Agent': 'citation-engine/1.0 (citation-engine@citation.is)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const firstResult = data.results[0];
        return {
          found: true,
          sourceId: firstResult.id || null,
          sourceUrl: `https://www.accessdata.fda.gov/drugsatfda_docs/label/${firstResult.set_id}/${firstResult.id}.pdf` || null, // Construct a plausible URL if available
          evidenceRaw: firstResult,
          confidenceScore: 0.92,
          confidenceFlags: ['FDA Approved Label'],
        };
      } else {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.1,
          confidenceFlags: ['No matching drug label found'],
        };
      }
    } catch (error) {
      console.error(`Error fetching OpenFDA drug label: ${error}`);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.05,
        confidenceFlags: ['Network error or API failure'],
      };
    }
  }
}

registerVertical(new OpenFDAAdapter());
