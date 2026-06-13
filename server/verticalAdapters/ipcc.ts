/**
 * server/verticalAdapters/ipcc.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * IPCC Assessment Reports adapter.
 *
 * Strategy:
 *   1. Extract IPCC report reference from claim text (AR6, AR5, SR15, SRCCL, etc.)
 *   2. Look up the report DOI via CrossRef (IPCC reports are all DOI-indexed)
 *   3. Fall back to CrossRef keyword search with "IPCC" prefix
 *
 * Confidence: 0.95 for IPCC assessment reports (highest scientific consensus body).
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";

const CROSSREF_BASE = "https://api.crossref.org";
const POLITE_MAILTO = "citation-engine@citation.is";
const USER_AGENT = `citation-engine/1.0 (${POLITE_MAILTO})`;

// Known IPCC report DOIs for direct lookup
const IPCC_REPORT_DOIS: Record<string, string> = {
  ar6_wg1: "10.1017/9781009157896",
  ar6_wg2: "10.1017/9781009325844",
  ar6_wg3: "10.1017/9781009157926",
  ar6_syr: "10.59327/IPCC/AR6-9789291691647",
  ar5_wg1: "10.1017/CBO9781107415324",
  ar5_wg2: "10.1017/CBO9781107415379",
  ar5_wg3: "10.1017/CBO9781107415416",
  sr15: "10.1017/9781009157940",
  srccl: "10.1017/9781009157988",
  srocc: "10.1017/9781009157964",
};

function normaliseReportRef(ref: string): string | null {
  const r = ref.toLowerCase().replace(/\s+/g, "_");
  if (r.includes("ar6") && r.includes("wg1")) return "ar6_wg1";
  if (r.includes("ar6") && r.includes("wg2")) return "ar6_wg2";
  if (r.includes("ar6") && r.includes("wg3")) return "ar6_wg3";
  if (r.includes("ar6")) return "ar6_syr";
  if (r.includes("ar5") && r.includes("wg1")) return "ar5_wg1";
  if (r.includes("ar5") && r.includes("wg2")) return "ar5_wg2";
  if (r.includes("ar5") && r.includes("wg3")) return "ar5_wg3";
  if (r.includes("sr15")) return "sr15";
  if (r.includes("srccl")) return "srccl";
  if (r.includes("srocc")) return "srocc";
  return null;
}

async function lookupByDoi(doi: string): Promise<EvidenceResult> {
  try {
    const res = await fetch(`${CROSSREF_BASE}/works/${encodeURIComponent(doi)}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        found: false, sourceId: doi, sourceUrl: `https://doi.org/${doi}`,
        evidenceRaw: null, confidenceScore: 0.3,
        confidenceFlags: [`CrossRef HTTP ${res.status} for IPCC DOI`],
      };
    }
    const json = await res.json() as { message: Record<string, unknown> };
    const work = json.message;
    const title = (work["title"] as string[])?.[0] ?? "IPCC Report";
    const pubData = work["published"] as { "date-parts": number[][] } | undefined;
    const year = pubData?.["date-parts"]?.[0]?.[0] ?? null;
    return {
      found: true,
      sourceId: doi,
      sourceUrl: `https://doi.org/${doi}`,
      evidenceRaw: { doi, title, year, publisher: work["publisher"] ?? "IPCC", type: "assessment-report" },
      confidenceScore: 0.95,
      confidenceFlags: ["IPCC Assessment Report — highest scientific consensus"],
    };
  } catch (err) {
    return {
      found: false, sourceId: doi, sourceUrl: `https://doi.org/${doi}`,
      evidenceRaw: null, confidenceScore: 0.2,
      confidenceFlags: [`IPCC DOI lookup failed: ${String(err)}`],
    };
  }
}

async function searchCrossRef(query: string): Promise<EvidenceResult> {
  try {
    const params = new URLSearchParams({
      query: `IPCC ${query}`,
      rows: "1",
      select: "DOI,title,published,publisher,score",
      mailto: POLITE_MAILTO,
    });
    const res = await fetch(`${CROSSREF_BASE}/works?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        found: false, sourceId: null, sourceUrl: null,
        evidenceRaw: null, confidenceScore: 0.2,
        confidenceFlags: [`CrossRef search HTTP ${res.status}`],
      };
    }
    const json = await res.json() as { message: { items: Array<Record<string, unknown>> } };
    const item = json.message.items?.[0];
    if (!item || ((item["score"] as number) ?? 0) < 5) {
      return {
        found: false, sourceId: null, sourceUrl: null,
        evidenceRaw: null, confidenceScore: 0.1,
        confidenceFlags: ["No IPCC report found in CrossRef"],
      };
    }
    const doi = item["DOI"] as string;
    const title = (item["title"] as string[])?.[0] ?? "IPCC Report";
    return {
      found: true,
      sourceId: doi,
      sourceUrl: `https://doi.org/${doi}`,
      evidenceRaw: { doi, title, publisher: item["publisher"] ?? "IPCC" },
      confidenceScore: 0.88,
      confidenceFlags: ["IPCC report via CrossRef keyword search"],
    };
  } catch (err) {
    return {
      found: false, sourceId: null, sourceUrl: null,
      evidenceRaw: null, confidenceScore: 0.1,
      confidenceFlags: [`IPCC CrossRef search failed: ${String(err)}`],
    };
  }
}

// Extract IPCC report references: AR3-AR6, SR15, SRCCL, SROCC, WG1-WG3
const IPCC_REF_RE = /\b(AR[3-6](?:\s+WG[1-3])?|SR(?:15|CCL|OCC))\b/gi;

const ipccAdapter: VerticalAdapter = {
  domainKey: "ipcc",
  displayName: "IPCC Assessment Reports",
  description:
    "Verifies climate claims against IPCC Assessment Reports (AR3–AR6) and Special Reports " +
    "(SR15, SRCCL, SROCC). Uses CrossRef DOI lookup for known reports and keyword search " +
    "for general climate claims. Confidence 0.95 — IPCC reports represent the highest " +
    "level of scientific consensus on climate change.",
  claimExtractorPrompt: `
You are a climate science claim extractor. Extract every verifiable factual claim about:
- Climate change, global warming, temperature projections
- Greenhouse gas concentrations and emissions
- Sea level rise, ice sheet loss, extreme weather
- Carbon budgets and mitigation pathways
- References to specific IPCC reports (AR5, AR6, SR15, SRCCL, SROCC)
For each claim, extract:
- The exact claim text
- Any IPCC report reference (e.g. "AR6 WG1", "SR15")
- The specific metric or projection if mentioned
`,
  async lookupEvidence(claim) {
    // 1. Try to extract a known IPCC report reference
    const refs = Array.from(claim.claimText.matchAll(IPCC_REF_RE));
    if (refs.length > 0) {
      const normRef = normaliseReportRef(refs[0][0]);
      if (normRef && IPCC_REPORT_DOIS[normRef]) {
        return lookupByDoi(IPCC_REPORT_DOIS[normRef]);
      }
    }
    // 2. Fall back to CrossRef keyword search
    const query = claim.extractedValue ?? claim.claimText.substring(0, 120);
    return searchCrossRef(query);
  },
  discoverySearchTerms: [
    "climate change global warming temperature",
    "greenhouse gas emissions carbon budget",
    "sea level rise ice sheet melting",
    "IPCC assessment report climate projections",
    "carbon emissions mitigation pathway",
    "extreme weather events climate attribution",
    "net zero emissions decarbonisation",
  ],
};

registerVertical(ipccAdapter);
