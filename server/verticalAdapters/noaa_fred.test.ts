/**
 * noaa_fred.test.ts — Ralph Wiggum TDD loop
 * Tests for NOAA climate and FRED economics vertical adapters.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getVertical } from "./types";
import "./noaa";
import "./fred";

// ─── NOAA adapter ─────────────────────────────────────────────────────────────

describe("NOAA vertical adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env["NOAA_CDO_TOKEN"];
  });

  it("is registered with domainKey 'noaa'", () => {
    const adapter = getVertical("noaa");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("noaa");
  });

  it("returns found=false for non-climate claims", async () => {
    const adapter = getVertical("noaa")!;
    const result = await adapter.lookupEvidence({
      claimText: "Lysozyme is an enzyme found in human tears",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("claim_not_climate_related");
  });

  it("returns found=false with no_api_key flag when NOAA_CDO_TOKEN not set and GST fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error"))
    );
    const adapter = getVertical("noaa")!;
    const result = await adapter.lookupEvidence({
      claimText:
        "Global mean surface temperature has risen by 1.1°C since pre-industrial times",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_api_key");
  });

  it("returns partial data from public GST endpoint when no API key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            "2020 0.98\n2021 0.85\n2022 0.89\n2023 1.17\n2024 1.29\n"
          ),
      })
    );
    const adapter = getVertical("noaa")!;
    const result = await adapter.lookupEvidence({
      claimText: "Global warming trend shows temperature anomaly increasing",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.4);
    expect(result.confidenceFlags).toContain("noaa_gst_public");
  });

  it("returns high confidence with CDO API key", async () => {
    process.env["NOAA_CDO_TOKEN"] = "test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              {
                id: "GHCND",
                name: "Daily Summaries",
                mindate: "1763-01-01",
                maxdate: "2024-12-31",
                datacoverage: 1,
              },
            ],
          }),
      })
    );
    const adapter = getVertical("noaa")!;
    const result = await adapter.lookupEvidence({
      claimText: "Arctic sea ice extent is declining at an accelerating rate",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.7);
  });
});

// ─── FRED adapter ─────────────────────────────────────────────────────────────

describe("FRED vertical adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env["FRED_API_KEY"];
  });

  afterEach(() => {
    delete process.env["FRED_API_KEY"];
  });

  it("is registered with domainKey 'fred'", () => {
    const adapter = getVertical("fred");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("fred");
  });

  it("returns found=false for non-economics claims", async () => {
    const adapter = getVertical("fred")!;
    const result = await adapter.lookupEvidence({
      claimText: "Lysozyme is an enzyme found in human tears",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("claim_not_economics_related");
  });

  it("returns no_api_key flag when FRED_API_KEY not set", async () => {
    const adapter = getVertical("fred")!;
    const result = await adapter.lookupEvidence({
      claimText: "US GDP growth rate was 2.5% in Q4 2023",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_api_key");
    expect(result.evidenceRaw).toHaveProperty("inferredSeries", "GDPC1");
  });

  it("infers correct series ID for inflation claims", async () => {
    process.env["FRED_API_KEY"] = "test-key";
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              seriess: [
                {
                  id: "CPIAUCSL",
                  title: "Consumer Price Index",
                  observation_start: "1947-01-01",
                  observation_end: "2024-12-01",
                  frequency_short: "M",
                  units_short: "Index",
                  last_updated: "2024-12-13",
                },
              ],
              observations: [{ date: "2024-12-01", value: "314.175" }],
            }),
        });
      })
    );
    const adapter = getVertical("fred")!;
    await adapter.lookupEvidence({
      claimText: "Inflation rate in the US reached 3.2% in November 2024",
      extractedValue: null,
    });
    expect(capturedUrl).toContain("CPIAUCSL");
  });

  it("returns high confidence with valid FRED API response", async () => {
    process.env["FRED_API_KEY"] = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            seriess: [
              {
                id: "UNRATE",
                title: "Unemployment Rate",
                observation_start: "1948-01-01",
                observation_end: "2024-12-01",
                frequency_short: "M",
                units_short: "Percent",
                last_updated: "2025-01-10",
              },
            ],
            observations: [
              { date: "2024-12-01", value: "4.1" },
              { date: "2024-11-01", value: "4.2" },
            ],
          }),
      })
    );
    const adapter = getVertical("fred")!;
    const result = await adapter.lookupEvidence({
      claimText: "US unemployment rate fell to 4.1% in December 2024",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.8);
    expect(result.evidenceRaw).toHaveProperty("latestValue", "4.1");
  });

  it("handles FRED API errors gracefully", async () => {
    process.env["FRED_API_KEY"] = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error"))
    );
    const adapter = getVertical("fred")!;
    const result = await adapter.lookupEvidence({
      claimText: "GDP growth was 2.8% in 2024",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("api_error");
  });
});
