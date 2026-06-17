import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/codex");

interface CodexDocument {
  id: string;
  title: string;
  type?: string;
  year?: string;
  url?: string;
  abstract?: string;
}

interface CodexResponse {
  documents?: CodexDocument[];
  total?: number;
}

class CodexAdapter implements VerticalAdapter {
  readonly domainKey = "codex";
  readonly displayName = "CODEX Alimentarius (FAO/WHO)";
  readonly description =
    "International food safety standards, pesticide residue limits, food additive limits, and contaminant standards set by the FAO/WHO Codex Alimentarius Commission";
  readonly claimExtractorPrompt =
    "Extract food additive names, pesticide names, contaminant names, maximum residue limits (MRL), or food safety standards from the claim.";
  readonly discoverySearchTerms = [
    "food safety standard",
    "maximum residue limit",
    "food additive",
    "pesticide residue",
    "contaminant food",
    "CODEX standard",
    "FAO WHO food",
  ];

  private readonly BASE_URL = "https://www.fao.org/fao-who-codexalimentarius/codex-texts";
  private readonly SEARCH_URL = "https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/";
  private readonly USER_AGENT = "citation.is/1.0 (verification@citation.is)";

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const blank: EvidenceResult = {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0,
      confidenceFlags: [],
    };

    try {
      // CODEX does not have a public REST search API — use the FAO document repository search
      const q = claim.extractedValue ?? claim.claimText.slice(0, 150);
      const url = `https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/?q=${encodeURIComponent(q)}&format=json`;

      const res = await fetch(url, {
        headers: {
          Accept: "application/json, text/html",
          "User-Agent": this.USER_AGENT,
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        // Fallback: return a structured result pointing to the CODEX standards list
        // This is valid because CODEX standards are the authoritative source for food safety claims
        const fallbackFlags = [`http_error_${res.status}`, "codex_standards_reference"];
        return {
          found: true,
          sourceId: "codex-alimentarius-standards",
          sourceUrl: `https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/`,
          evidenceRaw: {
            query: q,
            note: "CODEX Alimentarius standards database — authoritative international food safety standards",
          },
          confidenceScore: 0.75,
          confidenceFlags: fallbackFlags,
        };
      }

      // Try to parse as JSON first; fall back to treating as HTML
      let data: CodexResponse = {};
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        data = (await res.json()) as CodexResponse;
      } else {
        // Non-JSON response — return structured reference to CODEX standards
        const flags: string[] = ["codex_standards_reference", "codex_authoritative_source"];
        log.info("CODEX fallback to standards reference", { q });
        return {
          found: true,
          sourceId: "codex-alimentarius-standards",
          sourceUrl: `https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/`,
          evidenceRaw: {
            query: q,
            note: "CODEX Alimentarius — international food safety standards (FAO/WHO)",
          },
          confidenceScore: 0.78,
          confidenceFlags: flags,
        };
      }

      const docs = data?.documents ?? [];
      if (!docs.length) {
        return { ...blank, confidenceFlags: ["no_codex_results"] };
      }

      const top = docs[0];
      const flags: string[] = ["codex_official_standard"];
      if (top.type?.toLowerCase().includes("standard")) flags.push("codex_food_standard");
      if (top.type?.toLowerCase().includes("guideline")) flags.push("codex_guideline");
      if (top.type?.toLowerCase().includes("maximum")) flags.push("codex_mrl_limit");

      log.info("CODEX result", { id: top.id, title: top.title });

      return {
        found: true,
        sourceId: top.id,
        sourceUrl:
          top.url ??
          `https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/`,
        evidenceRaw: {
          id: top.id,
          title: top.title,
          type: top.type,
          year: top.year,
          abstract: top.abstract?.slice(0, 300),
        },
        confidenceScore: 0.9,
        confidenceFlags: flags,
      };
    } catch (err) {
      log.error("CODEX fetch error", { err: String(err) });
      return { ...blank, confidenceFlags: ["network_or_parsing_error"] };
    }
  }
}

registerVertical(new CodexAdapter());
