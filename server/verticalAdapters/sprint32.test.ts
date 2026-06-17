/**
 * sprint32.test.ts — Sprint 32 tests
 * Nutrition/food safety adapters: USDA FoodData Central, CODEX Alimentarius
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import "./usda_fooddata";
import "./codex";
import { getVertical } from "./types";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── USDA FoodData Central ────────────────────────────────────────────────────
describe("UsdaFooddataAdapter", () => {
  it("registers with domainKey usda_fooddata", () => {
    expect(getVertical("usda_fooddata")).toBeDefined();
  });

  it("returns found=true with food nutrient data on successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [
          {
            fdcId: 167514,
            description: "Creatine monohydrate",
            dataType: "SR Legacy",
            foodNutrients: [
              { nutrientName: "Protein", value: 88.0, unitName: "g" },
            ],
          },
        ],
        totalHits: 3,
      }),
    });

    const adapter = getVertical("usda_fooddata");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({
      claimText: "creatine supplementation increases muscle mass",
      extractedValue: "creatine",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("fdc-167514");
    expect(result.sourceUrl).toContain("167514");
    expect(result.confidenceFlags).toContain("usda_official_food_data");
    expect(result.confidenceFlags).toContain("usda_sr_legacy_reference");
    expect(result.confidenceScore).toBeGreaterThan(0.8);
  });

  it("returns found=false with no_usda_results when foods array is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ foods: [], totalHits: 0 }),
    });

    const adapter = getVertical("usda_fooddata");
    const result = await adapter!.lookupEvidence({
      claimText: "obscure compound not in USDA database",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_usda_results");
  });

  it("returns found=false with http_error flag on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    const adapter = getVertical("usda_fooddata");
    const result = await adapter!.lookupEvidence({
      claimText: "vitamin C content in oranges",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("http_error_403");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const adapter = getVertical("usda_fooddata");
    const result = await adapter!.lookupEvidence({
      claimText: "omega-3 fatty acids in salmon",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("adds high_result_count flag when totalHits > 20", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [{ fdcId: 999, description: "Protein powder", dataType: "Foundation" }],
        totalHits: 50,
      }),
    });

    const adapter = getVertical("usda_fooddata");
    const result = await adapter!.lookupEvidence({
      claimText: "protein powder composition",
      extractedValue: "protein",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("high_result_count");
    expect(result.confidenceFlags).toContain("usda_foundation_food");
  });

  it("adds usda_survey_data flag for Survey dataType", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [{ fdcId: 888, description: "Mixed dish", dataType: "Survey (FNDDS)" }],
        totalHits: 1,
      }),
    });

    const adapter = getVertical("usda_fooddata");
    const result = await adapter!.lookupEvidence({
      claimText: "caloric content of mixed dishes",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("usda_survey_data");
  });
});

// ─── CODEX Alimentarius ───────────────────────────────────────────────────────
describe("CodexAdapter", () => {
  it("registers with domainKey codex", () => {
    expect(getVertical("codex")).toBeDefined();
  });

  it("returns found=true with codex_standards_reference on non-JSON response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "text/html; charset=utf-8" },
      json: async () => { throw new Error("not JSON"); },
    });

    const adapter = getVertical("codex");
    expect(adapter).toBeDefined();

    const result = await adapter!.lookupEvidence({
      claimText: "maximum residue limit for glyphosate in wheat",
      extractedValue: "glyphosate MRL wheat",
    });
    expect(result.found).toBe(true);
    expect(result.sourceUrl).toContain("fao.org");
    expect(result.confidenceFlags).toContain("codex_standards_reference");
  });

  it("returns found=true with JSON documents response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        documents: [
          {
            id: "CXS-193-1995",
            title: "General Standard for Contaminants and Toxins in Food and Feed",
            type: "Standard",
            year: "2023",
            url: "https://www.fao.org/fao-who-codexalimentarius/codex-texts/list-standards/en/",
          },
        ],
        total: 5,
      }),
    });

    const adapter = getVertical("codex");
    const result = await adapter!.lookupEvidence({
      claimText: "aflatoxin limits in food",
      extractedValue: "aflatoxin contaminant",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("CXS-193-1995");
    expect(result.confidenceFlags).toContain("codex_official_standard");
    expect(result.confidenceFlags).toContain("codex_food_standard");
    expect(result.confidenceScore).toBeGreaterThan(0.85);
  });

  it("returns found=true with fallback reference on non-200 response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const adapter = getVertical("codex");
    const result = await adapter!.lookupEvidence({
      claimText: "food additive safety",
      extractedValue: null,
    });
    // CODEX returns a structured fallback even on error — it is the authoritative source
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("codex_standards_reference");
  });

  it("returns found=false with no_codex_results when documents array is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ documents: [], total: 0 }),
    });

    const adapter = getVertical("codex");
    const result = await adapter!.lookupEvidence({
      claimText: "obscure food standard not in CODEX",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_codex_results");
  });

  it("returns found=false with network_or_parsing_error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network timeout"));

    const adapter = getVertical("codex");
    const result = await adapter!.lookupEvidence({
      claimText: "pesticide residue limits",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("adds codex_guideline flag for guideline type documents", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        documents: [
          {
            id: "CAC-GL-21-1997",
            title: "Principles and Guidelines for the Establishment of MRLs",
            type: "Guideline",
            year: "2020",
          },
        ],
        total: 1,
      }),
    });

    const adapter = getVertical("codex");
    const result = await adapter!.lookupEvidence({
      claimText: "MRL establishment principles",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("codex_guideline");
  });
});
