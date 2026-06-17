import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";
const log = logger("verticalAdapters/epa");
class EPAAdapter implements VerticalAdapter {
  readonly domainKey = "epa";
  readonly displayName = "US EPA Science Inventory";
  readonly description = "US Environmental Protection Agency research on chemical safety, air/water quality, and environmental health";
  readonly claimExtractorPrompt = "Extract chemical names, pollutant names, EPA regulation numbers, or environmental health topics from the claim.";
  readonly discoverySearchTerms = ["EPA chemical safety","air quality standard","water quality EPA","environmental health","PFAS","pesticide EPA","Superfund"];
  private readonly BASE_URL = "https://cfpub.epa.gov/si/si_public_search_results.cfm";
  private readonly USER_AGENT = "citation.is/1.0 (verification@citation.is)";
  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const blank: EvidenceResult = { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0, confidenceFlags: [] };
    try {
      const q = claim.extractedValue ?? claim.claimText.slice(0, 150);
      const url = `${this.BASE_URL}?keyword=${encodeURIComponent(q)}&outputFormat=json&pagesize=5&sortby=relevance`;
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": this.USER_AGENT }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ...blank, confidenceFlags: [`http_error_${res.status}`] };
      const data = await res.json() as { results?: Array<{ si_id: string; title: string; abstract?: string; pub_year?: string; authors?: string; product_type?: string; url?: string }>; total_records?: number };
      const results = data?.results ?? [];
      if (!results.length) return { ...blank, confidenceFlags: ["no_epa_results"] };
      const top = results[0];
      const productType = top.product_type ?? "EPA Science Publication";
      const flags: string[] = ["epa_science_inventory"];
      if (productType.toLowerCase().includes("journal")) flags.push("epa_peer_reviewed_journal");
      if (productType.toLowerCase().includes("report")) flags.push("epa_technical_report");
      if ((data.total_records ?? 0) > 10) flags.push("high_epa_result_count");
      const sourceUrl = top.url ?? `https://cfpub.epa.gov/si/si_public_record_report.cfm?Lab=NRMRL&dirEntryId=${top.si_id}`;
      log.info("EPA result", { si_id: top.si_id, title: top.title });
      return { found: true, sourceId: `epa-si-${top.si_id}`, sourceUrl, evidenceRaw: { si_id: top.si_id, title: top.title, productType, abstract: top.abstract?.slice(0, 300) }, confidenceScore: 0.84, confidenceFlags: flags };
    } catch (err) {
      log.error("EPA fetch error", { err: String(err) });
      return { ...blank, confidenceFlags: ["network_or_parsing_error"] };
    }
  }
}
registerVertical(new EPAAdapter());
