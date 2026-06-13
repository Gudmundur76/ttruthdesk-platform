import { registerVertical, EvidenceResult, VerticalAdapter } from './types';

class PubChemAdapter implements VerticalAdapter {
  domainKey = 'pubchem';
  displayName = 'PubChem';
  description = 'NCBI PubChem compound database';
  claimExtractorPrompt = 'Extract CID numbers (CID: \s*\d+) or chemical compound names from the claim text.';
  discoverySearchTerms = ['chemical compound', 'molecular weight', 'toxicity', 'bioactivity', 'drug interaction', 'compound structure', 'pharmacology', 'chemical properties', 'substance identification'];

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const userAgent = 'citation-engine/1.0 (citation-engine@citation.is)';
    let url: string | null = null;
    let confidence = 0.0;
    const confidenceFlags: string[] = [];

    // 1. Extract CID numbers from claim text using regex
    const cidMatch = claim.claimText.match(/CID:\s*(\d+)/);
    let identifier: string | null = null;

    if (cidMatch && cidMatch[1]) {
      identifier = cidMatch[1];
      url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${identifier}/JSON`;
    } else if (claim.extractedValue) {
      // Fall back to keyword/title search if no identifier found
      identifier = claim.extractedValue;
      url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(identifier)}/JSON`;
    } else if (claim.claimText) {
      identifier = claim.claimText;
      url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(identifier)}/JSON`;
    }

    if (!url) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ['no_identifier_or_name_found'],
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          'Accept': 'application/json'
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          return {
            found: false,
            sourceId: null,
            sourceUrl: null,
            evidenceRaw: null,
            confidenceScore: 0.2,
            confidenceFlags: ['not_found_in_pubchem'],
          };
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data && data.PC_Compounds && data.PC_Compounds.length > 0) {
        const compound = data.PC_Compounds[0];
        const cid = compound.id.cid;
        const sourceUrl = `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;

        // Determine confidence based on content (simplified for this example)
        // In a real scenario, we'd parse the 'data' more deeply to find specific properties
        // For now, assume a successful lookup provides both chemical properties and bioactivity potential
        confidence = 0.90; // Default to higher confidence for a successful hit
        confidenceFlags.push('chemical_properties_found', 'bioactivity_potential');

        return {
          found: true,
          sourceId: cid.toString(),
          sourceUrl: sourceUrl,
          evidenceRaw: data,
          confidenceScore: confidence,
          confidenceFlags: confidenceFlags,
        };
      } else {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: data,
          confidenceScore: 0.3,
          confidenceFlags: ['no_compound_data_in_response'],
        };
      }
    } catch (error: any) {
      console.error(`Error fetching PubChem data for ${identifier}:`, error);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: [`network_error: ${error.message}`],
      };
    }
  }
}

registerVertical(new PubChemAdapter());
