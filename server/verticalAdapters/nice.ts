import { logger } from "../logger";
const log = logger("verticalAdapters/nice");
/**
 * nice.ts — Sprint 30
 * NICE Evidence UK clinical guidelines adapter
 * API: https://api.nice.org.uk/services/guidance
 * Docs: https://developer.nice.org.uk/
 */
import {
  registerVertical,
  type EvidenceResult,
  type VerticalAdapter,
} from "./types";

const NICE_BASE = "https://api.nice.org.uk/services/guidance";

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
  domainKey: "nice",
  displayName: "NICE Evidence (UK Clinical Guidelines)",
  description:
    "National Institute for Health and Care Excellence — UK clinical guidelines, technology appraisals, and evidence-based recommendations.",
  claimExtractorPrompt:
    "Extract the clinical intervention, condition, or treatment from the claim for NICE guideline lookup.",
  discoverySearchTerms: [
    "clinical guideline",
    "NICE guideline",
    "treatment recommendation",
    "standard of care",
    "evidence-based medicine",
    "technology appraisal",
  ],

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    const url = new URL(NICE_BASE);
    url.searchParams.set("q", query.slice(0, 200));
    url.searchParams.set("pageSize", "5");
    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return noResult(["http_error_" + res.status]);
      const data = (await res.json()) as {
        guidance?: Array<{
          id?: string;
          title?: string;
          type?: string;
          publishedDate?: string;
          url?: string;
        }>;
      };
      if (!data.guidance || data.guidance.length === 0)
        return noResult(["no_nice_results"]);
      const first = data.guidance[0];
      return {
        found: true,
        sourceId: first.id ?? null,
        sourceUrl:
          first.url ?? `https://www.nice.org.uk/guidance/${first.id ?? ""}`,
        evidenceRaw: {
          id: first.id,
          title: first.title,
          type: first.type,
          publishedDate: first.publishedDate,
        },
        confidenceScore: 0.93,
        confidenceFlags: ["nice_clinical_guideline", "uk_regulatory_authority"],
      };
    } catch (err) {
      log.error("Error fetching from NICE Evidence", { err: err instanceof Error ? err.message : String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  },
};

registerVertical(adapter);
export default adapter;
