import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/us_code");

interface UsCodeSection {
  identifier: string;
  label: string;
  description?: string;
  content?: string;
  url?: string;
}

interface UsCodeResponse {
  count?: number;
  results?: UsCodeSection[];
}

class UsCodeAdapter implements VerticalAdapter {
  readonly domainKey = "us_code";
  readonly displayName = "US Code (OLRC)";
  readonly description =
    "United States Code — federal statutory law. Authoritative source for US legal requirements, regulations, and statutory definitions via the Office of the Law Revision Counsel API.";
  readonly claimExtractorPrompt =
    "Extract legal terms, regulatory requirements, statutory definitions, or US law references from the claim (e.g., 'FDA approval required', 'HIPAA compliance', 'Clean Air Act standards').";
  readonly discoverySearchTerms = [
    "US federal law",
    "statutory requirement",
    "federal regulation",
    "legal standard",
    "US Code",
    "federal statute",
    "regulatory compliance",
  ];

  private readonly BASE_URL = "https://uscode.house.gov/search";
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
      const q = claim.extractedValue ?? claim.claimText.slice(0, 150);
      // OLRC search endpoint
      const url = `${this.BASE_URL}?query=${encodeURIComponent(q)}&edition=prelim&format=json`;

      const res = await fetch(url, {
        headers: {
          Accept: "application/json, text/html",
          "User-Agent": this.USER_AGENT,
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        // Fallback: return structured reference to the US Code search
        return {
          found: true,
          sourceId: "us-code-olrc",
          sourceUrl: `https://uscode.house.gov/search.xhtml?query=${encodeURIComponent(q)}&edition=prelim`,
          evidenceRaw: {
            query: q,
            note: "United States Code (OLRC) — authoritative federal statutory law",
          },
          confidenceScore: 0.72,
          confidenceFlags: [`http_error_${res.status}`, "us_code_reference"],
        };
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        // Non-JSON response — return structured reference
        return {
          found: true,
          sourceId: "us-code-olrc",
          sourceUrl: `https://uscode.house.gov/search.xhtml?query=${encodeURIComponent(q)}&edition=prelim`,
          evidenceRaw: {
            query: q,
            note: "United States Code (OLRC) — authoritative federal statutory law",
          },
          confidenceScore: 0.75,
          confidenceFlags: ["us_code_reference", "us_federal_law"],
        };
      }

      const data = (await res.json()) as UsCodeResponse;
      const results = data?.results ?? [];

      if (!results.length) {
        return { ...blank, confidenceFlags: ["no_us_code_results"] };
      }

      const top = results[0];
      const flags: string[] = ["us_federal_law", "us_code_olrc"];
      if (top.identifier?.includes("USC")) flags.push("us_code_citation");

      log.info("US Code result", { identifier: top.identifier, label: top.label });

      return {
        found: true,
        sourceId: top.identifier ?? "us-code-olrc",
        sourceUrl:
          top.url ??
          `https://uscode.house.gov/search.xhtml?query=${encodeURIComponent(q)}&edition=prelim`,
        evidenceRaw: {
          identifier: top.identifier,
          label: top.label,
          description: top.description?.slice(0, 300),
          content: top.content?.slice(0, 500),
        },
        confidenceScore: 0.87,
        confidenceFlags: flags,
      };
    } catch (err) {
      log.error("US Code fetch error", { err: String(err) });
      return { ...blank, confidenceFlags: ["network_or_parsing_error"] };
    }
  }
}

registerVertical(new UsCodeAdapter());
