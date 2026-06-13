import { registerVertical, EvidenceResult, VerticalAdapter } from './types';

const USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';

// Regex to extract CELEX numbers. Examples: 32016R0679 (Regulation), 32014L0065 (Directive)
const CELEX_REGEX = /\b\d{4}[RLD][0-9]{4,5}\b/g;

const eurLexAdapter: VerticalAdapter = {
  domainKey: 'eur_lex',
  displayName: 'EUR-Lex EU law',
  description: 'Adapter for official EU law documents from eur-lex.europa.eu.',
  claimExtractorPrompt: 'Extract CELEX numbers (e.g., 32016R0679) from the claim text.',
  discoverySearchTerms: [
    'EU regulation',
    'European directive',
    'EU law',
    'GDPR',
    'European legislation',
  ],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let query = claim.claimText;
    let celexNumber: string | null = null;

    const celexMatches = claim.claimText.match(CELEX_REGEX);
    if (celexMatches && celexMatches.length > 0) {
      celexNumber = celexMatches[0];
      query = celexNumber; // Prioritize CELEX number for search
    }

    // Try SPARQL endpoint first if a CELEX number is identified for a more precise match
    if (celexNumber) {
      try {
        const sparqlQuery = `
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX dc: <http://purl.org/dc/elements/1.1/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?s ?title ?url ?type
WHERE {
  ?s cdm:resource_legal_id_celex "${celexNumber}" .
  ?s dc:title ?title .
  OPTIONAL { ?s cdm:resource_legal_url ?url . }
  OPTIONAL { ?s cdm:resource_legal_type ?type . }
  FILTER (lang(?title) = 'en')
}
LIMIT 1
`;

        const response = await fetch('https://publications.europa.eu/webapi/rdf/sparql', {
          method: 'POST',
          headers: {
            'Accept': 'application/sparql-results+json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body: `query=${encodeURIComponent(sparqlQuery)}`,
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          throw new Error(`SPARQL HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.results.bindings.length > 0) {
          const binding = data.results.bindings[0];
          const sourceUrl = binding.url ? binding.url.value : `https://eur-lex.europa.eu/eli/id/${celexNumber}/oj`; // Construct URL if not directly available
          const type = binding.type ? binding.type.value : '';
          const isRegulationOrDirective = type.includes('Regulation') || type.includes('Directive');

          return {
            found: true,
            sourceId: celexNumber,
            sourceUrl: sourceUrl,
            evidenceRaw: { ...binding, celexNumber: celexNumber },
            confidenceScore: isRegulationOrDirective ? 0.93 : 0.85, // High confidence for direct CELEX match
            confidenceFlags: isRegulationOrDirective ? ['EU_REGULATION_OR_DIRECTIVE', 'CELEX_MATCH'] : ['CELEX_MATCH'],
          };
        }
      } catch (error) {
        console.error(`SPARQL query failed: ${error}`);
        // Fallback to quick search if SPARQL fails
      }
    }

    // Fallback to EUR-Lex quick search
    try {
      const searchUrl = `https://eur-lex.europa.eu/search.html?type=quick&lang=en&text=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`EUR-Lex quick search HTTP error! status: ${response.status}`);
      }

      const html = await response.text();
      // Basic parsing to find the first result link and title
      const titleMatch = html.match(/<h2 class="title">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/);
      const snippetMatch = html.match(/<div class="snippet">([\s\S]+?)<\/div>/);

      if (titleMatch) {
        const url = `https://eur-lex.europa.eu${titleMatch[1]}`;
        const title = titleMatch[2].trim();
        const snippet = snippetMatch ? snippetMatch[1].trim() : '';

        // Attempt to determine if it's a regulation or directive from the title/snippet
        const isRegulationOrDirective = title.includes('Regulation') || title.includes('Directive') || snippet.includes('Regulation') || snippet.includes('Directive');

        return {
          found: true,
          sourceId: celexNumber || title, // Use CELEX if found, otherwise title
          sourceUrl: url,
          evidenceRaw: { title, snippet, celexNumber: celexNumber },
          confidenceScore: isRegulationOrDirective ? 0.93 : 0.7,
          confidenceFlags: isRegulationOrDirective ? ['EU_REGULATION_OR_DIRECTIVE', 'QUICK_SEARCH'] : ['QUICK_SEARCH'],
        };
      }
    } catch (error) {
      console.error(`EUR-Lex quick search failed: ${error}`);
    }

    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.1,
      confidenceFlags: ['NETWORK_ERROR_OR_NOT_FOUND'],
    };
  },
};

registerVertical(eurLexAdapter);
