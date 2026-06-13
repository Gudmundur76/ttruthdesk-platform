import { registerVertical, EvidenceResult, VerticalAdapter } from './types';

const oecdAdapter: VerticalAdapter = {
  domainKey: 'oecd',
  displayName: 'OECD iLibrary',
  description: 'Adapter for OECD iLibrary statistics, extracting dataset codes from claims.',
  claimExtractorPrompt: 'Extract the OECD dataset code (e.g., "EDU_FIN", "HEALTH_STAT") from the following claim.',
  discoverySearchTerms: ['OECD statistics', 'economic indicators', 'education data', 'health systems', 'labour market'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let datasetCode: string | null = null;

    // Try to extract OECD dataset codes from claim text using regex
    const oecdDatasetRegex = /\b([A-Z0-9_]+)\b/g; // Simple regex to find uppercase words/numbers/underscores
    let match;
    while ((match = oecdDatasetRegex.exec(claim.claimText)) !== null) {
      // A more sophisticated regex might be needed depending on actual dataset code patterns
      // For now, let's assume the first plausible match is the dataset code.
      // In a real scenario, we might validate against a list of known OECD dataset codes.
      datasetCode = match[1];
      break;
    }

    if (!datasetCode && claim.extractedValue) {
      // Fallback to extractedValue if available and looks like a dataset code
      if (oecdDatasetRegex.test(claim.extractedValue)) {
        datasetCode = claim.extractedValue;
      }
    }

    if (!datasetCode) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1, // Low confidence if no identifier found
        confidenceFlags: ['no_dataset_code_found'],
      };
    }

    const apiUrl = `https://stats.oecd.org/SDMX-JSON/data/${datasetCode}/all/all?format=jsonvnd.oecd.data+json`;
    const sourceUrl = `https://stats.oecd.org/SDMX-JSON/data/${datasetCode}`; // A more user-friendly URL might be needed

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'citation-engine/1.0 (citation-engine@citation.is)',
          'Accept': 'application/json'
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          found: false,
          sourceId: datasetCode,
          sourceUrl: sourceUrl,
          evidenceRaw: { status: response.status, statusText: response.statusText },
          confidenceScore: 0.2, // Low confidence due to HTTP error
          confidenceFlags: ['http_error', `status_${response.status}`],
        };
      }

      const data = await response.json();

      // Basic check if data contains expected structure for OECD statistics
      // This might need to be more robust based on actual OECD API responses
      if (data && data.dataSets && data.dataSets.length > 0) {
        return {
          found: true,
          sourceId: datasetCode,
          sourceUrl: sourceUrl,
          evidenceRaw: data,
          confidenceScore: 0.90, // High confidence for OECD statistics
          confidenceFlags: ['oecd_statistics', 'dataset_found'],
        };
      } else {
        return {
          found: false,
          sourceId: datasetCode,
          sourceUrl: sourceUrl,
          evidenceRaw: data, // Return raw data even if not found, for debugging
          confidenceScore: 0.3, // Medium-low confidence if data structure is unexpected
          confidenceFlags: ['dataset_empty_or_malformed'],
        };
      }

    } catch (error: any) {
      let confidenceFlags = ['network_error'];
      if (error.name === 'AbortError') {
        confidenceFlags.push('timeout');
      }
      return {
        found: false,
        sourceId: datasetCode,
        sourceUrl: sourceUrl,
        evidenceRaw: { error: error.message, name: error.name },
        confidenceScore: 0.1, // Very low confidence on network/fetch error
        confidenceFlags: confidenceFlags,
      };
    }
  },
};

registerVertical(oecdAdapter);
