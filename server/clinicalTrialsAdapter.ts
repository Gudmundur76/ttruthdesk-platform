/**
 * clinicalTrialsAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * ClinicalTrials.gov REST API v2 client.
 *
 * API docs: https://clinicaltrials.gov/data-api/api
 * Base URL: https://clinicaltrials.gov/api/v2
 *
 * Source contract:
 *   - Schema: nctId, briefTitle, overallStatus, phase, conditions, interventions,
 *             startDate, completionDate, sponsor, enrollmentCount
 *   - Health check: GET /studies?query.term=NCT00000001&pageSize=1
 *   - Failure mode: "degrade" — returns Insufficient Evidence on API error
 *   - Approval: whitelisted (Priority 2, Source Whitelist Expansion)
 */

const CT_BASE = "https://clinicaltrials.gov/api/v2";
const TIMEOUT_MS = 12_000;

export interface ClinicalTrialEntry {
  nctId: string;
  briefTitle: string;
  overallStatus: string;
  phase: string | null;
  conditions: string[];
  interventions: string[];
  startDate: string | null;
  completionDate: string | null;
  sponsor: string | null;
  enrollmentCount: number | null;
  url: string;
}

export interface ClinicalTrialResult {
  found: boolean;
  studies: ClinicalTrialEntry[];
  error: string | null;
}

// ─── NCT ID lookup ─────────────────────────────────────────────────────────────

export async function fetchTrialByNctId(nctId: string): Promise<{
  found: boolean;
  entry: ClinicalTrialEntry | null;
  error: string | null;
}> {
  const id = nctId.toUpperCase().trim();
  try {
    const res = await fetch(
      `${CT_BASE}/studies/${id}?format=json`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (res.status === 404) {
      return { found: false, entry: null, error: `NCT ID ${id} not found` };
    }
    if (!res.ok) {
      return { found: false, entry: null, error: `ClinicalTrials.gov HTTP ${res.status}` };
    }
    const data = await res.json() as Record<string, unknown>;
    const entry = parseClinicalTrialEntry(data);
    return { found: true, entry, error: null };
  } catch (err) {
    return { found: false, entry: null, error: String(err) };
  }
}

// ─── Search by term ────────────────────────────────────────────────────────────

export async function searchClinicalTrials(
  query: string,
  limit = 3
): Promise<ClinicalTrialResult> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `${CT_BASE}/studies?query.term=${encoded}&pageSize=${limit}&format=json`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) {
      return { found: false, studies: [], error: `ClinicalTrials.gov HTTP ${res.status}` };
    }
    const data = await res.json() as Record<string, unknown>;
    const rawStudies = (data?.studies as unknown[]) ?? [];
    const studies = rawStudies.map((s) => parseClinicalTrialEntry(s as Record<string, unknown>));
    return { found: studies.length > 0, studies, error: null };
  } catch (err) {
    return { found: false, studies: [], error: String(err) };
  }
}

// ─── Parser ────────────────────────────────────────────────────────────────────

function parseClinicalTrialEntry(data: Record<string, unknown>): ClinicalTrialEntry {
  const proto = (data?.protocolSection as Record<string, unknown>) ?? {};
  const id = (proto?.identificationModule as Record<string, unknown>) ?? {};
  const status = (proto?.statusModule as Record<string, unknown>) ?? {};
  const design = (proto?.designModule as Record<string, unknown>) ?? {};
  const conds = (proto?.conditionsModule as Record<string, unknown>) ?? {};
  const arms = (proto?.armsInterventionsModule as Record<string, unknown>) ?? {};
  const sponsor = (proto?.sponsorCollaboratorsModule as Record<string, unknown>) ?? {};
  const enroll = (design?.enrollmentInfo as Record<string, unknown>) ?? {};

  const nctId = (id?.nctId as string) ?? "";
  const briefTitle = (id?.briefTitle as string) ?? "";
  const overallStatus = (status?.overallStatus as string) ?? "Unknown";
  const phases = (design?.phases as string[]) ?? [];
  const phase = phases.length > 0 ? phases.join(", ") : null;
  const conditions = (conds?.conditions as string[]) ?? [];
  const interventionList = (arms?.interventions as Array<Record<string, unknown>>) ?? [];
  const interventions = interventionList.map((i) => (i?.name as string) ?? "").filter(Boolean);
  const startDate = (status?.startDateStruct as Record<string, unknown>)?.date as string | null ?? null;
  const completionDate = (status?.completionDateStruct as Record<string, unknown>)?.date as string | null ?? null;
  const sponsorName = (sponsor?.leadSponsor as Record<string, unknown>)?.name as string | null ?? null;
  const enrollmentCount = typeof enroll?.count === "number" ? enroll.count : null;

  return {
    nctId,
    briefTitle,
    overallStatus,
    phase,
    conditions,
    interventions,
    startDate,
    completionDate,
    sponsor: sponsorName,
    enrollmentCount,
    url: `https://clinicaltrials.gov/study/${nctId}`,
  };
}

