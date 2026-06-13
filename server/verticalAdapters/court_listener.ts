import { logger, errData } from "../logger";
const log = logger("verticalAdapters/court_listener");

export interface EvidenceResult {
  found: boolean;
  sourceId: string | null;
  sourceUrl: string | null;
  evidenceRaw: Record<string, unknown> | null;
  confidenceScore: number; // 0.0–1.0
  confidenceFlags: string[];
}
export interface VerticalAdapter {
  domainKey: string;
  displayName: string;
  description: string;
  claimExtractorPrompt: string;
  lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult>;
  discoverySearchTerms: string[];
}

// Placeholder for registerVertical function, assuming it's imported from './types'
function registerVertical(adapter: VerticalAdapter): void {
  log.info(`Registering vertical adapter: ${adapter.displayName}`);
}

class CourtListenerAdapter implements VerticalAdapter {
  readonly domainKey = 'court_listener';
  readonly displayName = 'CourtListener';
  readonly description = 'US case law from CourtListener';
  readonly claimExtractorPrompt = 'Extract case citations (e.g., 410 U.S. 113) from the claim text.';
  readonly discoverySearchTerms = [
    'US case law',
    'Supreme Court ruling',
    'federal court opinion',
    'legal precedent',
    'constitutional law',
  ];

  private readonly USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';
  private readonly API_BASE_URL = 'https://www.courtlistener.com/api/rest/v4';

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let query = claim.extractedValue || claim.claimText;
    const supremeCourtCitationRegex = /(\d+)\s+U\.S\.\s+(\d+)/i;
    const generalCitationRegex = /(\d+)\s+([A-Z]+\.?\s?[A-Z]*\.?)\s+(\d+)/i;

    let citationMatch = claim.claimText.match(supremeCourtCitationRegex);
    let isSupremeCourt = false;

    if (citationMatch) {
      query = `${citationMatch[1]} U.S. ${citationMatch[2]}`;
      isSupremeCourt = true;
    } else {
      citationMatch = claim.claimText.match(generalCitationRegex);
      if (citationMatch) {
        query = `${citationMatch[1]} ${citationMatch[2]} ${citationMatch[3]}`;
      }
    }

    const searchUrl = `${this.API_BASE_URL}/search/?q=${encodeURIComponent(query)}&type=o&format=json`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.USER_AGENT,
        },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        log.error(`CourtListener API error: ${response.status} ${response.statusText}`);
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.1,
          confidenceFlags: ['API_ERROR'],
        };
      }

      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const firstResult = data.results[0];
        let confidence = 0.5; // Default confidence
        const confidenceFlags: string[] = [];

        // Determine confidence based on court type
        if (isSupremeCourt) {
          confidence = 0.90;
          confidenceFlags.push('SUPREME_COURT_CITATION');
        } else if (firstResult.court && firstResult.court.includes('Circuit')) {
          confidence = 0.82;
          confidenceFlags.push('CIRCUIT_COURT_OPINION');
        } else if (firstResult.court) {
          confidence = 0.70;
          confidenceFlags.push('OTHER_FEDERAL_COURT');
        }

        return {
          found: true,
          sourceId: firstResult.id ? String(firstResult.id) : null,
          sourceUrl: firstResult.absolute_url || null,
          evidenceRaw: firstResult,
          confidenceScore: confidence,
          confidenceFlags: confidenceFlags,
        };
      } else {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.2,
          confidenceFlags: ['NO_RESULTS_FOUND'],
        };
      }
    } catch (error) {
      log.error('Network or parsing error during CourtListener lookup:', errData(error));
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.1,
        confidenceFlags: ['NETWORK_ERROR'],
      };
    }
  }
}

const courtListenerAdapter = new CourtListenerAdapter();
registerVertical(courtListenerAdapter);
