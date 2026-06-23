import { registerVertical, EvidenceResult, VerticalAdapter } from './types';
import { logger, errData } from "../logger";

const log = logger("verticalAdapters/retraction_watch");
const RW_API_BASE = 'https://api.retractionwatch.com';
const USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';

/**
 * Retraction Watch adapter.
 * Covers ~50,000 retractions including papers without DOIs, expressions of concern,
 * and partial retractions. Complements crossrefRetraction (DOI-level only).
 * Returns a NEGATIVE confidence signal — a found retraction lowers claim confidence.
 * Sprint 38 — Tier 1 public database expansion.
 */
const retractionWatchAdapter: VerticalAdapter = {
  domainKey: 'retraction_watch',
  displayName: 'Retraction Watch',
  description: 'Retraction Watch database — 50,000+ retracted papers, expressions of concern, and partial retractions across all disciplines',
  claimExtractorPrompt: 'Extract DOIs, PubMed IDs (PMID), paper titles, or author names from the claim text to check for retractions.',
  discoverySearchTerms: ['retracted paper', 'retraction', 'expression of concern', 'research misconduct', 'data fabrication'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const query = claim.extractedValue || claim.claimText;

    // Extract identifiers from query
    const doiMatch = query.match(/10\.\d{4,}\/[^\s"'<>]+/i);
    const pmidMatch = query.match(/\bPMID[:\s]*(\d{7,8})\b/i);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12_000);

      let searchUrl: string;
      if (doiMatch) {
        searchUrl = `${RW_API_BASE}/retractions?doi=${encodeURIComponent(doiMatch[0])}`;
      } else if (pmidMatch) {
        searchUrl = `${RW_API_BASE}/retractions?pmid=${pmidMatch[1]}`;
      } else {
        // Title/keyword search — limit to 5 results
        searchUrl = `${RW_API_BASE}/retractions?title=${encodeURIComponent(query.slice(0, 200))}&limit=5`;
      }

      const res = await fetch(searchUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        // Retraction Watch API may return 404 for no results — treat as clean
        if (res.status === 404) {
          return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.85, confidenceFlags: ['No retraction found'] };
        }
        return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.5, confidenceFlags: [`HTTP ${res.status}`] };
      }

      const data = await res.json() as Array<{
        RetractionDOI?: string;
        OriginalPaperDOI?: string;
        Title?: string;
        RetractionNature?: string;
        RetractionDate?: string;
        Reason?: string;
        PMID?: string;
      }>;

      if (!Array.isArray(data) || data.length === 0) {
        return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.85, confidenceFlags: ['No retraction found'] };
      }

      // Found a retraction — this is a NEGATIVE signal
      const retraction = data[0];
      const nature = retraction.RetractionNature ?? 'Retraction';
      const reason = retraction.Reason ?? 'Unknown';
      const retractionDoi = retraction.RetractionDOI ?? null;
      const originalDoi = retraction.OriginalPaperDOI ?? null;

      const confidenceFlags: string[] = [`RETRACTED: ${nature}`, `Reason: ${reason}`];
      if (retraction.RetractionDate) confidenceFlags.push(`Date: ${retraction.RetractionDate}`);

      // Retraction = very low confidence for the claim
      let confidenceScore = 0.05;
      if (nature === 'Expression of Concern') confidenceScore = 0.30;
      else if (nature === 'Correction') confidenceScore = 0.55;

      return {
        found: true,
        sourceId: retractionDoi ?? originalDoi,
        sourceUrl: retractionDoi ? `https://doi.org/${retractionDoi}` : null,
        evidenceRaw: retraction as unknown as Record<string, unknown>,
        confidenceScore,
        confidenceFlags
      };

    } catch (error: unknown) {
      log.error(`Error checking Retraction Watch for '${query}':`, errData(error));
      return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.5, confidenceFlags: [`Error: ${(error as Error).message}`] };
    }
  }
};

registerVertical(retractionWatchAdapter);
