/**
 * irena.ts — Sprint 37
 *
 * International Renewable Energy Agency (IRENA) adapter.
 * Queries the IRENA IRENASTAT API for renewable energy capacity,
 * generation, and investment data.
 *
 * API: https://pxweb.irena.org/api/v1/en/IRENASTAT/
 * Docs: https://www.irena.org/Data/Downloads/IRENASTAT
 */
import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/irena");

const IRENA_API_BASE = "https://pxweb.irena.org/api/v1/en/IRENASTAT";
const USER_AGENT = "citation-engine/1.0 (contact@citation.is)";

/** Technology codes used in IRENA dataset queries */
const TECH_MAP: Record<string, { code: string; label: string }> = {
  solar: { code: "SPV", label: "Solar photovoltaic" },
  "solar pv": { code: "SPV", label: "Solar photovoltaic" },
  wind: { code: "WON", label: "Onshore wind" },
  "offshore wind": { code: "WOF", label: "Offshore wind" },
  hydro: { code: "HPP", label: "Hydropower" },
  hydropower: { code: "HPP", label: "Hydropower" },
  geothermal: { code: "GTHG", label: "Geothermal" },
  bioenergy: { code: "BIOG", label: "Bioenergy" },
  biomass: { code: "BIOG", label: "Bioenergy" },
  renewable: { code: "RE", label: "Total renewables" },
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

function detectTechnology(text: string): { code: string; label: string } | null {
  const lower = text.toLowerCase();
  // Check longer phrases first to avoid partial matches
  const entries = Object.entries(TECH_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [keyword, config] of entries) {
    if (lower.includes(keyword)) return config;
  }
  return null;
}

class IrenaAdapter implements VerticalAdapter {
  readonly domainKey = "irena";
  readonly displayName = "IRENA Renewable Energy Statistics";
  readonly description =
    "International Renewable Energy Agency data on installed capacity, generation, and costs for all renewable energy technologies worldwide.";
  readonly claimExtractorPrompt =
    "Extract renewable energy technology terms (solar, wind, hydro, geothermal, bioenergy) and country names from the claim.";
  readonly discoverySearchTerms = [
    "renewable capacity",
    "solar installation",
    "wind farm",
    "hydropower generation",
    "clean energy",
    "energy transition",
    "LCOE renewable",
    "gigawatt installed",
    "renewable investment",
    "green energy",
  ];

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const query = claim.extractedValue ?? claim.claimText;
    log.info("IRENA query", { query });

    const tech = detectTechnology(query);
    if (!tech) {
      return noResult(["no_renewable_technology_detected"]);
    }

    // Query IRENA capacity data via their PX-Web API
    const datasetUrl = `${IRENA_API_BASE}/Power%20Capacity%20and%20Generation/ELECCAP/`;
    const payload = {
      query: [
        { code: "Technology", selection: { filter: "item", values: [tech.code] } },
        { code: "Year", selection: { filter: "top", values: ["1"] } },
      ],
      response: { format: "json" },
    };

    try {
      const res = await fetch(datasetUrl, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12_000),
      });

      if (!res.ok) {
        if (res.status === 404) {
          return noResult(["irena_dataset_not_found", `tech_${tech.code}`]);
        }
        return noResult([`http_error_${res.status}`]);
      }

      const data = (await res.json()) as {
        data?: Array<{ key: string[]; values: string[] }>;
        columns?: Array<{ code: string; text: string }>;
      };

      if (!data?.data || data.data.length === 0) {
        return noResult(["no_irena_capacity_data"]);
      }

      const firstRow = data.data[0];
      const capacityGW = parseFloat(firstRow.values[0] ?? "0") / 1000; // MW → GW

      log.info("IRENA result", { tech: tech.label, capacityGW });

      return {
        found: true,
        sourceId: `irena-${tech.code}-capacity`,
        sourceUrl: `https://www.irena.org/Data/View-data-by-topic/Capacity-and-Generation/Country-Rankings`,
        evidenceRaw: {
          technology: tech.label,
          technologyCode: tech.code,
          capacityGW: Math.round(capacityGW * 10) / 10,
          unit: "GW",
          source: "IRENASTAT",
        },
        confidenceScore: 0.87,
        confidenceFlags: ["irena_official_data", "renewable_capacity", tech.code.toLowerCase()],
      };
    } catch (err) {
      log.error("IRENA fetch error", { err: String(err) });
      return noResult(["network_or_parsing_error"]);
    }
  }
}

registerVertical(new IrenaAdapter());
