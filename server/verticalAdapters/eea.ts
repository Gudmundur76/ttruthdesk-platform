import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";
const log = logger("verticalAdapters/eea");
class EEAAdapter implements VerticalAdapter {
  readonly domainKey = "eea";
  readonly displayName = "European Environment Agency (EEA)";
  readonly description = "European air quality, water quality, biodiversity, climate indicators, and emissions data";
  readonly claimExtractorPrompt = "Extract environmental indicators, pollutants (e.g., PM2.5, NOx), or EEA indicator codes from the claim.";
  readonly discoverySearchTerms = ["European air quality","EEA indicator","European emissions","biodiversity Europe","water quality Europe","climate Europe"];
  private readonly BASE_URL = "https://www.eea.europa.eu/api/SITE";
  private readonly USER_AGENT = "citation.is/1.0 (verification@citation.is)";
  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    const blank: EvidenceResult = { found: false, sourceId: null, sourceUrl: null, evidenceRaw: null, confidenceScore: 0, confidenceFlags: [] };
    try {
      const q = claim.extractedValue ?? claim.claimText.slice(0, 150);
      const url = `${this.BASE_URL}/search?SearchableText=${encodeURIComponent(q)}&portal_type=EEAFigure,Indicator,Assessment&sort_on=effective&sort_order=reverse&b_size=5&format=json`;
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": this.USER_AGENT }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ...blank, confidenceFlags: [`http_error_${res.status}`] };
      const data = await res.json() as { items?: Array<{ "@id": string; title: string; description?: string; effective?: string; "@type"?: string }> };
      const items = data?.items ?? [];
      if (!items.length) return { ...blank, confidenceFlags: ["no_eea_results"] };
      const top = items[0];
      const itemType = top["@type"] ?? "EEA Publication";
      const flags: string[] = ["eea_official_indicator"];
      if (itemType === "Indicator") flags.push("eea_indicator_dataset");
      if (itemType === "Assessment") flags.push("eea_assessment_report");
      if (items.length >= 3) flags.push("multiple_eea_results");
      log.info("EEA result", { id: top["@id"], type: itemType });
      return { found: true, sourceId: top["@id"], sourceUrl: top["@id"], evidenceRaw: { id: top["@id"], title: top.title, type: itemType, description: top.description?.slice(0, 300) }, confidenceScore: 0.85, confidenceFlags: flags };
    } catch (err) {
      log.error("EEA fetch error", { err: String(err) });
      return { ...blank, confidenceFlags: ["network_or_parsing_error"] };
    }
  }
}
registerVertical(new EEAAdapter());
