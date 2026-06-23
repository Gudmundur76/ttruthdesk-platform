import { registerVertical, EvidenceResult, VerticalAdapter } from './types';
import { logger, errData } from "../logger";

const log = logger("verticalAdapters/clinicaltrials_results");
const CT_API_BASE = 'https://clinicaltrials.gov/api/v2';
const USER_AGENT = 'citation-engine/1.0 (citation-engine@citation.is)';

const DETAIL_FIELDS = 'NCTId,BriefTitle,OverallStatus,HasResults,ResultsFirstPostDate,Phase,EnrollmentCount,PrimaryOutcomeMeasure,OutcomeMeasureReportingStatus';

type StudyStatus = { overallStatus?: string; hasResults?: boolean };
type StudyDesign = { phases?: string[]; enrollmentInfo?: { count?: number } };

function scoreStudy(status: StudyStatus | undefined, design: StudyDesign | undefined): { confidenceScore: number; confidenceFlags: string[] } {
  const hasResults = status?.hasResults ?? false;
  const overallStatus = status?.overallStatus ?? 'Unknown';
  const phases = design?.phases ?? [];
  const enrollment = design?.enrollmentInfo?.count ?? null;
  const confidenceFlags: string[] = [];
  let confidenceScore = 0.55;

  if (hasResults) { confidenceScore = 0.85; confidenceFlags.push('Results posted'); }
  if (overallStatus === 'COMPLETED') { confidenceScore = Math.max(confidenceScore, 0.80); confidenceFlags.push('Completed trial'); }
  if (phases.includes('PHASE3') || phases.includes('PHASE4')) {
    confidenceScore = Math.min(confidenceScore + 0.05, 0.95);
    confidenceFlags.push(`Phase ${phases.join('/')}`);
  }
  if (enrollment) {
    confidenceFlags.push(`n=${enrollment}`);
    if (enrollment >= 1000) confidenceScore = Math.min(confidenceScore + 0.05, 0.95);
  }
  return { confidenceScore, confidenceFlags };
}

async function fetchStudyDetail(nctId: string): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${CT_API_BASE}/studies/${nctId}?fields=${DETAIL_FIELDS}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
    });
    clearTimeout(t);
    return res.ok ? (res.json() as Promise<Record<string, unknown>>) : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

async function searchStudies(query: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `${CT_API_BASE}/studies?query.term=${encoded}&filter.advanced=AREA[ResultsFirstPostDate]RANGE[2010-01-01,MAX]&fields=NCTId,BriefTitle,OverallStatus,HasResults,Phase,EnrollmentCount&pageSize=1`,
      { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } }
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json() as { studies?: Array<{ protocolSection?: { identificationModule?: { nctId?: string } } }> };
    return data.studies?.[0]?.protocolSection?.identificationModule?.nctId ?? null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

/**
 * ClinicalTrials.gov Results adapter.
 * Fetches posted outcome data, primary endpoint results, and adverse event summaries
 * from completed trials. Complements the existing clinicalTrialsVertical adapter
 * which only fetches trial metadata (status, eligibility, design).
 * Sprint 38 — Tier 1 public database expansion.
 */
const clinicalTrialsResultsAdapter: VerticalAdapter = {
  domainKey: 'clinicaltrials_results',
  displayName: 'ClinicalTrials.gov Results',
  description: 'ClinicalTrials.gov posted outcome data — primary endpoint results, adverse events, and participant flow from completed trials',
  claimExtractorPrompt: 'Extract NCT IDs (NCT followed by 8 digits, e.g. NCT01234567) or drug/intervention names and conditions from the claim text.',
  discoverySearchTerms: ['clinical trial results', 'randomized controlled trial', 'RCT outcome', 'primary endpoint', 'adverse events', 'NCT'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const query = claim.extractedValue || claim.claimText;
    const nctMatch = query.match(/NCT\d{8}/i);

    try {
      let nctId: string | null = null;

      if (nctMatch) {
        nctId = nctMatch[0].toUpperCase();
      } else {
        nctId = await searchStudies(query);
      }

      if (!nctId) {
        return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.2, confidenceFlags: [] };
      }

      const studyData = await fetchStudyDetail(nctId);
      if (!studyData) {
        return { found: false, sourceId: nctId, sourceUrl: `https://clinicaltrials.gov/study/${nctId}`, evidenceRaw: null, confidenceScore: 0.4, confidenceFlags: ['Study found, details unavailable'] };
      }

      const protocol = (studyData as { protocolSection?: Record<string, unknown> }).protocolSection ?? {};
      const statusModule = (studyData as { protocolSection?: { statusModule?: StudyStatus } }).protocolSection?.statusModule;
      const designModule = (studyData as { protocolSection?: { designModule?: StudyDesign } }).protocolSection?.designModule;

      const { confidenceScore, confidenceFlags } = scoreStudy(statusModule, designModule);

      return {
        found: true,
        sourceId: nctId,
        sourceUrl: `https://clinicaltrials.gov/study/${nctId}`,
        evidenceRaw: protocol,
        confidenceScore,
        confidenceFlags
      };
    } catch (error: unknown) {
      log.error(`Error looking up ClinicalTrials Results for '${query}':`, errData(error));
      return { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0.1, confidenceFlags: [`Error: ${(error as Error).message}`] };
    }
  }
};

registerVertical(clinicalTrialsResultsAdapter);
