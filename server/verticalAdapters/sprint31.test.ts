/**
 * sprint31.test.ts — Sprint 31 tests
 * Climate/environment adapters: NASA Earthdata, EEA, EPA
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock fetch globally (must be before adapter imports) ────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Import adapters to trigger registerVertical() ───────────────────────────
import "./nasa_earthdata";
import "./eea";
import "./epa";
import { getVertical } from "./types";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── NASA Earthdata ───────────────────────────────────────────────────────────
describe("NasaEarthdataAdapter", () => {
  it("returns found=true with satellite dataset on successful CMR response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        feed: {
          entry: [{
            id: "C2036882064-LAADS",
            title: "MODIS/Terra Surface Temperature Daily L3 Global 0.05Deg CMG",
            summary: "Daily global surface temperature from MODIS Terra instrument.",
            time_start: "2000-02-24T00:00:00.000Z",
            organizations: [{ short_name: "LAADS" }],
            links: [{ href: "https://cmr.earthdata.nasa.gov/search/concepts/C2036882064-LAADS.html", rel: "http://esipfed.org/ns/fedsearch/1.1/metadata#" }],
            score: 0.95,
          }],
        },
      }),
    });

    const adapter = getVertical("nasa_earthdata");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({ claimText: "global surface temperature is rising", extractedValue: null });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("C2036882064-LAADS");
    expect(result.confidenceScore).toBeGreaterThan(0.8);
    expect(result.confidenceFlags).toContain("nasa_satellite_dataset");
    expect(result.confidenceFlags).toContain("high_relevance_score");
  });

  it("returns found=false with no_nasa_results when CMR returns empty entries", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ feed: { entry: [] } }),
    });

    const adapter = getVertical("nasa_earthdata");
    const result = await adapter!.lookupEvidence({ claimText: "obscure claim with no NASA data", extractedValue: null });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_nasa_results");
  });

  it("returns found=false with http_error flag on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const adapter = getVertical("nasa_earthdata");
    const result = await adapter!.lookupEvidence({ claimText: "sea level rise", extractedValue: null });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_503");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network timeout"));

    const adapter = getVertical("nasa_earthdata");
    const result = await adapter!.lookupEvidence({ claimText: "arctic ice extent", extractedValue: null });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("flags multiple_datasets_found when 3+ entries returned", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        feed: {
          entry: [
            { id: "C1", title: "Dataset 1", organizations: [{ short_name: "GSFC" }], links: [] },
            { id: "C2", title: "Dataset 2", organizations: [{ short_name: "GSFC" }], links: [] },
            { id: "C3", title: "Dataset 3", organizations: [{ short_name: "GSFC" }], links: [] },
          ],
        },
      }),
    });

    const adapter = getVertical("nasa_earthdata");
    const result = await adapter!.lookupEvidence({ claimText: "CO2 concentration", extractedValue: null });
    expect(result.confidenceFlags).toContain("multiple_datasets_found");
  });
});

// ─── EEA ─────────────────────────────────────────────────────────────────────
describe("EEAAdapter", () => {
  it("returns found=true with eea_indicator_dataset flag for Indicator type", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{
          "@id": "https://www.eea.europa.eu/data-and-maps/indicators/air-quality-1",
          title: "Air quality in Europe — PM2.5 concentrations",
          description: "Annual mean PM2.5 concentrations across European monitoring stations.",
          effective: "2023-05-15T00:00:00",
          "@type": "Indicator",
        }],
      }),
    });

    const adapter = getVertical("eea");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({ claimText: "PM2.5 air pollution in Europe", extractedValue: null });
    expect(result.found).toBe(true);
    expect(result.sourceUrl).toContain("eea.europa.eu");
    expect(result.confidenceFlags).toContain("eea_official_indicator");
    expect(result.confidenceFlags).toContain("eea_indicator_dataset");
    expect(result.confidenceScore).toBeGreaterThan(0.8);
  });

  it("returns found=false with no_eea_results when items is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    });

    const adapter = getVertical("eea");
    const result = await adapter!.lookupEvidence({ claimText: "obscure claim", extractedValue: null });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_eea_results");
  });

  it("returns found=false with http_error flag on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

    const adapter = getVertical("eea");
    const result = await adapter!.lookupEvidence({ claimText: "European biodiversity", extractedValue: null });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_429");
  });

  it("flags eea_assessment_report for Assessment type", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{
          "@id": "https://www.eea.europa.eu/publications/state-of-nature-in-the-eu",
          title: "State of Nature in the EU",
          description: "Assessment of biodiversity status across EU member states.",
          effective: "2020-10-19T00:00:00",
          "@type": "Assessment",
        }],
      }),
    });

    const adapter = getVertical("eea");
    const result = await adapter!.lookupEvidence({ claimText: "biodiversity loss Europe", extractedValue: null });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("eea_assessment_report");
  });
});

// ─── EPA ─────────────────────────────────────────────────────────────────────
describe("EPAAdapter", () => {
  it("returns found=true with epa_science_inventory flag on successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{
          si_id: "12345",
          title: "Health Effects of PFAS Exposure in Drinking Water",
          abstract: "This study examines the health effects of per- and polyfluoroalkyl substances in drinking water.",
          pub_year: "2022",
          authors: "Smith, J.; Jones, A.",
          product_type: "Journal Article",
          url: "https://cfpub.epa.gov/si/si_public_record_report.cfm?dirEntryId=12345",
        }],
        total_records: 15,
      }),
    });

    const adapter = getVertical("epa");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({ claimText: "PFAS contamination in drinking water causes health problems", extractedValue: "PFAS drinking water" });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("epa-si-12345");
    expect(result.confidenceScore).toBeGreaterThan(0.8);
    expect(result.confidenceFlags).toContain("epa_science_inventory");
    expect(result.confidenceFlags).toContain("epa_peer_reviewed_journal");
    expect(result.confidenceFlags).toContain("high_epa_result_count");
  });

  it("returns found=false with no_epa_results when results is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], total_records: 0 }),
    });

    const adapter = getVertical("epa");
    const result = await adapter!.lookupEvidence({ claimText: "obscure claim", extractedValue: null });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_epa_results");
  });

  it("returns found=false with http_error flag on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const adapter = getVertical("epa");
    const result = await adapter!.lookupEvidence({ claimText: "air quality standards", extractedValue: null });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_500");
  });

  it("flags epa_technical_report for report product type", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{
          si_id: "99999",
          title: "National Ambient Air Quality Standards Review",
          abstract: "Technical report reviewing NAAQS for criteria pollutants.",
          pub_year: "2021",
          authors: "EPA Office of Air Quality",
          product_type: "Technical Report",
          url: null,
        }],
        total_records: 3,
      }),
    });

    const adapter = getVertical("epa");
    const result = await adapter!.lookupEvidence({ claimText: "air quality standards review", extractedValue: null });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("epa_technical_report");
  });

  it("constructs fallback URL when top.url is null", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{
          si_id: "77777",
          title: "Water Quality Study",
          abstract: "Study on water contamination.",
          pub_year: "2020",
          authors: "EPA",
          product_type: "Report",
          url: null,
        }],
        total_records: 1,
      }),
    });

    const adapter = getVertical("epa");
    const result = await adapter!.lookupEvidence({ claimText: "water contamination", extractedValue: null });
    expect(result.found).toBe(true);
    expect(result.sourceUrl).toContain("77777");
  });
});
