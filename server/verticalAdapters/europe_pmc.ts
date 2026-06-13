import { VerticalAdapter, EvidenceResult, registerVertical } from './types';

const europePmcAdapter: VerticalAdapter = {
  domainKey: 'europe_pmc',
  displayName: 'Europe PMC',
  description: 'Adapter for Europe PMC, a repository for life sciences research articles.',
  claimExtractorPrompt: 'Extract any PubMed ID (PMID) or PubMed Central ID (PMCID) from the following text. If multiple are found, prioritize PMCID. If none are found, return null.',
  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let query = '';
    let identifierType: 'PMID' | 'PMCID' | 'keyword' = 'keyword';

    // Regex for PMCID (e.g., PMC1234567) and PMID (e.g., 12345678)
    const pmcidRegex = /\b(PMC\d+)\b/i;
    const pmidRegex = /\b(\d{7,8})\b/;

    const pmcidMatch = claim.claimText.match(pmcidRegex);
    const pmidMatch = claim.claimText.match(pmidRegex);

    if (pmcidMatch) {
      query = pmcidMatch[1];
      identifierType = 'PMCID';
    } else if (pmidMatch) {
      query = pmidMatch[1];
      identifierType = 'PMID';
    } else if (claim.extractedValue) {
      query = claim.extractedValue;
    } else {
      query = claim.claimText;
    }

    if (!query) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ['no_query_provided'],
      };
    }

    const apiUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json`;

    try {
      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          'User-Agent': 'citation-engine/1.0 (citation-engine@citation.is)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.hitCount > 0 && data.resultList && data.resultList.result && data.resultList.result.length > 0) {
        const firstResult = data.resultList.result[0];
        let confidence = 0.5; // Default confidence
        const confidenceFlags: string[] = [];

        // Determine confidence based on source authority signals
        if (firstResult.journalInfo && firstResult.journalInfo.journal && firstResult.journalInfo.journal.title) {
          // Placeholder for actual peer-review status check. Europe PMC data might not directly expose this.
          // For demonstration, we'll use a simplified logic based on publication type.
          if (firstResult.pubType && firstResult.pubType.includes('Review')) {
            confidence = 0.88; // Assuming reviews are peer-reviewed
            confidenceFlags.push('peer_reviewed');
          } else if (firstResult.pubType && firstResult.pubType.includes('Preprint')) {
            confidence = 0.72;
            confidenceFlags.push('preprint');
          } else if (firstResult.pubType && firstResult.pubType.includes('Journal Article')) {
            confidence = 0.88;
            confidenceFlags.push('peer_reviewed');
          } else {
            confidence = 0.72; // General article, assuming some level of review
            confidenceFlags.push('general_publication');
          }
        }

        // If an identifier was used and found, boost confidence slightly
        if (identifierType !== 'keyword' && (firstResult.pmid === query || firstResult.pmcid === query)) {
          confidence = Math.min(1.0, confidence + 0.05);
          confidenceFlags.push('identifier_match');
        }

        return {
          found: true,
          sourceId: firstResult.pmid || firstResult.pmcid || null,
          sourceUrl: firstResult.fullTextUrlList && firstResult.fullTextUrlList.fullTextUrl && firstResult.fullTextUrlList.fullTextUrl[0] ? firstResult.fullTextUrlList.fullTextUrl[0].url : `https://europepmc.org/article/MED/${firstResult.pmid || firstResult.pmcid}`,
          evidenceRaw: firstResult,
          confidenceScore: confidence,
          confidenceFlags: confidenceFlags.length > 0 ? confidenceFlags : ['found_via_keyword_search'],
        };
      }
    }
    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error fetching from Europe PMC: ${msg}`);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.2,
        confidenceFlags: ['network_error', msg],
      };
    }

    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.3,
      confidenceFlags: ['no_results_found'],
    };
  },
  discoverySearchTerms: [
    'European biomedical literature',
    'open access research',
    'life sciences',
    'clinical studies',
    'molecular biology',
    'biomedical research',
    'medical journals',
    'public health',
    'genetics',
    'pharmacology',
  ],
};

registerVertical(europePmcAdapter);
