/**
 * IMF DataMapper vertical adapter.
 *
 * Uses the IMF DataMapper API (free, no auth required) to verify economics
 * claims about GDP growth, inflation, current account balances, and fiscal
 * indicators. Completes the Economics domain engine alongside FRED and World Bank.
 *
 * API: https://www.imf.org/external/datamapper/api/v1/
 * Indicators: NGDP_RPCH (GDP growth), PCPIPCH (inflation), BCA_NGDPD (current account)
 */

import { registerVertical } from "./types";
import type { VerticalAdapter, EvidenceResult } from "./types";

// ─── IMF indicator inference ──────────────────────────────────────────────────

/** Map claim keywords to IMF DataMapper indicator codes */
const INDICATOR_MAP: Record<string, { code: string; label: string }> = {
  "gdp growth": { code: "NGDP_RPCH", label: "Real GDP Growth Rate (%)" },
  "economic growth": { code: "NGDP_RPCH", label: "Real GDP Growth Rate (%)" },
  "gdp per capita": { code: "NGDPDPC", label: "GDP per Capita (USD)" },
  inflation: { code: "PCPIPCH", label: "Inflation Rate (%)" },
  "consumer price": { code: "PCPIPCH", label: "Inflation Rate (%)" },
  "current account": {
    code: "BCA_NGDPD",
    label: "Current Account Balance (% GDP)",
  },
  "trade balance": {
    code: "BCA_NGDPD",
    label: "Current Account Balance (% GDP)",
  },
  unemployment: { code: "LUR", label: "Unemployment Rate (%)" },
  "fiscal deficit": {
    code: "GGXCNL_NGDP",
    label: "Net Lending/Borrowing (% GDP)",
  },
  "government debt": {
    code: "GGXWDG_NGDP",
    label: "General Government Gross Debt (% GDP)",
  },
  "public debt": {
    code: "GGXWDG_NGDP",
    label: "General Government Gross Debt (% GDP)",
  },
  "purchasing power": { code: "PPPGDP", label: "GDP at PPP (Int. Dollars)" },
};

/** Map country name mentions to ISO 3-letter codes */
const COUNTRY_MAP: Record<string, string> = {
  "united states": "USA",
  usa: "USA",
  "us economy": "USA",
  "us gdp": "USA",
  "us inflation": "USA",
  "us unemployment": "USA",
  "us debt": "USA",
  "us trade": "USA",
  china: "CHN",
  germany: "DEU",
  japan: "JPN",
  "united kingdom": "GBR",
  uk: "GBR",
  france: "FRA",
  india: "IND",
  brazil: "BRA",
  canada: "CAN",
  australia: "AUS",
  "euro area": "EUQ",
  eurozone: "EUQ",
  world: "001",
  global: "001",
  "advanced economies": "110",
  "emerging markets": "200",
};

export function inferImfIndicator(claimText: string): {
  code: string;
  label: string;
} {
  const lower = claimText.toLowerCase();
  for (const [keyword, indicator] of Object.entries(INDICATOR_MAP)) {
    if (lower.includes(keyword)) return indicator;
  }
  return { code: "NGDP_RPCH", label: "Real GDP Growth Rate (%)" };
}

export function inferImfCountry(claimText: string): string {
  const lower = claimText.toLowerCase();
  for (const [name, code] of Object.entries(COUNTRY_MAP)) {
    if (lower.includes(name)) return code;
  }
  return "001"; // World aggregate as default
}

export function matchesEconomicsSignals(claimText: string): boolean {
  const lower = claimText.toLowerCase();
  const signals = [
    "gdp",
    "inflation",
    "unemployment",
    "recession",
    "fiscal",
    "monetary",
    "interest rate",
    "trade",
    "current account",
    "imf",
    "world bank",
    "economic growth",
    "debt",
    "deficit",
  ];
  return signals.some(s => lower.includes(s));
}

// ─── IMF DataMapper API client ────────────────────────────────────────────────

