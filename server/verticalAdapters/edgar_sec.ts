import { registerVertical, VerticalAdapter, EvidenceResult } from "./types";
import { logger, errData } from "../logger";

const log = logger("verticalAdapters/edgar_sec");

/**
 * EDGAR EFTS full-text search response shape.
 * Real API: https://efts.sec.gov/LATEST/search-index
 * Confirmed live response fields via API testing.
 */
interface EdgarHitSource {
  /** Accession number in dashed format, e.g. "0001193125-10-238044" */
  adsh?: string;
  /** CIK numbers, e.g. ["0000320193"] */
  ciks?: string[];
  /** Display names, e.g. ["APPLE INC (AAPL) (CIK 0000320193)"] */
  display_names?: string[];
  /** Filing date, e.g. "2023-11-03" */
  file_date?: string;
  /** File number(s), e.g. ["000-10030"] */
  file_num?: string[];
  /** Root form type(s), e.g. ["10-K"] */
  root_forms?: string[];
  /** Specific form type, e.g. "10-K" */
  form?: string;
  /** Period ending date, e.g. "2023-09-30" */
  period_ending?: string;
  /** Business locations, e.g. ["Cupertino, CA"] */
  biz_locations?: string[];
  /** Short description of the filing document */
  file_description?: string;
}

interface EdgarHit {
  _id?: string;
  _source?: EdgarHitSource;
}

interface EdgarSearchResponse {
  hits?: {
    hits?: EdgarHit[];
    total?: { value: number };
  };
}

/**
 * Build the canonical SEC EDGAR filing URL from an accession number and CIK.
 * Accession number "0001193125-10-238044" → "000119312510238044"
 * URL: https://www.sec.gov/Archives/edgar/data/{CIK}/{accession_nodashes}/
 */
function buildFilingUrl(adsh: string, cik: string): string {
  const accessionNoDashes = adsh.replace(/-/g, "");
  const cikNumeric = cik.replace(/^0+/, ""); // strip leading zeros
  return `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${accessionNoDashes}/`;
}

/** Fetch the EDGAR EFTS search response, returning null on HTTP error. */
async function fetchEdgarSearch(
  query: string
): Promise<EdgarSearchResponse | null> {
  const searchUrl =
    `https://efts.sec.gov/LATEST/search-index` +
    `?q=${encodeURIComponent(query)}` +
    `&dateRange=custom&startdt=2020-01-01` +
    `&forms=10-K,10-Q,8-K`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  const response = await fetch(searchUrl, {
    signal: controller.signal,
    headers: {
      "User-Agent": "citation-engine/1.0 (citation-engine@citation.is)",
      Accept: "application/json",
    },
  });
  clearTimeout(timeoutId);

  if (!response.ok) {
    log.error(`SEC EFTS search failed: HTTP ${response.status}`);
    return null;
  }
  return (await response.json()) as EdgarSearchResponse;
}

/** Build an EvidenceResult from the first EDGAR hit. */
function buildEdgarEvidence(
  hit: EdgarHit,
  totalResults: number
): EvidenceResult {
  const src = hit._source ?? {};
  const adsh = src.adsh ?? hit._id ?? null;
  const cik = src.ciks?.[0] ?? null;
  const filingUrl = adsh && cik ? buildFilingUrl(adsh, cik) : null;
  const entityName =
    src.display_names?.[0]?.split("(")[0]?.trim() ?? cik ?? "Unknown";
  const formType = src.form ?? src.root_forms?.[0] ?? "Filing";
  const fileDate = src.file_date ?? "";
  const sourceId = adsh ?? `${entityName} ${formType} ${fileDate}`.trim();

  return {
    found: true,
    sourceId,
    sourceUrl:
      filingUrl ??
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${formType}&dateb=&owner=include&count=10`,
    evidenceRaw: {
      adsh,
      cik,
      entity_name: entityName,
      form_type: formType,
      file_date: fileDate,
      period_ending: src.period_ending,
      biz_location: src.biz_locations?.[0],
      file_description: src.file_description,
      total_results: totalResults,
    },
    confidenceScore: 0.92,
    confidenceFlags: ["official_sec_filing"],
  };
}

const edgarSecAdapter: VerticalAdapter = {
  domainKey: "edgar_sec",
  displayName: "EDGAR SEC filings",
  description:
    "Adapter for https://efts.sec.gov/ to search SEC filings like 10-K, 10-Q, and 8-K.",
  claimExtractorPrompt:
    "Extract CIK numbers (e.g., CIK0000320193), ticker symbols (e.g., AAPL), or company names from the claim text.",

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const rawQuery = claim.extractedValue?.trim() || claim.claimText.slice(0, 200);
    // Wrap in quotes for exact-match precision — prevents e.g. "Apple Inc" matching "Apple Hospitality REIT"
    const query = rawQuery.includes('"') ? rawQuery : `"${rawQuery}"`;

    try {
      const data = await fetchEdgarSearch(query);

      if (!data) {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: { error: "HTTP error from SEC EFTS" },
          confidenceScore: 0.1,
          confidenceFlags: ["network_error"],
        };
      }

      const hits = data?.hits?.hits ?? [];
      if (hits.length === 0) {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: { message: "No relevant SEC filings found", query },
          confidenceScore: 0.2,
          confidenceFlags: ["no_match"],
        };
      }

      return buildEdgarEvidence(
        hits[0]!,
        data?.hits?.total?.value ?? hits.length
      );
    } catch (error: unknown) {
      log.error("Error during SEC EFTS lookup:", errData(error));
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: {
          error: (error as Error).message ?? "Unknown network error",
        },
        confidenceScore: 0.1,
        confidenceFlags: ["network_error"],
      };
    }
  },

  discoverySearchTerms: [
    "SEC filing",
    "earnings report",
    "annual report",
    "financial disclosure",
    "10-K",
    "10-Q",
    "8-K",
    "CIK number",
    "ticker symbol",
    "EDGAR",
  ],
};

registerVertical(edgarSecAdapter);
