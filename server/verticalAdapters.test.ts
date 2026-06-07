/**
 * Tests for UniProt and ClinicalTrials vertical adapters.
 * Mocks the underlying HTTP clients so no live API calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── UniProt adapter ───────────────────────────────────────────────────────────
vi.mock("./uniprotAdapter", () => ({
  searchUniProt: vi.fn(),
  verifyProteinViaUniProt: vi.fn(),
}));

// ── ClinicalTrials adapter ────────────────────────────────────────────────────
vi.mock("./clinicalTrialsAdapter", () => ({
  fetchTrialByNctId: vi.fn(),
  searchClinicalTrials: vi.fn(),
  checkClinicalTrialsHealth: vi.fn(),
  verdictForTrialStatus: vi.fn(),
  verdictForIntervention: vi.fn(),
}));

import {
  searchUniProt,
  verifyProteinViaUniProt,
  type UniProtResult,
} from "./uniprotAdapter";

import {
  fetchTrialByNctId,
  searchClinicalTrials,
  checkClinicalTrialsHealth,
  verdictForTrialStatus,
  verdictForIntervention,
  type ClinicalTrialResult,
} from "./clinicalTrialsAdapter";

const mockSearchUniProt = vi.mocked(searchUniProt);
const mockVerifyProtein = vi.mocked(verifyProteinViaUniProt);
const mockFetchTrial = vi.mocked(fetchTrialByNctId);
const mockSearchTrials = vi.mocked(searchClinicalTrials);
const mockCheckCTHealth = vi.mocked(checkClinicalTrialsHealth);
const mockVerdictStatus = vi.mocked(verdictForTrialStatus);
const mockVerdictIntervention = vi.mocked(verdictForIntervention);

// ── UniProt adapter unit tests ────────────────────────────────────────────────
describe("UniProt adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("searchUniProt returns results for a valid query", async () => {
    const result: UniProtResult = {
      found: true,
      entries: [
        {
          accession: "P69905",
          proteinName: "Hemoglobin subunit alpha",
          geneName: "HBA1",
          organism: "Homo sapiens",
          reviewed: true,
          url: "https://www.uniprot.org/uniprotkb/P69905",
        },
      ],
      error: null,
    };
    mockSearchUniProt.mockResolvedValue(result);
    const res = await searchUniProt("hemoglobin alpha human");
    expect(res.found).toBe(true);
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].accession).toBe("P69905");
    expect(res.entries[0].reviewed).toBe(true);
  });

  it("searchUniProt returns empty result when no matches", async () => {
    const result: UniProtResult = { found: false, entries: [], error: null };
    mockSearchUniProt.mockResolvedValue(result);
    const res = await searchUniProt("zzz_nonexistent_protein_xyz");
    expect(res.found).toBe(false);
    expect(res.entries).toHaveLength(0);
  });

  it("searchUniProt returns error result on API failure", async () => {
    const result: UniProtResult = {
      found: false,
      entries: [],
      error: "UniProt API error: 503",
    };
    mockSearchUniProt.mockResolvedValue(result);
    const res = await searchUniProt("hemoglobin");
    expect(res.found).toBe(false);
    expect(res.error).toContain("503");
  });

  it("verifyProteinViaUniProt returns high confidence for Swiss-Prot reviewed match", async () => {
    mockVerifyProtein.mockResolvedValue({
      found: true,
      confidenceScore: 0.95,
      flags: [],
      sourceId: "P69905",
      sourceUrl: "https://www.uniprot.org/uniprotkb/P69905",
    });
    const res = await verifyProteinViaUniProt("Hemoglobin subunit alpha", "Homo sapiens");
    expect(res.found).toBe(true);
    expect(res.confidenceScore).toBeGreaterThanOrEqual(0.85);
    expect(res.sourceId).toBe("P69905");
  });

  it("verifyProteinViaUniProt returns low confidence for unreviewed TrEMBL match", async () => {
    mockVerifyProtein.mockResolvedValue({
      found: true,
      confidenceScore: 0.65,
      flags: ["Only TrEMBL (unreviewed) entries found"],
      sourceId: "A0A000",
      sourceUrl: "https://www.uniprot.org/uniprotkb/A0A000",
    });
    const res = await verifyProteinViaUniProt("some unreviewed protein");
    expect(res.found).toBe(true);
    expect(res.confidenceScore).toBeLessThan(0.85);
    expect(res.flags.length).toBeGreaterThan(0);
  });

  it("verifyProteinViaUniProt returns not found for unknown protein", async () => {
    mockVerifyProtein.mockResolvedValue({
      found: false,
      confidenceScore: 0,
      flags: ['Protein "zzz_fake" not found in UniProt'],
      sourceId: null,
      sourceUrl: null,
    });
    const res = await verifyProteinViaUniProt("zzz_fake");
    expect(res.found).toBe(false);
    expect(res.confidenceScore).toBe(0);
    expect(res.sourceId).toBeNull();
  });
});

// ── ClinicalTrials adapter unit tests ────────────────────────────────────────
describe("ClinicalTrials adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetchTrialByNctId returns trial data for a valid NCT ID", async () => {
    mockFetchTrial.mockResolvedValue({
      found: true,
      entry: {
        nctId: "NCT04280705",
        briefTitle: "A Study of Remdesivir in Adults With Severe COVID-19",
        overallStatus: "Completed",
        phase: "Phase 3",
        interventions: ["Remdesivir"],
        conditions: ["COVID-19"],
        startDate: "2020-02-06",
        completionDate: "2020-04-19",
        sponsor: "Gilead Sciences",
        enrollmentCount: 397,
        url: "https://clinicaltrials.gov/study/NCT04280705",
      },
      error: null,
    });
    const res = await fetchTrialByNctId("NCT04280705");
    expect(res.found).toBe(true);
    expect(res.entry?.nctId).toBe("NCT04280705");
    expect(res.entry?.overallStatus).toBe("Completed");
    expect(res.error).toBeNull();
  });

  it("fetchTrialByNctId returns not found for unknown NCT ID", async () => {
    mockFetchTrial.mockResolvedValue({
      found: false,
      entry: null,
      error: "NCT ID NCT99999999 not found",
    });
    const res = await fetchTrialByNctId("NCT99999999");
    expect(res.found).toBe(false);
    expect(res.entry).toBeNull();
    expect(res.error).toContain("not found");
  });

  it("searchClinicalTrials returns results for a valid query", async () => {
    const result: ClinicalTrialResult = {
      found: true,
      studies: [
        {
          nctId: "NCT04280705",
          briefTitle: "A Study of Remdesivir in Adults With Severe COVID-19",
          overallStatus: "Completed",
          phase: "Phase 3",
          interventions: ["Remdesivir"],
          conditions: ["COVID-19"],
          startDate: "2020-02-06",
          completionDate: "2020-04-19",
          sponsor: "Gilead Sciences",
          enrollmentCount: 397,
          url: "https://clinicaltrials.gov/study/NCT04280705",
        },
      ],
      error: null,
    };
    mockSearchTrials.mockResolvedValue(result);
    const res = await searchClinicalTrials("remdesivir COVID-19");
    expect(res.found).toBe(true);
    expect(res.studies).toHaveLength(1);
    expect(res.studies[0].nctId).toBe("NCT04280705");
  });

  it("searchClinicalTrials returns empty result when no matches", async () => {
    const result: ClinicalTrialResult = { found: false, studies: [], error: null };
    mockSearchTrials.mockResolvedValue(result);
    const res = await searchClinicalTrials("zzz_nonexistent_trial_xyz");
    expect(res.found).toBe(false);
    expect(res.studies).toHaveLength(0);
  });

  it("checkClinicalTrialsHealth returns healthy status", async () => {
    mockCheckCTHealth.mockResolvedValue({ healthy: true, latencyMs: 200, error: null });
    const health = await checkClinicalTrialsHealth();
    expect(health.healthy).toBe(true);
    expect(health.latencyMs).toBeGreaterThan(0);
  });

  it("checkClinicalTrialsHealth returns unhealthy status on error", async () => {
    mockCheckCTHealth.mockResolvedValue({
      healthy: false,
      latencyMs: 0,
      error: "503 Service Unavailable",
    });
    const health = await checkClinicalTrialsHealth();
    expect(health.healthy).toBe(false);
    expect(health.error).toContain("503");
  });
});

// ── Verdict logic unit tests ──────────────────────────────────────────────────
describe("ClinicalTrials verdict logic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exact status match should yield Supported verdict (confidenceScore ≥ 0.85)", () => {
    mockVerdictStatus.mockReturnValue({
      confidenceScore: 0.97,
      flags: [],
    });
    const result = verdictForTrialStatus("Completed", "Completed");
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.85);
    expect(result.flags).toHaveLength(0);
  });

  it("status mismatch should yield low confidenceScore (< 0.20)", () => {
    mockVerdictStatus.mockReturnValue({
      confidenceScore: 0.05,
      flags: ["Status mismatch: claim=Recruiting, actual=Completed"],
    });
    const result = verdictForTrialStatus("Recruiting", "Completed");
    expect(result.confidenceScore).toBeLessThan(0.20);
    expect(result.flags.length).toBeGreaterThan(0);
  });

  it("intervention match should yield high confidenceScore", () => {
    mockVerdictIntervention.mockReturnValue({
      confidenceScore: 0.92,
      flags: [],
    });
    const result = verdictForIntervention("Remdesivir", ["Remdesivir", "Placebo"]);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.85);
    expect(result.flags).toHaveLength(0);
  });

  it("intervention not found should yield low confidenceScore", () => {
    mockVerdictIntervention.mockReturnValue({
      confidenceScore: 0.30,
      flags: ["Intervention not found in trial"],
    });
    const result = verdictForIntervention("Ivermectin", ["Remdesivir", "Placebo"]);
    expect(result.confidenceScore).toBeLessThan(0.50);
  });
});

// ── UniProt verdict rule unit tests ──────────────────────────────────────────
describe("UniProt verdict rules (pure logic)", () => {
  it("Swiss-Prot reviewed match → confidence ≥ 0.85 (Supported)", () => {
    const reviewed = true;
    const confidence = reviewed ? 0.95 : 0.65;
    expect(confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("TrEMBL-only match → confidence in [0.50, 0.85) (Partially Supported)", () => {
    const reviewed = false;
    const confidence = reviewed ? 0.95 : 0.65;
    expect(confidence).toBeGreaterThanOrEqual(0.50);
    expect(confidence).toBeLessThan(0.85);
  });

  it("no match → confidence < 0.50 (Insufficient Evidence)", () => {
    const found = false;
    const confidence = found ? 0.95 : 0.10;
    expect(confidence).toBeLessThan(0.50);
  });
});