// ─── Deterministic verdict helpers ────────────────────────────────────────────

/**
 * Verify a trial status claim deterministically.
 * Maps claimed status against the actual overallStatus from ClinicalTrials.gov.
 */
export function verdictForTrialStatus(
  claimedStatus: string,
  actualStatus: string | null
): { confidenceScore: number; flags: string[] } {
  if (!actualStatus) {
    return {
      confidenceScore: 0.0,
      flags: ["Trial status not available from ClinicalTrials.gov"],
    };
  }
  const claimed = claimedStatus.toLowerCase().replace(/[_\s-]/g, "");
  const actual = actualStatus.toLowerCase().replace(/[_\s-]/g, "");

  // Exact match
  if (claimed === actual) {
    return {
      confidenceScore: 0.97,
      flags: [`Trial status "${actualStatus}" confirmed (exact match)`],
    };
  }

  // Semantic equivalence mappings
  const EQUIVALENTS: Record<string, string[]> = {
    completed: ["completed", "terminated", "withdrawn"],
    active: ["recruiting", "activenotrecruiting", "enrollingbyinvitation"],
    recruiting: ["recruiting", "enrollingbyinvitation"],
    notrecruiting: ["activenotrecruiting", "suspended"],
    terminated: ["terminated", "withdrawn"],
  };

  for (const [canonical, variants] of Object.entries(EQUIVALENTS)) {
    if (variants.includes(claimed) && variants.includes(actual)) {
      return {
        confidenceScore: 0.82,
        flags: [`Trial status "${claimedStatus}" semantically matches "${actualStatus}"`],
      };
    }
    void canonical;
  }

  // Mismatch
  return {
    confidenceScore: 0.05,
    flags: [`Trial status mismatch: claimed "${claimedStatus}", actual "${actualStatus}"`],
  };
}

/**
 * Verify an intervention claim against the trial's registered interventions.
 */
export function verdictForIntervention(
  claimedIntervention: string,
  interventions: string[]
): { confidenceScore: number; flags: string[] } {
  if (interventions.length === 0) {
    return {
      confidenceScore: 0.0,
      flags: ["No interventions registered for this trial"],
    };
  }
  const claimed = claimedIntervention.toLowerCase();
  const exactMatch = interventions.some((i) => i.toLowerCase() === claimed);
  if (exactMatch) {
    return {
      confidenceScore: 0.95,
      flags: [`Intervention "${claimedIntervention}" confirmed (exact match)`],
    };
  }
  const partialMatch = interventions.some(
    (i) => i.toLowerCase().includes(claimed) || claimed.includes(i.toLowerCase())
  );
  if (partialMatch) {
    return {
      confidenceScore: 0.75,
      flags: [`Intervention "${claimedIntervention}" partially matched in registered interventions`],
    };
  }
  return {
    confidenceScore: 0.05,
    flags: [
      `Intervention "${claimedIntervention}" not found in registered interventions: ${interventions.slice(0, 3).join(", ")}`,
    ],
  };
}

// ─── Health check ──────────────────────────────────────────────────────────────

export async function checkClinicalTrialsHealth(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error: string | null;
}> {
  const start = Date.now();
  try {
    const res = await fetch(
      `${CT_BASE}/studies?query.term=NCT00000001&pageSize=1&format=json`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { healthy: false, latencyMs, error: `HTTP ${res.status}` };
    }
    const data = await res.json() as Record<string, unknown>;
    const ok = typeof data?.totalCount === "number";
    return {
      healthy: ok,
      latencyMs,
      error: ok ? null : "Unexpected response shape from ClinicalTrials.gov",
    };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
  }
}
