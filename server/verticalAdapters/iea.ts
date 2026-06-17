/**
 * iea.ts — Sprint 37
 *
 * International Energy Agency (IEA) adapter.
 * Queries the IEA public data API for energy statistics, renewable energy,
 * CO2 emissions, and energy security data.
 *
 * API: https://api.iea.org/stats/
 * Docs: https://www.iea.org/data-and-statistics/data-tools/energy-statistics-data-browser
 */
import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/iea");

const IEA_API_BASE = "https://api.iea.org/stats";
const USER_AGENT = "citation-engine/1.0 (contact@citation.is)";

/** Energy topics mapped to IEA product codes */
const TOPIC_MAP: Record<string, { product: string; flow: string; label: string }> = {
  renewable: { product: "RENEWABLES", flow: "TOTPROD", label: "Renewable energy production" },
  solar: { product: "SOLAR", flow: "TOTPROD", label: "Solar energy production" },
  wind: { product: "WIND", flow: "TOTPROD", label: "Wind energy production" },
  nuclear: { product: "NUCLEAR", flow: "TOTPROD", label: "Nuclear energy production" },
  coal: { product: "HARDCOAL", flow: "TOTPROD", label: "Hard coal production" },
  oil: { product: "CRUDEOIL", flow: "TOTPROD", label: "Crude oil production" },
  gas: { product: "NATGAS", flow: "TOTPROD", label: "Natural gas production" },
  co2: { product: "CO2", flow: "CO2COMBUST", label: "CO2 emissions from combustion" },
  electricity: { product: "ELECTR", flow: "TOTPROD", label: "Electricity production" },
  energy: { product: "TOTAL", flow: "TPES", label: "Total primary energy supply" },
};

function noResult(flags: string[]): EvidenceResult {
  return {
    found: false,
    sourceId: null,
    sourceUrl: null,
    evidenceRaw: null,
    confidenceScore: 0,
    confidenceFlags: flags,
  };
}

function detectTopic(text: string): { product: string; flow: string; label: string } | null {
  const lower = text.toLowerCase();
  for (const [keyword, config] of Object.entries(TOPIC_MAP)) {
    if (lower.includes(keyword)) return config;
  }
  return null;
}

class IeaAdapter implements VerticalAdapter {
  readonly domainKey = "iea";
  readonly displayName = "IEA Energy Statistics";
  readonly description =
    "International Energy Agency statistics on energy production, consumption, CO2 emissions, and renewable energy capacity.";
  readonly claimExtractorPrompt =
    "Extract energy-related terms (renewable, solar, wind, nuclear, coal, oil, gas, CO2, electricity) and country names from the claim.";
  readonly discoverySearchTerms = [
    "energy production",
    "renewable energy",
    "solar capacity",
    "wind power",
    "CO2 emissions",
    "electricity generation",
    "energy transition",
    "fossil fuels",
    "nuclear energy",
    "energy security",
  ];

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    log.info("IEA query", { query });

    const topic = detectTopic(query);
    if (!topic) {
      return noResult(["no_energy_topic_detected"]);
    }

    // Query IEA stats API — world aggregate for the detected topic
    const url = `${IEA_API_BASE}?countries=WORLD&products=${topic.product}&flows=${topic.flow}&startYear=2020&endYear=2023&format=json`;

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        if (res.status === 404) {
          return noResult(["iea_not_found", `product_${topic.product}`]);
        }
        return noResult([`http_error_${res.status}`]);
      }

      const data = (await res.json()) as Array<{
        country?: string;
        product?: string;
        flow?: string;
        year?: number;
        value?: number;
        unit?: string;
      }>;

      if (!Array.isArray(data) || data.length === 0) {
        return noResult(["no_iea_data"]);
      }

      // Get the most recent data point
      const sorted = data
        .filter((d) => d.value !== null && d.value !== undefined)
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

      if (!sorted.length) {
        return noResult(["no_iea_data_with_values"]);
      }

      const latest = sorted[0];
      log.info("IEA result", { product: topic.product, year: latest.year, value: latest.value });

      return {
        found: true,
        sourceId: `iea-${topic.product}-${topic.flow}-${latest.year ?? "latest"}`,
        sourceUrl: `https://www.iea.org/data-and-statistics/data-browser?country=WORLD&fuel=${topic.product}&indicator=${topic.flow}`,
        evidenceRaw: {
          product: topic.label,
          productCode: topic.product,
          flow: topic.flow,
          year: latest.year,
          value: latest.value,
          unit: latest.unit ?? "varies",
          country: latest.country ?? "WORLD",
        },
        confidenceScore: 0.88,
        confidenceFlags: ["iea_official_data", "energy_statistics", topic.product.toLowerCase()],
      };
    } catch (err) {
      log.error("IEA fetch error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }
}

registerVertical(new IeaAdapter());
