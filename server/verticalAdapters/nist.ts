import { registerVertical, VerticalAdapter, EvidenceResult } from './types';

class NISTAdapter implements VerticalAdapter {
  domainKey = 'nist';
  displayName = 'NIST';
  description = 'US National Institute of Standards and Technology data and chemistry information.';
  claimExtractorPrompt = 'Extract any specific chemical compound names, material properties, or standard identifiers mentioned in the claim. Prioritize compound names for chemistry data.';
  discoverySearchTerms = [
    'measurement standard',
    'physical constants',
    'material properties',
    'cybersecurity framework',
    'NIST standard',
    'chemical compound data',
    'thermodynamic properties',
    'spectroscopic data',
    'NIST database',
    'standard reference data'
  ];

  private async fetchWithTimeout(url: string): Promise<Response> {
    return fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent': 'citation-engine/1.0 (citation-engine@citation.is)',
      },
    });
  }

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const compoundNameMatch = claim.claimText.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*|\w+(?:-\w+)*)\b/);
    const compoundName = compoundNameMatch ? compoundNameMatch[0] : null;

    let searchUrl: string | null = null;
    let sourceUrl: string | null = null;
    let confidence = 0.0;
    let evidenceRaw: Record<string, unknown> | null = null;

    try {
      if (compoundName) {
        // Prioritize chemistry data search if a compound name is found
        const webbookUrl = `https://webbook.nist.gov/cgi/cbook.cgi?Name=${encodeURIComponent(compoundName)}&Units=SI&cTG=on`;
        const response = await this.fetchWithTimeout(webbookUrl);
        if (response.ok) {
          const text = await response.text();
          if (text.includes('No data available for the specified compound')) {
            // Compound not found, try general search
            searchUrl = `https://data.nist.gov/rmm/records?q=${encodeURIComponent(claim.claimText)}&size=5`;
            sourceUrl = `https://data.nist.gov/rmm/records?q=${encodeURIComponent(claim.claimText)}&size=5`;
          } else {
            // Compound found, extract relevant info (simplified for this example)
            confidence = 0.93;
            sourceUrl = webbookUrl;
            evidenceRaw = { compound: compoundName, data_snippet: text.substring(0, 500) }; // Store a snippet
            return { found: true, sourceId: compoundName, sourceUrl, evidenceRaw, confidenceScore: confidence, confidenceFlags: ['NIST Webbook', 'High Authority'] };
          }
        } else {
          console.error(`NIST Webbook fetch failed: ${response.status} ${response.statusText}`);
          // Fallback to general search on error
          searchUrl = `https://data.nist.gov/rmm/records?q=${encodeURIComponent(claim.claimText)}&size=5`;
          sourceUrl = `https://data.nist.gov/rmm/records?q=${encodeURIComponent(claim.claimText)}&size=5`;
        }
      } else {
        // Fallback to general dataset search if no compound name or initial search failed
        searchUrl = `https://data.nist.gov/rmm/records?q=${encodeURIComponent(claim.claimText)}&size=5`;
        sourceUrl = `https://data.nist.gov/rmm/records?q=${encodeURIComponent(claim.claimText)}&size=5`;
      }

      if (searchUrl) {
        const response = await this.fetchWithTimeout(searchUrl);
        if (response.ok) {
          const data = await response.json();
          if (data && data.results && data.results.length > 0) {
            // Assuming the first result is most relevant
            const firstResult = data.results[0];
            confidence = 0.93;
            sourceUrl = firstResult.accessURL || firstResult.landingPage || searchUrl;
            evidenceRaw = firstResult;
            return { found: true, sourceId: firstResult.identifier || firstResult.title, sourceUrl, evidenceRaw, confidenceScore: confidence, confidenceFlags: ['NIST Data', 'High Authority'] };
          }
        }
      }
    } catch (error) {
      console.error('Error during NIST evidence lookup:', error);
      return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.1, confidenceFlags: ['Network Error'] };
    }

    return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.2, confidenceFlags: ['No Match Found'] };
  }
}

registerVertical(new NISTAdapter());
