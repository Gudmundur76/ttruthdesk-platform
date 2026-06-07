/**
 * verticalAdapters/clinicalTrialsVertical.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * ClinicalTrials.gov vertical adapter — verifies clinical trial claims against
 * the ClinicalTrials.gov REST API v2.
 *
 * Source contract:
 *   - Schema: nctId, briefTitle, overallStatus, phase, conditions, interventions,
 *             startDate, completionDate, sponsor, enrollmentCount
 *   - Health check: GET /api/v2/studies?query.term=NCT00000001&pageSize=1
 *   - Failure mode: "degrade" — falls back to Insufficient Evidence on API error
 *   - Approval: whitelisted (Priority 2, Source Whitelist Expansion)
 *
 * Deterministic verdict rules:
 *   - trial_id: NCT ID found in registry → Supported; not found → Insufficient Evidence
 *   - trial_status: claimed status matches actual → Supported; mismatch → Contradicted
 *   - intervention: intervention confirmed in registered list → Supported; absent → Contradicted
 *   - trial_phase: phase confirmed → Supported; mismatch → Partially Supported
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";
import {
  fetchTrialByNctId,
  searchClinicalTrials,
  verdictForTrialStatus,
  verdictForIntervention,
} from "../clinicalTrialsAdapter";

// ─── NCT ID detection ─────────────────────────────────────────────────────────

const NCT_ID_RE = /\bNCT\d{8}\b/gi;

// ─── Adapter implementation ────────────────────────────────────────────────────

const clinicalTrialsVerticalAdapter: VerticalAdapter = {
  domainKey: "clinical_trials",
  displayName: "ClinicalTrials.gov (Trial Registry)",
  description:
    "Verifies clinical trial claims (trial registration, status, interventions, phases) " +
    "against the ClinicalTrials.gov registry (REST API v2). " +
    "Covers trial existence, status accuracy, and intervention confirmation.",

  claimExtractorPrompt: `
You are a clinical trial claim extractor. Extract every verifiable clinical trial claim from the text.
Focus on:
- NCT IDs (e.g. "NCT01234567", "ClinicalTrials.gov identifier NCT01234567")
- Trial status claims (e.g. "the trial is recruiting", "the study was completed in 2022", "trial terminated early")
- Intervention claims (e.g. "participants received 500mg of metformin", "the intervention was cognitive behavioural therapy")
- Phase claims (e.g. "Phase 2 trial", "Phase 3 randomised controlled trial")
- Enrollment claims (e.g. "enrolled 450 participants", "sample size of 200")

For each claim, extract:
- claimText: the full claim sentence
- claimType: one of "trial_id", "trial_status", "intervention", "trial_phase", "enrollment"
- extractedValue: the NCT ID, status string, intervention name, phase, or enrollment count

Return JSON array of claims.
`,

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;

    // Check if the claim contains an NCT ID
    const nctMatches = claim.claimText.match(NCT_ID_RE) ?? (query.match(NCT_ID_RE) ?? []);
    const nctId = nctMatches[0] ?? null;

    try {
      if (nctId) {
        // Direct NCT ID lookup — most deterministic path
        const { found, entry, error } = await fetchTrialByNctId(nctId);
        if (!found || !entry) {
          return {
            found: false,
            sourceId: nctId,
            sourceUrl: null,
            evidenceRaw: null,
            confidenceScore: 0.0,
            confidenceFlags: [error ?? `NCT ID ${nctId} not found in ClinicalTrials.gov`],
          };
        }

        // Determine which claim type we're verifying
        const claimLower = claim.claimText.toLowerCase();
        let confidenceScore = 0.9;
        let flags: string[] = [`NCT ID ${nctId} confirmed in ClinicalTrials.gov`];

        if (claimLower.includes("status") || claimLower.includes("recruiting") ||
            claimLower.includes("completed") || claimLower.includes("terminated") ||
            claimLower.includes("active")) {
          // Status verification
          const claimedStatus = query.replace(NCT_ID_RE, "").trim() || entry.overallStatus;
          const statusResult = verdictForTrialStatus(claimedStatus, entry.overallStatus);
          confidenceScore = statusResult.confidenceScore;
          flags = statusResult.flags;
        } else if (claimLower.includes("intervention") || claimLower.includes("received") ||
                   claimLower.includes("treatment") || claimLower.includes("drug") ||
                   claimLower.includes("therapy")) {
          // Intervention verification
          const intervention = query.replace(NCT_ID_RE, "").trim();
          if (intervention) {
            const ivResult = verdictForIntervention(intervention, entry.interventions);
            confidenceScore = ivResult.confidenceScore;
            flags = ivResult.flags;
          }
        } else if (claimLower.includes("phase")) {
          // Phase verification
          const phaseMatch = query.match(/phase\s*([1-4]|I{1,3}V?)/i);
          if (phaseMatch && entry.phase) {
            const claimedPhase = phaseMatch[0].toLowerCase().replace(/\s+/, "");
            const actualPhase = entry.phase.toLowerCase().replace(/\s+/, "");
            if (actualPhase.includes(claimedPhase) || claimedPhase.includes(actualPhase)) {
              confidenceScore = 0.93;
              flags = [`Phase "${entry.phase}" confirmed for ${nctId}`];
            } else {
              confidenceScore = 0.10;
              flags = [`Phase mismatch: claimed "${phaseMatch[0]}", registered "${entry.phase}"`];
            }
          }
        }

        return {
          found: true,
          sourceId: nctId,
          sourceUrl: entry.url,
          evidenceRaw: entry as unknown as Record<string, unknown>,
          confidenceScore,
          confidenceFlags: flags,
        };
      }

      // No NCT ID — search by term
      const result = await searchClinicalTrials(query, 3);
      if (!result.found || result.studies.length === 0) {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.0,
          confidenceFlags: [`No clinical trials found for "${query}"`],
        };
      }
      const primary = result.studies[0];
      return {
        found: true,
        sourceId: primary.nctId,
        sourceUrl: primary.url,
        evidenceRaw: primary as unknown as Record<string, unknown>,
        confidenceScore: 0.55,
        confidenceFlags: [`Best match: ${primary.nctId} — "${primary.briefTitle}"`],
      };
    } catch (err) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.0,
        confidenceFlags: [`ClinicalTrials.gov lookup failed: ${String(err)}`],
      };
    }
  },

  discoverySearchTerms: [
    "randomised controlled trial protein supplement",
    "clinical trial amino acid metabolism",
    "phase 3 trial nutritional intervention",
    "clinical study dietary protein intake",
    "randomised trial muscle protein synthesis",
  ],
};

registerVertical(clinicalTrialsVerticalAdapter);
export default clinicalTrialsVerticalAdapter;
