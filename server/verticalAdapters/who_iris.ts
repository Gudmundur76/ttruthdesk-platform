/**
 * who_iris.ts — Sprint 30
 * WHO IRIS institutional repository adapter
 * API: https://iris.who.int/rest/search
 * Docs: https://iris.who.int/
 */
import {
  registerVertical,
  type EvidenceResult,
  type VerticalAdapter,
} from "./types";

const WHO_IRIS_BASE = "https://iris.who.int/rest/search";

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
  domainKey: "who_iris",
  displayName: "WHO IRIS (World Health Organization Repository)",
  description:
    "WHO Institutional Repository for Information Sharing — primary repository for WHO technical reports, guidelines, and systematic reviews.",
  claimExtractorPrompt:
    "Extract the health topic, disease, or policy area from the claim for WHO IRIS lookup.",
  discoverySearchTerms: [
    "WHO recommendation",
    "World Health Organization",
    "global health policy",
    "WHO guideline",
    "WHO report",
    "global disease burden",
    "WHO essential medicine",
  ],

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    const url = new URL(WHO_IRIS_BASE);
    url.searchParams.set("query", query.slice(0, 200));
    url.searchParams.set("rpp", "5");
    url.searchParams.set("scope", "/");
    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return noResult(["http_error_" + res.status]);
      const data = (await res.json()) as {
        _embedded?: {
          searchResult?: {
            _embedded?: {
              objects?: Array<{
                indexableObject?: {
                  handle?: string;
                  metadata?: Record<string, Array<{ value: string }>>;
                };
              }>;
            };
          };
        };
      };
      const objects = data._embedded?.searchResult?._embedded?.objects ?? [];
      if (objects.length === 0) return noResult(["no_who_iris_results"]);
      const first = objects[0].indexableObject;
      const handle = first?.handle ?? null;
      const title = first?.metadata?.["dc.title"]?.[0]?.value ?? null;
      const date = first?.metadata?.["dc.date.issued"]?.[0]?.value ?? null;
      const type = first?.metadata?.["dc.type"]?.[0]?.value ?? null;
      return {
        found: true,
        sourceId: handle,
        sourceUrl: handle
          ? `https://iris.who.int/handle/${handle}`
          : "https://iris.who.int",
        evidenceRaw: { handle, title, date, type },
        confidenceScore: 0.92,
        confidenceFlags: ["who_primary_source", "intergovernmental_authority"],
      };
    } catch (err) {
      console.error(
        "[verticalAdapters/who_iris] Error fetching from WHO IRIS:",
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
