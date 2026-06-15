/**
 * fred.ts — FRED (Federal Reserve Economic Data) Vertical Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Perplexity Doc 2 + Doc 4: Economics domain expansion.
 *
 * Data source: St. Louis Fed FRED API
 *   https://fred.stlouisfed.org/docs/api/fred/
 *   Requires FRED_API_KEY env var (free registration at fred.stlouisfed.org)
 *
 * Covers 250,000+ economic time series:
 *   - GDP, inflation (CPI, PCE), unemployment, interest rates
 *   - Trade balance, money supply, housing starts
 *   - International data from IMF, World Bank, OECD via FRED
 *
 * Graceful degradation: without FRED_API_KEY, the adapter returns a
 * structured "no_api_key" result. The OECD/World Bank adapters cover
 * economics claims in the meantime.
 *
 * Claim matching: activates on GDP, inflation, unemployment, interest rate,
 * recession, monetary policy, and related economic signals.
 */

import { registerVertical } from "./types";
import type { VerticalAdapter, EvidenceResult } from "./types";

// ─── Economic claim signals ───────────────────────────────────────────────────

const ECONOMICS_SIGNALS = [
  /\bgdp\b/i,
  /\bgross\s+domestic\s+product\b/i,
  /\binflation\s+(?:rate|index)?\b/i,
  /\bcpi\b/i,
  /\bpce\b/i,
  /\bunemployment\s+(?:rate)?\b/i,
  /\binterest\s+rate\b/i,
  /\bfederal\s+funds\s+rate\b/i,
  /\brecession\b/i,
  /\bmonetary\s+policy\b/i,
  /\btrade\s+(?:deficit|surplus|balance)\b/i,
  /\bmoney\s+supply\b/i,
  /\bhousing\s+(?:starts|market|prices)\b/i,
  /\bstock\s+market\b/i,
  /\bfed\s+(?:rate|policy|reserve)\b/i,
  /\beconomic\s+(?:growth|output|indicator)\b/i,
  /\bfred\b/i,
  /\bst\.?\s*louis\s+fed\b/i,
];

// Common FRED series IDs for economic claims
const SERIES_KEYWORDS: Record<string, string> = {
  gdp: "GDPC1", // Real GDP
  inflation: "CPIAUCSL", // CPI
  cpi: "CPIAUCSL",
  unemployment: "UNRATE", // Unemployment rate
  "interest rate": "FEDFUNDS", // Federal funds rate
  "federal funds": "FEDFUNDS",
  recession: "USREC", // NBER recession indicator
  "money supply": "M2SL", // M2 money supply
  "trade deficit": "BOPGSTB", // Trade balance
  "housing starts": "HOUST", // Housing starts
};

function matchesEconomicsSignals(text: string): boolean {
  return ECONOMICS_SIGNALS.some(re => re.test(text));
}

function inferSeriesId(claimText: string): string {
  const lower = claimText.toLowerCase();
  for (const [keyword, seriesId] of Object.entries(SERIES_KEYWORDS)) {
    if (lower.includes(keyword)) return seriesId;
  }
  return "GDPC1"; // Default to GDP
}

// ─── FRED API client ──────────────────────────────────────────────────────────

const FRED_BASE = "https://api.stlouisfed.org/fred";

interface FredObservation {
  date: string;
  value: string;
}

interface FredSeries {
  id: string;
  title: string;
  observation_start: string;
  observation_end: string;
  frequency_short: string;
  units_short: string;
  last_updated: string;
}

interface FredSeriesResponse {
  seriess?: FredSeries[];
}

interface FredObsResponse {
  observations?: FredObservation[];
}

