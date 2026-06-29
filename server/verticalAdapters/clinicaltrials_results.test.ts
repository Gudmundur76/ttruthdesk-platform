/**
 * clinicaltrials_results.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("clinicalTrialsResultsAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'clinicaltrials_results'", async () => {
    const { registry } = await import("./types");
    await import("./clinicaltrials_results");
    expect(registry.get("clinicaltrials_results")?.domainKey).toBe(
      "clinicaltrials_results"
    );
  });

  it("returns found=true when NCT ID is in claim text (direct lookup)", async () => {
    // fetchStudyDetail call
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        protocolSection: {
          identificationModule: {
            nctId: "NCT01234567",
            briefTitle: "Metformin vs Placebo in T2DM",
          },
          statusModule: { overallStatus: "COMPLETED", hasResults: true },
          designModule: { phases: ["PHASE3"], enrollmentInfo: { count: 450 } },
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./clinicaltrials_results");
    const adapter = registry.get("clinicaltrials_results");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "NCT01234567 showed metformin reduces HbA1c by 1.2%",
      extractedValue: "NCT01234567",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=true when study is found via keyword search", async () => {
    // searchStudies call
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        studies: [
          {
            protocolSection: { identificationModule: { nctId: "NCT09876543" } },
          },
        ],
      }),
    });
    // fetchStudyDetail call
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        protocolSection: {
          identificationModule: {
            nctId: "NCT09876543",
            briefTitle: "Semaglutide in Obesity",
          },
          statusModule: { overallStatus: "COMPLETED", hasResults: true },
          designModule: { phases: ["PHASE3"], enrollmentInfo: { count: 1200 } },
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./clinicaltrials_results");
    const adapter = registry.get("clinicaltrials_results");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Semaglutide reduces body weight by 15% in obese patients",
      extractedValue: "semaglutide obesity weight loss",
    });
    expect(result.found).toBe(true);
  });

  it("returns found=false when no study is found via keyword search", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ studies: [] }),
    });
    const { registry } = await import("./types");
    await import("./clinicaltrials_results");
    const adapter = registry.get("clinicaltrials_results");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Unknown drug XYZ reduces blood pressure",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./clinicaltrials_results");
    const adapter = registry.get("clinicaltrials_results");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some clinical trial claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
