import { logger } from "../logger";
const log = logger("verticalAdapters/embase");
/**
 * embase.ts — Sprint 30
 * EMBASE European biomedical literature adapter (via Europe PMC EMBASE filter)
 * API: https://www.ebi.ac.uk/europepmc/webservices/rest/search
 * Docs: https://europepmc.org/RestfulWebService
 *
 * EMBASE is not freely queryable directly. We use Europe PMC's EMBASE filter
 * (SRC:EMBASE) which indexes EMBASE records with open metadata.
 */
import {
  registerVertical,
  type EvidenceResult,
  type VerticalAdapter,
} from "./types";

const EUROPE_PMC_BASE =
  "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

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
  domainKey: "embase",
  displayName: "EMBASE (European Biomedical Literature)",
  description:
    "European biomedical and pharmacological literature database — accessed via Europe PMC EMBASE filter. Particularly strong for pharmacology, drug safety, and clinical trials.",
  claimExtractorPrompt:
    "Extract the drug name, compound, or clinical intervention from the claim for EMBASE lookup.",
  discoverySearchTerms: [
    "pharmacokinetics",
    "drug metabolism",
    "clinical pharmacology",
    "European medicine",
    "adverse drug reaction",
    "drug interaction",
    "bioavailability",
  ],

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    const url = new URL(EUROPE_PMC_BASE);
    url.searchParams.set("query", `(${query.slice(0, 150)}) AND SRC:EMBASE`);
    url.searchParams.set("resultType", "core");
    url.searchParams.set("pageSize", "5");
    url.searchParams.set("format", "json");
    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return noResult(["http_error_" + res.status]);
      const data = (await res.json()) as {
        resultList?: {
          result?: Array<{
            pmid?: string;
            doi?: string;
            title?: string;
            authorString?: string;
            journalTitle?: string;
            pubYear?: string;
            citedByCount?: number;
            isOpenAccess?: string;
          }>;
        };
      };
      const results = data.resultList?.result ?? [];
      if (results.length === 0) return noResult(["no_embase_results"]);
      const first = results[0];
      const doi = first.doi ?? null;
      const citedBy = first.citedByCount ?? 0;
      const confidence = Math.min(0.95, 0.75 + Math.min(citedBy, 100) / 400);
      return {
        found: true,
        sourceId: doi ?? first.pmid ?? null,
        sourceUrl: doi
          ? `https://doi.org/${doi}`
          : first.pmid
            ? `https://europepmc.org/article/MED/${first.pmid}`
            : null,
        evidenceRaw: {
          doi,
          pmid: first.pmid,
          title: first.title,
          authors: first.authorString,
          journal: first.journalTitle,
          year: first.pubYear,
          citedByCount: citedBy,
          openAccess: first.isOpenAccess === "Y",
        },
        confidenceScore: confidence,
        confidenceFlags: ["embase_peer_reviewed", "european_biomedical"],
      };
    } catch (err) {
      log.error("Error fetching from EMBASE via Europe PMC", { err: err instanceof Error ? err.message : String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  },
};

registerVertical(adapter);
export default adapter;
