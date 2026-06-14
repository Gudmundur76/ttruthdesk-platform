/**
 * clinicalTrialsAdapter.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for clinicalTrialsAdapter.ts pure functions.
 * Network calls are mocked via vi.stubGlobal("fetch").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  verdictForTrialStatus,
  verdictForIntervention,
} from "./clinicalTrialsAdapter";

// ─── verdictForTrialStatus ────────────────────────────────────────────────────

describe("verdictForTrialStatus()", () => {
  it("returns 0.0 when actualStatus is null", () => {
    const result = verdictForTrialStatus("completed", null);
    expect(result.confidenceScore).toBe(0.0);
    expect(result.flags[0]).toContain("not available");
  });

  it("returns 0.97 for exact match", () => {
    const result = verdictForTrialStatus("completed", "Completed");
    expect(result.confidenceScore).toBe(0.97);
    expect(result.flags[0]).toContain("exact match");
  });

  it("returns 0.97 for exact match case-insensitive", () => {
    const result = verdictForTrialStatus("RECRUITING", "Recruiting");
    expect(result.confidenceScore).toBe(0.97);
  });

  it("returns 0.82 for semantic equivalence (recruiting ~ enrollingByInvitation)", () => {
    const result = verdictForTrialStatus("recruiting", "Enrolling by invitation");
    expect(result.confidenceScore).toBe(0.82);
    expect(result.flags[0]).toContain("semantically matches");
  });

  it("returns 0.05 for mismatch", () => {
    const result = verdictForTrialStatus("completed", "Recruiting");
    expect(result.confidenceScore).toBe(0.05);
    expect(result.flags[0]).toContain("mismatch");
  });

  it("handles hyphenated status normalization", () => {
    // Both normalize to 'activenotrecruiting' — exact match
    const result = verdictForTrialStatus("active-not-recruiting", "active-not-recruiting");
    expect(result.confidenceScore).toBe(0.97);
  });
});

// ─── verdictForIntervention ───────────────────────────────────────────────────

describe("verdictForIntervention()", () => {
  it("returns 0.0 when interventions list is empty", () => {
    const result = verdictForIntervention("Drug A", []);
    expect(result.confidenceScore).toBe(0.0);
    expect(result.flags[0]).toContain("No interventions");
  });

  it("returns 0.95 for exact match", () => {
    const result = verdictForIntervention("Drug A", ["Drug A", "Placebo"]);
    expect(result.confidenceScore).toBe(0.95);
    expect(result.flags[0]).toContain("exact match");
  });

  it("returns 0.95 for case-insensitive exact match", () => {
    const result = verdictForIntervention("drug a", ["Drug A"]);
    expect(result.confidenceScore).toBe(0.95);
  });

  it("returns 0.75 for partial match (claimed is substring of registered)", () => {
    const result = verdictForIntervention("Drug", ["Drug A (10mg)", "Placebo"]);
    expect(result.confidenceScore).toBe(0.75);
    expect(result.flags[0]).toContain("partially matched");
  });

  it("returns 0.75 for partial match (registered is substring of claimed)", () => {
    const result = verdictForIntervention("Drug A (10mg tablet)", ["Drug A"]);
    expect(result.confidenceScore).toBe(0.75);
  });

  it("returns 0.05 when no match found", () => {
    const result = verdictForIntervention("Unknown Drug", ["Drug A", "Drug B"]);
    expect(result.confidenceScore).toBe(0.05);
    expect(result.flags[0]).toContain("not found");
  });
});

// ─── checkClinicalTrialsHealth — fetch mock ───────────────────────────────────

describe("checkClinicalTrialsHealth()", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("returns healthy=true when fetch succeeds", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ totalCount: 5, studies: [] }),
    } as Response);
    const { checkClinicalTrialsHealth } = await import("./clinicalTrialsAdapter");
    const result = await checkClinicalTrialsHealth();
    expect(result.healthy).toBe(true);
    expect(result.error).toBeNull();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns healthy=false when fetch fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));
    const { checkClinicalTrialsHealth } = await import("./clinicalTrialsAdapter");
    const result = await checkClinicalTrialsHealth();
    expect(result.healthy).toBe(false);
    expect(result.error).toContain("Network error");
  });
});
