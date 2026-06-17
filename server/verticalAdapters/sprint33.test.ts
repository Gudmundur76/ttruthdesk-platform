/**
 * sprint33.test.ts — Sprint 33 tests
 * Economics/law adapters: BIS Statistics, US Code
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import "./bis_statistics";
import "./us_code";
import { getVertical } from "./types";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── BIS Statistics ───────────────────────────────────────────────────────────
describe("BisStatisticsAdapter", () => {
  it("registers with domainKey bis_statistics", () => {
    expect(getVertical("bis_statistics")).toBeDefined();
  });

  it("returns found=true with keyword-matched dataflow on successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          dataflows: [
            { id: "LBS", name: [{ value: "Locational Banking Statistics" }] },
            { id: "CBS", name: [{ value: "Consolidated Banking Statistics" }] },
            { id: "DEBT_SEC2", name: [{ value: "Debt Securities Statistics" }] },
          ],
        },
      }),
    });

    const adapter = getVertical("bis_statistics");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({
      claimText: "global banking credit growth exceeded 5% in 2023",
      extractedValue: "banking credit growth",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toContain("bis-");
    expect(result.confidenceFlags).toContain("bis_official_statistics");
    expect(result.confidenceFlags).toContain("central_bank_data");
    expect(result.confidenceScore).toBeGreaterThan(0.8);
  });

  it("returns found=false with no_bis_results when dataflows array is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { dataflows: [] } }),
    });

    const adapter = getVertical("bis_statistics");
    const result = await adapter!.lookupEvidence({
      claimText: "some claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_bis_results");
  });

  it("returns found=false with http_error flag on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const adapter = getVertical("bis_statistics");
    const result = await adapter!.lookupEvidence({
      claimText: "foreign exchange market size",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_503");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const adapter = getVertical("bis_statistics");
    const result = await adapter!.lookupEvidence({
      claimText: "derivatives market notional value",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("adds keyword_match flag when claim keywords match dataflow name", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          dataflows: [
            { id: "CNFS", name: [{ value: "Consumer Finance Statistics" }] },
            { id: "DEBT_SEC2", name: [{ value: "Debt Securities Statistics" }] },
          ],
        },
      }),
    });

    const adapter = getVertical("bis_statistics");
    const result = await adapter!.lookupEvidence({
      claimText: "debt securities market grew in 2022",
      extractedValue: "debt securities",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("keyword_match");
  });

  it("returns no_bis_match when dataflows exist but none match", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          dataflows: [],
        },
      }),
    });

    const adapter = getVertical("bis_statistics");
    const result = await adapter!.lookupEvidence({
      claimText: "xyz claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});

// ─── US Code ──────────────────────────────────────────────────────────────────
describe("UsCodeAdapter", () => {
  it("registers with domainKey us_code", () => {
    expect(getVertical("us_code")).toBeDefined();
  });

  it("returns found=true with JSON results on successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        count: 3,
        results: [
          {
            identifier: "21 USC 355",
            label: "New drugs",
            description: "No person shall introduce or deliver for introduction into interstate commerce any new drug...",
            url: "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title21-section355",
          },
        ],
      }),
    });

    const adapter = getVertical("us_code");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({
      claimText: "FDA approval is required before marketing a new drug",
      extractedValue: "FDA drug approval requirement",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("21 USC 355");
    expect(result.confidenceFlags).toContain("us_federal_law");
    expect(result.confidenceFlags).toContain("us_code_olrc");
    expect(result.confidenceScore).toBeGreaterThan(0.8);
  });

  it("returns found=true with fallback reference on non-JSON response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "text/html; charset=utf-8" },
      json: async () => { throw new Error("not JSON"); },
    });

    const adapter = getVertical("us_code");
    const result = await adapter!.lookupEvidence({
      claimText: "HIPAA requires patient data privacy",
      extractedValue: "HIPAA privacy requirement",
    });
    expect(result.found).toBe(true);
    expect(result.sourceUrl).toContain("uscode.house.gov");
    expect(result.confidenceFlags).toContain("us_code_reference");
  });

  it("returns found=true with fallback on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const adapter = getVertical("us_code");
    const result = await adapter!.lookupEvidence({
      claimText: "Clean Air Act emission standards",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("us_code_reference");
  });

  it("returns found=false with no_us_code_results when results array is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ count: 0, results: [] }),
    });

    const adapter = getVertical("us_code");
    const result = await adapter!.lookupEvidence({
      claimText: "obscure legal claim not in US Code",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_us_code_results");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const adapter = getVertical("us_code");
    const result = await adapter!.lookupEvidence({
      claimText: "federal regulation requirement",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("adds us_code_citation flag when identifier contains USC", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        count: 1,
        results: [
          {
            identifier: "42 USC 7401",
            label: "Congressional findings and declaration of purposes",
            description: "Clean Air Act declaration of purposes",
          },
        ],
      }),
    });

    const adapter = getVertical("us_code");
    const result = await adapter!.lookupEvidence({
      claimText: "Clean Air Act purpose",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("us_code_citation");
  });
});
