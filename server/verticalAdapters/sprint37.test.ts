/**
 * sprint37.test.ts — Sprint 37: Energy & Engineering Domain Adapters
 *
 * Tests for:
 *   - iea.ts   — IEA Energy Statistics API
 *   - irena.ts — IRENA Renewable Energy Statistics
 *   - usgs.ts  — USGS Earth Sciences (earthquake + geology)
 *
 * Pattern: vi.resetAllMocks() in beforeEach, static imports, getVertical() lookup.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import "./iea";
import "./irena";
import "./usgs";
import { getVertical } from "./types";

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── IEA adapter ─────────────────────────────────────────────────────────────

describe("IeaAdapter", () => {
  it("registers with domainKey iea", () => {
    expect(getVertical("iea")).toBeDefined();
    expect(getVertical("iea")?.domainKey).toBe("iea");
  });

  it("returns found=true for renewable energy query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { country: "WORLD", product: "RENEWABLES", flow: "TOTPROD", year: 2023, value: 8500, unit: "TJ" },
        { country: "WORLD", product: "RENEWABLES", flow: "TOTPROD", year: 2022, value: 8100, unit: "TJ" },
      ]),
    });
    const adapter = getVertical("iea");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Renewable energy production increased by 5% in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.8);
    expect(result.confidenceFlags).toContain("iea_official_data");
    expect(result.confidenceFlags).toContain("energy_statistics");
  });

  it("returns found=true for solar energy query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { country: "WORLD", product: "SOLAR", flow: "TOTPROD", year: 2023, value: 1200, unit: "TJ" },
      ]),
    });
    const adapter = getVertical("iea");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Solar energy capacity grew significantly",
      extractedValue: "solar power generation",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toContain("iea-SOLAR");
  });

  it("returns found=true for CO2 emissions query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { country: "WORLD", product: "CO2", flow: "CO2COMBUST", year: 2022, value: 36800, unit: "Mt CO2" },
      ]),
    });
    const adapter = getVertical("iea");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Global CO2 emissions from energy combustion reached a record high",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("co2");
  });

  it("returns found=false with no_energy_topic_detected when query has no energy terms", async () => {
    const adapter = getVertical("iea");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "The protein structure was resolved at 2.1 angstrom resolution",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_energy_topic_detected");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns found=false with iea_not_found on 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const adapter = getVertical("iea");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "wind energy statistics",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("iea_not_found");
  });

  it("returns found=false with http_error on 503", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const adapter = getVertical("iea");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "nuclear energy production",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_503");
  });

  it("returns found=false with no_iea_data when API returns empty array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([]),
    });
    const adapter = getVertical("iea");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "coal production statistics",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_iea_data");
  });

  it("returns found=false with no_iea_data_with_values when all values are null", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { country: "WORLD", product: "TOTAL", flow: "TPES", year: 2023, value: null, unit: "TJ" },
      ]),
    });
    const adapter = getVertical("iea");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "total energy supply data",
      extractedValue: "energy",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_iea_data_with_values");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const adapter = getVertical("iea");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "electricity generation statistics",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("has required VerticalAdapter fields", () => {
    const adapter = getVertical("iea");
    expect(adapter?.displayName).toBeTruthy();
    expect(adapter?.description).toBeTruthy();
    expect(adapter?.discoverySearchTerms?.length).toBeGreaterThan(0);
  });
});

// ─── IRENA adapter ───────────────────────────────────────────────────────────

describe("IrenaAdapter", () => {
  it("registers with domainKey irena", () => {
    expect(getVertical("irena")).toBeDefined();
    expect(getVertical("irena")?.domainKey).toBe("irena");
  });

  it("returns found=true for solar PV capacity query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { key: ["SPV", "2023", "WORLD"], values: ["1600000"] }, // 1,600,000 MW = 1600 GW
        ],
        columns: [
          { code: "Technology", text: "Technology" },
          { code: "Year", text: "Year" },
          { code: "Country", text: "Country" },
        ],
      }),
    });
    const adapter = getVertical("irena");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Global solar PV capacity exceeded 1 terawatt",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.8);
    expect(result.confidenceFlags).toContain("irena_official_data");
    expect(result.confidenceFlags).toContain("renewable_capacity");
  });

  it("returns found=true for wind energy query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ key: ["WON", "2023", "WORLD"], values: ["900000"] }],
        columns: [],
      }),
    });
    const adapter = getVertical("irena");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Onshore wind capacity reached 900 GW globally",
      extractedValue: "wind energy capacity",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toContain("irena-WON");
  });

  it("returns found=false with no_renewable_technology_detected for non-energy query", async () => {
    const adapter = getVertical("irena");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "The GDP of Germany grew by 2% in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_renewable_technology_detected");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns found=false with irena_dataset_not_found on 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const adapter = getVertical("irena");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "hydropower generation statistics",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("irena_dataset_not_found");
  });

  it("returns found=false with http_error on 500", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const adapter = getVertical("irena");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "geothermal energy capacity",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_500");
  });

  it("returns found=false with no_irena_capacity_data when data array is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], columns: [] }),
    });
    const adapter = getVertical("irena");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "biomass energy production",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_irena_capacity_data");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
    const adapter = getVertical("irena");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "renewable energy capacity worldwide",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("has required VerticalAdapter fields", () => {
    const adapter = getVertical("irena");
    expect(adapter?.displayName).toBeTruthy();
    expect(adapter?.description).toBeTruthy();
    expect(adapter?.discoverySearchTerms?.length).toBeGreaterThan(0);
  });
});

// ─── USGS adapter ────────────────────────────────────────────────────────────

describe("UsgsAdapter", () => {
  it("registers with domainKey usgs", () => {
    expect(getVertical("usgs")).toBeDefined();
    expect(getVertical("usgs")?.domainKey).toBe("usgs");
  });

  it("returns found=true for earthquake query", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          {
            id: "us7000abc1",
            properties: {
              mag: 7.2,
              place: "150km NW of Anchorage, Alaska",
              time: 1672531200000,
              url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abc1",
              title: "M 7.2 - 150km NW of Anchorage, Alaska",
            },
          },
        ],
        metadata: { count: 1 },
      }),
    });
    const adapter = getVertical("usgs");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "A magnitude 7.2 earthquake struck Alaska in 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.9);
    expect(result.confidenceFlags).toContain("usgs_official_data");
    expect(result.confidenceFlags).toContain("earthquake_catalog");
    expect(result.sourceId).toContain("usgs-eq-us7000abc1");
  });

  it("returns found=true for seismic activity query with default magnitude", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          {
            id: "us7000def2",
            properties: {
              mag: 6.5,
              place: "Pacific Ocean",
              time: 1680000000000,
              url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000def2",
              title: "M 6.5 - Pacific Ocean",
            },
          },
        ],
        metadata: { count: 1 },
      }),
    });
    const adapter = getVertical("usgs");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Seismic activity in the Pacific Ring of Fire",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.evidenceRaw).toHaveProperty("magnitude");
  });

  it("returns found=true for geology/mineral query", async () => {
    // HEAD check for USGS minerals
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    const adapter = getVertical("usgs");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "Lithium mineral deposits in Nevada",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("mineral_resources");
    expect(result.confidenceFlags).toContain("geology");
  });

  it("returns found=false with no_earth_science_topic_detected for unrelated query", async () => {
    const adapter = getVertical("usgs");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "The stock market rose by 3% yesterday",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_earth_science_topic_detected");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns found=false with http_error on non-ok earthquake response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const adapter = getVertical("usgs");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "earthquake magnitude 8.0 occurred",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_503");
  });

  it("returns found=false with no_usgs_earthquake_data when features array is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ features: [], metadata: { count: 0 } }),
    });
    const adapter = getVertical("usgs");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "earthquake magnitude 9.9 event",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_usgs_earthquake_data");
  });

  it("returns found=false with network_or_parsing_error on fetch throw for earthquake", async () => {
    mockFetch.mockRejectedValueOnce(new Error("DNS failure"));
    const adapter = getVertical("usgs");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "seismic tremor detected",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("returns found=false with http_error on non-ok geology response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const adapter = getVertical("usgs");
    expect(adapter).toBeDefined();
    const result = await adapter!.lookupEvidence({
      claimText: "rare earth mineral deposits",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_404");
  });

  it("has required VerticalAdapter fields", () => {
    const adapter = getVertical("usgs");
    expect(adapter?.displayName).toBeTruthy();
    expect(adapter?.description).toBeTruthy();
    expect(adapter?.discoverySearchTerms?.length).toBeGreaterThan(0);
  });
});
