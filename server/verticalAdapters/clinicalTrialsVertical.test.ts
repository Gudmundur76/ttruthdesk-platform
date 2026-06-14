/**
 * clinicalTrialsVertical.test.ts
 * Unit tests for server/verticalAdapters/clinicalTrialsVertical.ts
 *
 * clinicalTrialsVertical uses named imports from ../clinicalTrialsAdapter which
 * call fetch internally. We mock fetch to control the behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

// parseClinicalTrialEntry parses the ClinicalTrials.gov v2 API response
const makeCTResponse = (nctId: string, status: string) => ({
  protocolSection: {
    identificationModule: { nctId, briefTitle: "Test Trial" },
    statusModule: { overallStatus: status },
    designModule: { phases: ["PHASE3"] },
    conditionsModule: { conditions: ["Hypertension"] },
    armsInterventionsModule: {
      interventions: [{ name: "Drug A", type: "Drug" }],
    },
    sponsorCollaboratorsModule: {
      leadSponsor: { name: "Test Sponsor" },
    },
    enrollmentInfo: { count: 500 },
    startDateStruct: { date: "2020-01-01" },
    completionDateStruct: { date: "2022-01-01" },
  },
});

describe("clinicalTrialsVerticalAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'clinical_trials'", async () => {
    const { registry } = await import("./types");
    await import("./clinicalTrialsVertical");
    const adapter = registry.get("clinical_trials");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("clinical_trials");
  });

  it("returns found=true when NCT ID is found in ClinicalTrials.gov", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeCTResponse("NCT00000001", "COMPLETED"),
    });
    const { registry } = await import("./types");
    await import("./clinicalTrialsVertical");
    const adapter = registry.get("clinical_trials");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "NCT00000001 is a completed trial",
      extractedValue: "NCT00000001",
    });
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("NCT00000001");
  });

  it("returns found=false when NCT ID returns 404", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    const { registry } = await import("./types");
    await import("./clinicalTrialsVertical");
    const adapter = registry.get("clinical_trials");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "NCT99999999 is a completed trial",
      extractedValue: "NCT99999999",
    });
    expect(result.found).toBe(false);
  });

  it("falls back to search when no NCT ID in claimText", async () => {
    // searchClinicalTrials fetch
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        studies: [makeCTResponse("NCT00000002", "COMPLETED")],
        totalCount: 1,
      }),
    });
    const { registry } = await import("./types");
    await import("./clinicalTrialsVertical");
    const adapter = registry.get("clinical_trials");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Aspirin is effective for pain relief in clinical trials",
      extractedValue: "aspirin pain",
    });
    expect(result.found).toBe(true);
  });

  it("has required VerticalAdapter fields", async () => {
    const { registry } = await import("./types");
    await import("./clinicalTrialsVertical");
    const adapter = registry.get("clinical_trials");
    expect(adapter?.displayName).toBeTruthy();
    expect(adapter?.description).toBeTruthy();
    expect(adapter?.claimExtractorPrompt).toBeTruthy();
    expect(adapter?.discoverySearchTerms).toBeInstanceOf(Array);
  });
});