async function fetchFredSeries(
  apiKey: string,
  seriesId: string
): Promise<{ series: FredSeries | null; recentObs: FredObservation[] }> {
  const [seriesResp, obsResp] = await Promise.all([
    fetch(
      `${FRED_BASE}/series?series_id=${seriesId}&api_key=${apiKey}&file_type=json`,
      { signal: AbortSignal.timeout(10_000) }
    ),
    fetch(
      `${FRED_BASE}/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=3`,
      { signal: AbortSignal.timeout(10_000) }
    ),
  ]);

  const seriesData = seriesResp.ok
    ? ((await seriesResp.json()) as FredSeriesResponse)
    : null;
  const obsData = obsResp.ok
    ? ((await obsResp.json()) as FredObsResponse)
    : null;

  return {
    series: seriesData?.seriess?.[0] ?? null,
    recentObs: obsData?.observations ?? [],
  };
}

// ─── Vertical adapter ─────────────────────────────────────────────────────────

const fredAdapter: VerticalAdapter = {
  domainKey: "fred",
  displayName: "FRED Economic Data",
  description:
    "Federal Reserve Bank of St. Louis FRED: 250,000+ economic time series including GDP, inflation, unemployment, interest rates, and international data. Requires FRED_API_KEY.",

  claimExtractorPrompt: `
Extract economics-related factual claims from the text.
Focus on: GDP growth rates, inflation rates, unemployment figures, interest rates, trade balances.
Return the specific numeric value if present (e.g. '2.5%', '$21.4 trillion').
`,
  discoverySearchTerms: [
    "GDP growth rate federal reserve FRED",
    "inflation CPI unemployment rate economics",
    "interest rate monetary policy federal funds",
    "recession economic indicator NBER",
  ],

  async lookupEvidence(params): Promise<EvidenceResult> {
    const { claimText } = params;

    if (!matchesEconomicsSignals(claimText)) {
      return {
        found: false,
        sourceId: "fred",
        sourceUrl: "https://fred.stlouisfed.org",
        confidenceScore: 0,
        confidenceFlags: ["claim_not_economics_related"],
        evidenceRaw: null,
      };
    }

    const apiKey = process.env["FRED_API_KEY"];

    if (!apiKey) {
      return {
        found: false,
        sourceId: "fred",
        sourceUrl: "https://fred.stlouisfed.org",
        confidenceScore: 0,
        confidenceFlags: [
          "no_api_key",
          "register_at_fred.stlouisfed.org",
          "set_FRED_API_KEY_env_var",
        ],
        evidenceRaw: {
          note: "FRED API key required. Register free at https://fred.stlouisfed.org/docs/api/api_key.html",
          inferredSeries: inferSeriesId(claimText),
        },
      };
    }

    try {
      const seriesId = inferSeriesId(claimText);
      const { series, recentObs } = await fetchFredSeries(apiKey, seriesId);

      if (!series) {
        return {
          found: false,
          sourceId: "fred",
          sourceUrl: "https://fred.stlouisfed.org",
          confidenceScore: 0.1,
          confidenceFlags: [`series_not_found:${seriesId}`],
          evidenceRaw: null,
        };
      }

      const validObs = recentObs.filter(o => o.value !== ".");
      const latestValue = validObs[0]?.value ?? null;
      const latestDate = validObs[0]?.date ?? null;

      return {
        found: true,
        sourceId: "fred",
        sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`,
        confidenceScore: 0.88,
        confidenceFlags: [
          `series:${seriesId}`,
          `latest_value:${latestValue}_as_of_${latestDate}`,
          `units:${series.units_short}`,
          `frequency:${series.frequency_short}`,
        ],
        evidenceRaw: {
          seriesId,
          title: series.title,
          latestValue,
          latestDate,
          recentObservations: validObs.slice(0, 3),
          sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`,
          lastUpdated: series.last_updated,
        },
      };
    } catch {
      return {
        found: false,
        sourceId: "fred",
        sourceUrl: "https://fred.stlouisfed.org",
        confidenceScore: 0,
        confidenceFlags: ["api_error"],
        evidenceRaw: null,
      };
    }
  },
};

registerVertical(fredAdapter);
