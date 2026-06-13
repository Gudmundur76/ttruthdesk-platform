import { registerVertical, EvidenceResult, VerticalAdapter } from './types';

const CHEMBL_API_BASE = 'https://www.ebi.ac.uk/chembl/api/data';
const USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';

const chemblAdapter: VerticalAdapter = {
  domainKey: 'chembl',
  displayName: 'ChEMBL',
  description: 'EMBL-EBI ChEMBL drug/compound database',
  claimExtractorPrompt: 'Extract ChEMBL IDs (CHEMBL\\d+) or drug/compound names from the claim text.',
  discoverySearchTerms: ['drug compound', 'pharmacology', 'clinical trial drug', 'IC50', 'bioactivity'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let query = claim.extractedValue || claim.claimText;
    let chemblIdMatch = query.match(/CHEMBL\d+/i);
    let url: string;

    if (chemblIdMatch) {
      const chemblId = chemblIdMatch[0].toUpperCase();
      url = `${CHEMBL_API_BASE}/molecule/${chemblId}?format=json`;
    } else {
      // Fallback to keyword/title search
      const encodedQuery = encodeURIComponent(query);
      url = `${CHEMBL_API_BASE}/molecule?format=json&molecule_synonyms__molecule_synonym__icontains=${encodedQuery}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json'
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.1, // Low confidence on HTTP error
          confidenceFlags: [`HTTP Error: ${response.status}`],
        };
      }

      const data = await response.json();

      // ChEMBL API returns a list of molecules for search, or a single molecule for ID lookup
      let moleculeData: any = null;
      if (chemblIdMatch) {
        moleculeData = data; // Direct molecule data
      } else if (data.molecules && data.molecules.length > 0) {
        // For keyword search, take the first result as the most relevant
        moleculeData = data.molecules[0];
      }

      if (moleculeData) {
        const sourceId = moleculeData.chembl_id || null;
        const sourceUrl = sourceId ? `https://www.ebi.ac.uk/chembl/compound_report_card/${sourceId}/` : null;
        let confidenceScore = 0.5; // Default confidence
        const confidenceFlags: string[] = [];

        // Determine confidence based on drug status
        if (moleculeData.max_phase_for_ind && moleculeData.max_phase_for_ind >= 4) {
          confidenceScore = 0.90; // Approved drug (Phase 4 or higher)
          confidenceFlags.push('Approved Drug');
        } else if (moleculeData.max_phase_for_ind && moleculeData.max_phase_for_ind >= 1) {
          confidenceScore = 0.75; // Investigational drug (Phase 1-3)
          confidenceFlags.push('Investigational Drug');
        } else if (moleculeData.molecule_type === 'Small molecule') {
          confidenceFlags.push('Small Molecule');
        }

        return {
          found: true,
          sourceId: sourceId,
          sourceUrl: sourceUrl,
          evidenceRaw: moleculeData,
          confidenceScore: confidenceScore,
          confidenceFlags: confidenceFlags,
        };
      }

      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.2, // Not found but API call was successful
        confidenceFlags: [],
      };

    } catch (error: any) {
      console.error(`Error looking up ChEMBL evidence for '${query}':`, error);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1, // Low confidence on any error
        confidenceFlags: [`Error: ${error.message}`],
      };
    }
  },
};

registerVertical(chemblAdapter);
