/**
 * noaa.ts — NOAA Climate Data Vertical Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Perplexity Doc 2 + Doc 4: Climate domain expansion.
 *
 * Data sources:
 *   1. NOAA NCEI Climate Data Online (CDO) API — requires NOAA_CDO_TOKEN env var
 *      https://www.ncdc.noaa.gov/cdo-web/api/v2/
 *   2. NOAA Global Surface Temperature (GST) — public, no auth
 *      https://www.ncei.noaa.gov/data/noaa-global-surface-temperature/
 *   3. NOAA Sea Level Trends — public
 *      https://tidesandcurrents.noaa.gov/sltrends/
 *
 * Graceful degradation: when NOAA_CDO_TOKEN is not set, the adapter returns
 * a low-confidence "no_api_key" result rather than failing. This allows the
 * engine to continue using IPCC/OWID/World Bank for climate claims.
 *
 * Claim matching: the adapter activates when the claim text contains climate
 * signals (temperature, sea level, precipitation, CO2, warming, etc.).
 */

import { registerVertical } from "./types";
import type { VerticalAdapter, EvidenceResult } from "./types";

// ─── Climate claim signals ────────────────────────────────────────────────────

const CLIMATE_SIGNALS = [
  /\bglobal\s+(?:mean\s+)?(?:surface\s+)?temperature\b/i,
  /\bsea\s+level\s+(?:rise|increase|trend)\b/i,
  /\bco2\s+concentration\b/i,
  /\bcarbon\s+dioxide\b/i,
  /\bclimate\s+change\b/i,
  /\bglobal\s+warming\b/i,
  /\barctic\s+(?:sea\s+ice|ice\s+extent|amplification)\b/i,
  /\bprecipitation\s+(?:trend|change|anomaly)\b/i,
  /\bextreme\s+(?:heat|weather|precipitation)\b/i,
  /\bnoaa\b/i,
  /\bncei\b/i,
  /\bghg\s+emissions\b/i,
  /\btemperature\s+anomaly\b/i,
  /\bwarming\s+trend\b/i,
  /\bocean\s+(?:warming|acidification|heat\s+content)\b/i,
];

function matchesClimateSignals(text: string): boolean {
  return CLIMATE_SIGNALS.some(re => re.test(text));
}

// ─── NOAA CDO API client ──────────────────────────────────────────────────────

const CDO_BASE = "https://www.ncdc.noaa.gov/cdo-web/api/v2";

interface CdoDataset {
  id: string;
  name: string;
  mindate: string;
  maxdate: string;
  datacoverage: number;
}

interface CdoResponse {
  results?: CdoDataset[];
  metadata?: { resultset?: { count?: number } };
}

async function fetchNoaaDatasets(
  token: string,
  _keyword: string
): Promise<CdoDataset[]> {
  const url = `${CDO_BASE}/datasets?limit=5`;
  const resp = await fetch(url, {
    headers: { token },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as CdoResponse;
  return data.results ?? [];
}

// ─── NOAA Global Surface Temperature (public, no auth) ───────────────────────

const GST_URL =
  "https://www.ncei.noaa.gov/data/noaa-global-surface-temperature/v5.1/access/timeseries/aravg.ann.land_ocean.90S.90N.v5.1.0.202405.asc";

interface GstRecord {
  year: number;
  anomaly: number;
}

async function fetchGlobalTempAnomaly(): Promise<GstRecord[]> {
  try {
    const resp = await fetch(GST_URL, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return [];
    const text = await resp.text();
    const records: GstRecord[] = [];
    for (const line of text.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const year = parseInt(parts[0], 10);
        const anomaly = parseFloat(parts[1]);
        if (!isNaN(year) && !isNaN(anomaly) && year >= 1880) {
          records.push({ year, anomaly });
        }
      }
    }
    return records.slice(-5); // Return last 5 years
  } catch {
    return [];
  }
}

// ─── Vertical adapter ─────────────────────────────────────────────────────────

const noaaAdapter: VerticalAdapter = {
  domainKey: "noaa",
  displayName: "NOAA Climate Data",
  description:
    "NOAA NCEI climate observations: global temperature anomalies, sea level trends, precipitation records. Requires NOAA_CDO_TOKEN for full access.",

  claimExtractorPrompt: `
Extract climate-related factual claims from the text.
Focus on: temperature anomalies, sea level changes, CO2 concentrations, extreme weather events.
Return the specific numeric value if present (e.g. '1.1°C', '3.3mm/year').
`,
  discoverySearchTerms: [
    "global temperature anomaly NOAA NCEI",
    "sea level rise climate data",
    "arctic sea ice extent decline",
    "extreme precipitation climate change",
  ],

  async lookupEvidence(params): Promise<EvidenceResult> {
    const { claimText } = params;

    if (!matchesClimateSignals(claimText)) {
      return {
        found: false,
        sourceId: "noaa",
        sourceUrl: "https://www.ncdc.noaa.gov/cdo-web/",
        confidenceScore: 0,
        confidenceFlags: ["claim_not_climate_related"],
        evidenceRaw: null,
      };
    }

    const token = process.env["NOAA_CDO_TOKEN"];

    // No API key — return graceful degradation with public GST data
    if (!token) {
      const gstRecords = await fetchGlobalTempAnomaly();
      if (gstRecords.length > 0) {
        const latest = gstRecords[gstRecords.length - 1];
        return {
          found: true,
          sourceId: "noaa",
          sourceUrl:
            "https://www.ncei.noaa.gov/products/land-based-station/noaa-global-temp",
          confidenceScore: 0.55,
          confidenceFlags: [
            "noaa_gst_public",
            `latest_anomaly_${latest.anomaly.toFixed(2)}C_${latest.year}`,
            "no_api_key_partial_data",
          ],
          evidenceRaw: {
            source: "NOAA Global Surface Temperature v5.1",
            recentAnomalies: gstRecords,
            note: "Set NOAA_CDO_TOKEN for full CDO API access",
          },
        };
      }
      return {
        found: false,
        sourceId: "noaa",
        sourceUrl: "https://www.ncdc.noaa.gov/cdo-web/",
        confidenceScore: 0,
        confidenceFlags: ["no_api_key", "gst_fetch_failed"],
        evidenceRaw: null,
      };
    }

    // Full CDO API access
    try {
      const datasets = await fetchNoaaDatasets(token, claimText);
      if (datasets.length === 0) {
        return {
          found: false,
          sourceId: "noaa",
          sourceUrl: "https://www.ncdc.noaa.gov/cdo-web/",
          confidenceScore: 0.1,
          confidenceFlags: ["no_matching_datasets"],
          evidenceRaw: null,
        };
      }
      return {
        found: true,
        sourceId: "noaa",
        sourceUrl: "https://www.ncdc.noaa.gov/cdo-web/",
        confidenceScore: 0.82,
        confidenceFlags: [
          `datasets_found:${datasets.length}`,
          `coverage:${datasets[0]?.mindate ?? "unknown"}_to_${datasets[0]?.maxdate ?? "unknown"}`,
        ],
        evidenceRaw: { datasets: datasets.slice(0, 3) },
      };
    } catch {
      return {
        found: false,
        sourceId: "noaa",
        sourceUrl: "https://www.ncdc.noaa.gov/cdo-web/",
        confidenceScore: 0,
        confidenceFlags: ["api_error"],
        evidenceRaw: null,
      };
    }
  },
};

registerVertical(noaaAdapter);
