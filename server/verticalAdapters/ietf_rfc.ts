import { registerVertical, VerticalAdapter, EvidenceResult } from './types';

const IETF_RFC_ADAPTER: VerticalAdapter = {
  domainKey: 'ietf_rfc',
  displayName: 'IETF RFC Documents',
  description: 'Adapter for IETF RFC documents from rfc-editor.org',
  claimExtractorPrompt: 'Extract RFC numbers (e.g., RFC 1234) from the claim text.',
  discoverySearchTerms: ['internet standard', 'network protocol', 'HTTP', 'TLS', 'DNS', 'TCP/IP'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const userAgent = 'citation-engine/1.0 (citation-engine@citation.is)';
    const rfcNumberMatch = claim.claimText.match(/RFC\s*(\d{1,5})/i);

    if (!rfcNumberMatch) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ['no_rfc_number_found'],
      };
    }

    const rfcNumber = rfcNumberMatch[1];
    let rfcEditorData: { items?: Array<{ doc_id: string; current_status: string }> } | null = null;
    let semanticScholarData: { data?: Array<{ citationCount?: number }> } | null = null;
    let confidence = 0.0;
    const confidenceFlags: string[] = [];

    // Fetch from rfc-editor.org
    try {
      const rfcEditorUrl = `https://www.rfc-editor.org/search/rfc_search_detail.php?rfc=${rfcNumber}&pub_status=Any&format=json`;
      const rfcEditorResponse = await fetch(rfcEditorUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': userAgent },
      });
      if (rfcEditorResponse.ok) {
        rfcEditorData = await rfcEditorResponse.json();
      } else {
        confidenceFlags.push('rfc_editor_fetch_failed');
      }
    } catch (error) {
      console.error(`Error fetching RFC from rfc-editor.org: ${error}`);
      confidenceFlags.push('rfc_editor_network_error');
    }

    // Fetch from Semantic Scholar
    try {
      const semanticScholarUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=RFC+${rfcNumber}`;
      const semanticScholarResponse = await fetch(semanticScholarUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': userAgent },
      });
      if (semanticScholarResponse.ok) {
        semanticScholarData = await semanticScholarResponse.json();
      } else {
        confidenceFlags.push('semantic_scholar_fetch_failed');
      }
    } catch (error) {
      console.error(`Error fetching from Semantic Scholar: ${error}`);
      confidenceFlags.push('semantic_scholar_network_error');
    }

    const evidenceRaw = {
      rfcEditor: rfcEditorData,
      semanticScholar: semanticScholarData,
    };

    let found = false;
    let sourceId: string | null = null;
    let sourceUrl: string | null = null;

    if (rfcEditorData && rfcEditorData.items && rfcEditorData.items.length > 0) {
      const rfc = rfcEditorData.items[0]; // Assuming the first item is the most relevant
      found = true;
      sourceId = `RFC${rfc.doc_id}`;
      sourceUrl = `https://www.rfc-editor.org/rfc/rfc${rfc.doc_id}.html`;

      if (rfc.current_status === 'Internet Standard') {
        confidence = 0.95;
        confidenceFlags.push('internet_standard');
      } else if (rfc.current_status === 'Proposed Standard') {
        confidence = 0.85;
        confidenceFlags.push('proposed_standard');
      } else if (rfc.current_status === 'Draft Standard') {
        confidence = 0.80;
        confidenceFlags.push('draft_standard');
      } else {
        confidence = 0.70;
        confidenceFlags.push('informational_or_experimental');
      }

      if (semanticScholarData && semanticScholarData.data && semanticScholarData.data.length > 0) {
        const paper = semanticScholarData.data[0];
        if (paper.citationCount && paper.citationCount > 0) {
          confidence += Math.min(0.05, paper.citationCount / 1000); // Add up to 0.05 based on citation count
          confidenceFlags.push(`citations_${paper.citationCount}`);
        }
      }
    } else {
      confidenceFlags.push('rfc_not_found_in_editor');
      confidence = 0.2;
    }

    if (!found && confidenceFlags.length > 0) {
      confidence = 0.1;
    }

    return {
      found,
      sourceId,
      sourceUrl,
      evidenceRaw,
      confidenceScore: Math.min(1.0, confidence),
      confidenceFlags: confidenceFlags.length > 0 ? confidenceFlags : ['no_specific_flags'],
    };
  },
};

registerVertical(IETF_RFC_ADAPTER);
