import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";
const log = logger("verticalAdapters/nasa_earthdata");
class NasaEarthdataAdapter implements VerticalAdapter {
  readonly domainKey = "nasa_earthdata";
  readonly displayName = "NASA Earthdata (CMR)";
  readonly description = "NASA satellite observations, climate datasets, atmospheric science, sea level, ice extent";
  readonly claimExtractorPrompt = "Extract NASA dataset names, mission names (e.g., MODIS, GRACE, Landsat), or climate variables from the claim.";
  readonly discoverySearchTerms = ["climate change","global warming","sea level rise","arctic ice extent","atmospheric CO2","satellite observation","NASA dataset"];
  private readonly BASE_URL = "https://cmr.earthdata.nasa.gov/search";
  private readonly USER_AGENT = "citation.is/1.0 (verification@citation.is)";
  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const blank: EvidenceResult = { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0, confidenceFlags: [] };
    try {
      const q = claim.extractedValue ?? claim.claimText.slice(0, 200);
      const url = `${this.BASE_URL}/collections.json?keyword=${encodeURIComponent(q)}&sort_key=-score&page_size=5`;
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": this.USER_AGENT }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ...blank, confidenceFlags: [`http_error_${res.status}`] };
      interface CmrEntry { id: string; title: string; summary?: string; organizations?: Array<{ short_name: string }>; links?: Array<{ href: string; rel: string }>; score?: number }
      const data = await res.json() as { feed?: { entry?: CmrEntry[] } };
      const entries = data?.feed?.entry ?? [];
      if (!entries.length) return { ...blank, confidenceFlags: ["no_nasa_results"] };
      const top = entries[0];
      const org = top.organizations?.[0]?.short_name ?? "NASA";
      const landingUrl = top.links?.find(l => l.rel?.includes("metadata"))?.href ?? `https://cmr.earthdata.nasa.gov/search/concepts/${top.id}.html`;
      const flags: string[] = ["nasa_satellite_dataset"];
      if (top.score && top.score > 0.8) flags.push("high_relevance_score");
      if (entries.length >= 3) flags.push("multiple_datasets_found");
      log.info("NASA Earthdata result", { id: top.id, title: top.title });
      return { found: true, sourceId: top.id, sourceUrl: landingUrl, evidenceRaw: { id: top.id, title: top.title, org, summary: top.summary?.slice(0, 300) }, confidenceScore: 0.87, confidenceFlags: flags };
    } catch (err) {
      log.error("NASA Earthdata fetch error", { err: String(err) });
      return { ...blank, confidenceFlags: ["network_or_parsing_error"] };
    }
  }
}
registerVertical(new NasaEarthdataAdapter());