const IMF_BASE = "https://www.imf.org/external/datamapper/api/v1";

interface ImfValues {
  [indicator: string]: {
    [country: string]: {
      [year: string]: number;
    };
  };
}

interface ImfResponse {
  values?: ImfValues;
}

async function fetchImfIndicator(
  indicatorCode: string,
  countryCode: string
): Promise<{ latestYear: string; latestValue: number } | null> {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2]
    .map(String)
    .join(",");
  const url = `${IMF_BASE}/${indicatorCode}/${countryCode}?periods=${years}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) return null;
  const data = (await resp.json()) as ImfResponse;
  const countryData = data?.values?.[indicatorCode]?.[countryCode];
  if (!countryData) return null;
  // Find the most recent year with a value
  for (const year of [currentYear, currentYear - 1, currentYear - 2].map(
    String
  )) {
    if (countryData[year] != null) {
      return { latestYear: year, latestValue: countryData[year] };
    }
  }
  return null;
}

// ─── Vertical adapter ─────────────────────────────────────────────────────────

const imfAdapter: VerticalAdapter = {
  domainKey: "imf",
  displayName: "IMF DataMapper",
  description:
    "International Monetary Fund DataMapper: GDP growth, inflation, unemployment, fiscal balances, and current account data for 190+ countries. Free, no API key required.",
  claimExtractorPrompt: `
Extract macroeconomics-related factual claims from the text.
Focus on: GDP growth rates, inflation rates, unemployment figures, fiscal deficits, current account balances.
Return the specific numeric value and country if present (e.g. 'US GDP grew 2.5% in 2023').
`,
  discoverySearchTerms: [
    "IMF GDP growth rate forecast",
    "inflation rate CPI IMF World Economic Outlook",
    "fiscal deficit government debt IMF",
    "current account balance trade surplus deficit",
  ],
  async lookupEvidence(params): Promise<EvidenceResult> {
    const { claimText } = params;
    if (!matchesEconomicsSignals(claimText)) {
      return {
        found: false,
        sourceId: "imf",
        sourceUrl: "https://www.imf.org/external/datamapper",
        confidenceScore: 0,
        confidenceFlags: ["claim_not_economics_related"],
        evidenceRaw: null,
      };
    }
    try {
      const { code: indicatorCode, label: indicatorLabel } =
        inferImfIndicator(claimText);
      const countryCode = inferImfCountry(claimText);
      const result = await fetchImfIndicator(indicatorCode, countryCode);
      if (!result) {
        return {
          found: false,
          sourceId: "imf",
          sourceUrl: `https://www.imf.org/external/datamapper/${indicatorCode}`,
          confidenceScore: 0.1,
          confidenceFlags: [
            `indicator:${indicatorCode}`,
            `country:${countryCode}`,
            "no_data_for_period",
          ],
          evidenceRaw: null,
        };
      }
      const { latestYear, latestValue } = result;
      return {
        found: true,
        sourceId: "imf",
        sourceUrl: `https://www.imf.org/external/datamapper/${indicatorCode}/${countryCode}`,
        confidenceScore: 0.87,
        confidenceFlags: [
          `indicator:${indicatorCode}`,
          `country:${countryCode}`,
          `year:${latestYear}`,
          `value:${latestValue}`,
        ],
        evidenceRaw: {
          indicatorCode,
          indicatorLabel,
          countryCode,
          latestYear,
          latestValue,
          sourceUrl: `https://www.imf.org/external/datamapper/${indicatorCode}/${countryCode}`,
          dataSource: "IMF DataMapper (free, no API key required)",
        },
      };
    } catch {
      return {
        found: false,
        sourceId: "imf",
        sourceUrl: "https://www.imf.org/external/datamapper",
        confidenceScore: 0,
        confidenceFlags: ["api_error"],
        evidenceRaw: null,
      };
    }
  },
};

registerVertical(imfAdapter);
