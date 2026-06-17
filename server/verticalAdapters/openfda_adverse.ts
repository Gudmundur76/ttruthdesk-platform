/**
 * openfda_adverse.ts — Sprint 30
 * OpenFDA FAERS Adverse Events adapter
 * API: https://api.fda.gov/drug/event.json
 */
import {
  registerVertical,
  type EvidenceResult,
  type VerticalAdapter,
} from "./types";

const BASE = "https://api.fda.gov/drug/event.json";

function noResult(flags: string[]): EvidenceResult {
  return {
    found: false,
    sourceId: null,
    sourceUrl: null,
    evidenceRaw: null,
    confidenceScore: 0,
    confidenceFlags: flags,
  };
}

const adapter: VerticalAdapter = {
  domainKey: "openfda_adverse",
  displayName: "OpenFDA FAERS Adverse Events",
  description:
    "FDA Adverse Event Reporting System — post-market drug safety signals and pharmacovigilance data.",
  claimExtractorPrompt:
    "Extract the drug name and adverse reaction from the claim.",
  discoverySearchTerms: [
    "adverse event",
    "adverse reaction",
    "side effect",
    "FAERS",
    "pharmacovigilance",
    "drug recall",
    "black box warning",
  ],

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    const drugTerm = query.split(/\s+/)[0] ?? query;
    const url = new URL(BASE);
    url.searchParams.set(
      "search",
      `patient.drug.medicinalproduct:"${drugTerm}"`
    );
    url.searchParams.set("limit", "5");
    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return noResult(["http_error_" + res.status]);
      const data = (await res.json()) as {
        results?: Array<{
          safetyreportid?: string;
          receivedate?: string;
          patient?: {
            drug?: Array<{ medicinalproduct?: string }>;
            reaction?: Array<{ reactionmeddrapt?: string }>;
          };
        }>;
        meta?: { results?: { total?: number } };
      };
      if (!data.results || data.results.length === 0)
        return noResult(["no_faers_results"]);
      const first = data.results[0];
      const total = data.meta?.results?.total ?? data.results.length;
      const confidence = Math.min(
        0.95,
        0.6 + Math.log10(Math.max(1, total)) * 0.1
      );
      return {
        found: true,
        sourceId: first.safetyreportid ?? null,
        sourceUrl: "https://www.fda.gov/safety/faers-public-dashboard",
        evidenceRaw: {
          reportId: first.safetyreportid,
          totalReports: total,
          reactions: first.patient?.reaction?.map(r => r.reactionmeddrapt),
          drugs: first.patient?.drug?.map(d => d.medicinalproduct),
          receiveDate: first.receivedate,
        },
        confidenceScore: confidence,
        confidenceFlags: ["faers_post_market_signal"],
      };
    } catch (err) {
      console.error(
        "[verticalAdapters/openfda_adverse] Error fetching from OpenFDA adverse events:",
        {
          err: err instanceof Error ? err.message : String(err),
          stack:
            err instanceof Error ? err.stack?.replace(/\n/g, " | ") : undefined,
        }
      );
      return noResult(["network_or_parsing_error"]);
    }
  },
};

registerVertical(adapter);
export default adapter;
