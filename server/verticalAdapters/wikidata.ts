import { registerVertical, EvidenceResult, VerticalAdapter } from './types';

class WikidataAdapter implements VerticalAdapter {
  domainKey: string = 'wikidata';
  displayName: string = 'Wikidata';
  description: string = 'Adapter for Wikidata, a free and open knowledge base that can be read and edited by both humans and machines.';
  claimExtractorPrompt: string = 'Extract Q-numbers (e.g., Q12345) from the claim text.';
  discoverySearchTerms: string[] = [
    'structured knowledge',
    'entity facts',
    'historical data',
    'scientific concepts',
    'geographic data',
  ];

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const userAgent = 'citation-engine/1.0 (citation-engine@citation.is)';
    const qNumberRegex = /(Q\d+)/g;
    let qNumberMatch;
    let qNumbers: string[] = [];

    // Extract Q-numbers from claim text
    while ((qNumberMatch = qNumberRegex.exec(claim.claimText)) !== null) {
      qNumbers.push(qNumberMatch[1]);
    }

    let query = claim.extractedValue || claim.claimText;
    let searchUrl: string | null = null;
    let sparqlQuery: string | null = null;
    let foundEvidence: any = null;

    try {
      // Prioritize Q-number search if found
      if (qNumbers.length > 0) {
        // For simplicity, let's just take the first Q-number for direct lookup
        const qId = qNumbers[0];
        sparqlQuery = `
          SELECT ?item ?itemLabel ?itemDescription WHERE {
            BIND(wd:${qId} AS ?item)
            SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
          }
        `;
        const sparqlResponse = await fetch('https://query.wikidata.org/sparql', {
          method: 'POST',
          headers: {
            'Accept': 'application/sparql-results+json',
            'User-Agent': userAgent,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `query=${encodeURIComponent(sparqlQuery)}`,
          signal: AbortSignal.timeout(10_000),
        });

        if (sparqlResponse.ok) {
          const data = await sparqlResponse.json();
          if (data.results.bindings.length > 0) {
            foundEvidence = data.results.bindings[0];
            searchUrl = `https://www.wikidata.org/wiki/${qId}`;
          }
        }
      }

      // Fallback to keyword search if no Q-number or direct lookup failed
      if (!foundEvidence && query) {
        const encodedQuery = encodeURIComponent(query);
        const wikidataSearchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodedQuery}&language=en&format=json`;
        const searchResponse = await fetch(wikidataSearchUrl, {
          headers: { 'User-Agent': userAgent },
          signal: AbortSignal.timeout(10_000),
        });

        if (searchResponse.ok) {
          const data = await searchResponse.json();
          if (data.search.length > 0) {
            foundEvidence = data.search[0]; // Take the first result
            searchUrl = foundEvidence.concepturi || `https://www.wikidata.org/wiki/${foundEvidence.id}`;
          }
        }
      }

      if (foundEvidence) {
        return {
          found: true,
          sourceId: foundEvidence.id || null,
          sourceUrl: searchUrl,
          evidenceRaw: foundEvidence,
          confidenceScore: 0.70,
          confidenceFlags: ['community-edited', 'cited'],
        };
      } else {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.1,
          confidenceFlags: ['no-match'],
        };
      }
    } catch (error) {
      console.error(`Wikidata lookup error: ${error}`);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.05,
        confidenceFlags: ['network-error'],
      };
    }
  }
}

registerVertical(new WikidataAdapter());
