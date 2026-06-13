import { registerVertical, EvidenceResult, VerticalAdapter } from './types';

interface ClinVarESearchResult {
  esearchresult: {
    count: string;
    retmax: string;
    retstart: string;
    idlist: string[];
  };
}

interface ClinVarEFetchResult {
  header: {
    type: string;
    version: string;
  };
  DocumentSummarySet: {
    DocumentSummary: Array<{
      uid: string;
      title: string;
      clinical_significance: {
        description: string;
      };
      accession: string;
      rcv_accession: string;
      variation_id: string;
    }>;
  };
}

const CLINVAR_EUTILS_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';

class ClinVarAdapter implements VerticalAdapter {
  domainKey = 'clinvar';
  displayName = 'NCBI ClinVar';
  description = 'Genetic variant database from NCBI ClinVar.';
  claimExtractorPrompt = 'Extract genetic variant identifiers (e.g., rs numbers like rs12345, or NM_ accessions like NM_000059.4) from the claim text.';
  discoverySearchTerms = ['genetic variant', 'pathogenic mutation', 'clinical significance', 'BRCA', 'genetic disease'];

  private getUserAgent() {
    return 'citation-engine/1.0 (citation-engine@citation.is)';
  }

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let query = claim.extractedValue;

    // Attempt to extract variant IDs from claimText if not already extracted
    if (!query) {
      const rsMatch = claim.claimText.match(/rs\d+/i);
      const nmMatch = claim.claimText.match(/NM_\d+\.\d+/i);
      if (rsMatch) {
        query = rsMatch[0];
      } else if (nmMatch) {
        query = nmMatch[0];
      }
    }

    if (!query) {
      // Fallback to keyword search if no identifier found
      query = claim.claimText;
    }

    try {
      // Step 1: Search for the variant in ClinVar using esearch
      const searchUrl = `${CLINVAR_EUTILS_BASE_URL}esearch.fcgi?db=clinvar&term=${encodeURIComponent(query)}&retmode=json`;
      const searchResponse = await fetch(searchUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': this.getUserAgent() },
      });

      if (!searchResponse.ok) {
        throw new Error(`ClinVar ESearch HTTP error! status: ${searchResponse.status}`);
      }

      const searchData: ClinVarESearchResult = await searchResponse.json();
      const idList = searchData.esearchresult.idlist;

      if (idList.length === 0) {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.1,
          confidenceFlags: ['no_match_found'],
        };
      }

      // Step 2: Fetch details for the top result using efetch
      const uid = idList[0]; // Take the first result
      const fetchUrl = `${CLINVAR_EUTILS_BASE_URL}esummary.fcgi?db=clinvar&id=${uid}&retmode=json`;
      const fetchResponse = await fetch(fetchUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': this.getUserAgent() },
      });

      if (!fetchResponse.ok) {
        throw new Error(`ClinVar EFetch HTTP error! status: ${fetchResponse.status}`);
      }

      const fetchData: ClinVarEFetchResult = await fetchResponse.json();
      const documentSummary = fetchData.DocumentSummarySet.DocumentSummary[0];

      if (!documentSummary) {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.1,
          confidenceFlags: ['no_details_found'],
        };
      }

      const clinicalSignificance = documentSummary.clinical_significance?.description?.toLowerCase();
      let confidenceScore = 0.5; // Default confidence
      const confidenceFlags: string[] = [];

      if (clinicalSignificance) {
        if (clinicalSignificance.includes('pathogenic') || clinicalSignificance.includes('likely pathogenic')) {
          confidenceScore = 0.92;
          confidenceFlags.push('pathogenic_or_likely_pathogenic');
        } else if (clinicalSignificance.includes('benign') || clinicalSignificance.includes('likely benign')) {
          confidenceScore = 0.7;
          confidenceFlags.push('benign_or_likely_benign');
        } else if (clinicalSignificance.includes('uncertain significance')) {
          confidenceScore = 0.3;
          confidenceFlags.push('uncertain_significance');
        }
      }

      return {
        found: true,
        sourceId: documentSummary.uid,
        sourceUrl: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${documentSummary.variation_id}/`,
        evidenceRaw: documentSummary as unknown as Record<string, unknown>,
        confidenceScore,
        confidenceFlags,
      };
    } catch (error) {
      console.error(`Error looking up evidence in ClinVar: ${error}`);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.05,
        confidenceFlags: ['network_error_or_api_failure'],
      };
    }
  }
}

registerVertical(new ClinVarAdapter());
