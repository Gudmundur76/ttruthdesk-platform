/**
 * openCitationsEnricher.test.ts
 *
 * Phase 115 — Stage 3.5 OpenCitations enrichment tests.
 *
 * Tests cover:
 *   1. openCitationsEnricher — DOI extraction, adapter delegation, retraction flag
 *   2. computeCompositeTruth — new citationAuthorityScore + isRetracted inputs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the vertical adapter registry ──────────────────────────────────────

const mockLookupEvidence = vi.fn();

vi.mock("./verticalAdapters/types", () => ({
  getVertical: vi.fn((key: string) => {
    if (key === "opencitations") {
      return { lookupEvidence: mockLookupEvidence };
    }
    return null;
  }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { openCitationsEnrichClaim } from "./openCitationsEnricher";
import { computeCompositeTruth } from "./compositeTruthEngine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OC_FOUND_HIGH = {
  found: true,
  sourceId: "doi:10.1234/test",
  sourceUrl: "https://doi.org/10.1234/test",
  evidenceRaw: { citationCount: 600, doi: "10.1234/test" },
  confidenceScore: 0.92,
  confidenceFlags: ["Cited 600 times (OpenCitations)", "ORCID-verified authors: 0000-0001-2345-6789"],
};

const OC_FOUND_LOW = {
  found: true,
  sourceId: "doi:10.1234/lowcite",
  sourceUrl: "https://doi.org/10.1234/lowcite",
  evidenceRaw: { citationCount: 2, doi: "10.1234/lowcite" },
  confidenceScore: 0.28,
  confidenceFlags: ["Cited 2 times (OpenCitations)"],
};

const OC_RETRACTED = {
  found: true,
  sourceId: "doi:10.1234/retracted",
  sourceUrl: "https://doi.org/10.1234/retracted",
  evidenceRaw: { citationCount: 50, doi: "10.1234/retracted" },
  confidenceScore: 0.30,
  confidenceFlags: ["⚠ RETRACTION NOTICE", "Type: retraction notice"],
};

const OC_NOT_FOUND = {
  found: false,
  sourceId: "doi:10.9999/missing",
  sourceUrl: "https://doi.org/10.9999/missing",
  evidenceRaw: null,
  confidenceScore: 0.25,
  confidenceFlags: ["OpenCitations Meta: DOI not found — 10.9999/missing"],
};

// ─── openCitationsEnrichClaim tests ──────────────────────────────────────────

describe("openCitationsEnrichClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when claim has no DOI", async () => {
    const result = await openCitationsEnrichClaim(
      "The protein has a resolution of 2.1 Å",
      null
    );
    expect(result).toBeNull();
    expect(mockLookupEvidence).not.toHaveBeenCalled();
  });

  it("extracts DOI from claim text and calls adapter", async () => {
    mockLookupEvidence.mockResolvedValue(OC_FOUND_HIGH);
    const result = await openCitationsEnrichClaim(
      "Paper 10.1234/test reports a resolution of 2.1 Å",
      null
    );
    expect(mockLookupEvidence).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
    expect(result!.doi).toBe("10.1234/test");
  });

  it("prefers DOI from extractedValue over claim text", async () => {
    mockLookupEvidence.mockResolvedValue(OC_FOUND_HIGH);
    await openCitationsEnrichClaim(
      "Some claim text with 10.9999/other",
      "10.1234/test"
    );
    const callArg = mockLookupEvidence.mock.calls[0][0];
    expect(callArg.extractedValue).toBe("10.1234/test");
  });

  it("returns citationAuthorityScore from adapter confidenceScore", async () => {
    mockLookupEvidence.mockResolvedValue(OC_FOUND_HIGH);
    const result = await openCitationsEnrichClaim(
      "See 10.1234/test for details",
      null
    );
    expect(result!.citationAuthorityScore).toBe(0.92);
  });

  it("returns isRetracted:false when no retraction flag", async () => {
    mockLookupEvidence.mockResolvedValue(OC_FOUND_HIGH);
    const result = await openCitationsEnrichClaim(
      "See 10.1234/test for details",
      null
    );
    expect(result!.isRetracted).toBe(false);
  });

  it("returns isRetracted:true when retraction flag is present", async () => {
    mockLookupEvidence.mockResolvedValue(OC_RETRACTED);
    const result = await openCitationsEnrichClaim(
      "See 10.1234/retracted for details",
      null
    );
    expect(result!.isRetracted).toBe(true);
  });

  it("returns null when adapter returns found:false", async () => {
    mockLookupEvidence.mockResolvedValue(OC_NOT_FOUND);
    const result = await openCitationsEnrichClaim(
      "See 10.9999/missing for details",
      null
    );
    expect(result).toBeNull();
  });

  it("returns citationCount from evidenceRaw", async () => {
    mockLookupEvidence.mockResolvedValue(OC_FOUND_HIGH);
    const result = await openCitationsEnrichClaim(
      "See 10.1234/test for details",
      null
    );
    expect(result!.citationCount).toBe(600);
  });

  it("returns citationCount:0 when evidenceRaw has no citationCount", async () => {
    mockLookupEvidence.mockResolvedValue({
      ...OC_FOUND_HIGH,
      evidenceRaw: { doi: "10.1234/test" },
    });
    const result = await openCitationsEnrichClaim(
      "See 10.1234/test for details",
      null
    );
    expect(result!.citationCount).toBe(0);
  });

  it("returns null and does not throw when adapter throws", async () => {
    mockLookupEvidence.mockRejectedValue(new Error("Network error"));
    const result = await openCitationsEnrichClaim(
      "See 10.1234/test for details",
      null
    );
    expect(result).toBeNull();
  });
});

// ─── computeCompositeTruth Stage 3.5 inputs ──────────────────────────────────

describe("computeCompositeTruth — Stage 3.5 citationAuthorityScore", () => {
  it("no OC data: score equals base score (Supported, no chain, no provenance)", () => {
    const result = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
    });
    // Base score for Supported = 0.90
    expect(result.score).toBe(0.9);
  });

  it("high OC authority (≥ 0.80): applies +0.05 bonus", () => {
    const withOc = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
      citationAuthorityScore: 0.92,
    });
    const withoutOc = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
    });
    expect(withOc.score).toBeCloseTo(withoutOc.score + 0.05, 4);
  });

  it("low OC authority (≤ 0.30): applies −0.10 penalty", () => {
    const withLow = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
      citationAuthorityScore: 0.28,
    });
    const withoutOc = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
    });
    expect(withLow.score).toBeCloseTo(withoutOc.score - 0.10, 4);
  });

  it("retraction flag: applies −0.30 penalty (Phase 115); bonus still applies if authority ≥ 0.80", () => {
    const retracted = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
      citationAuthorityScore: 0.92,
      isRetracted: true,
    });
    const withoutOc = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
    });
    // Phase 115: isRetracted penalty = −0.30; ocBonus still fires (+0.05) → net −0.25
    expect(retracted.score).toBeCloseTo(withoutOc.score - 0.25, 4);
  });

  it("mid-range OC authority (0.31–0.79): no adjustment", () => {
    const mid = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
      citationAuthorityScore: 0.55,
    });
    const withoutOc = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
    });
    expect(mid.score).toBe(withoutOc.score);
  });

  it("score is clamped to [0, 1]", () => {
    const result = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: 0.9,
      chainDistortionScore: null,
      citationAuthorityScore: 0.95,
    });
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("retraction rationale mentions ⚠ OpenCitations", () => {
    const result = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
      isRetracted: true,
    });
    expect(result.rationale).toContain("⚠ OpenCitations");
    expect(result.rationale).toContain("retraction");
  });

  it("high authority rationale mentions boosted", () => {
    const result = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
      citationAuthorityScore: 0.88,
    });
    expect(result.rationale).toContain("OpenCitations");
    expect(result.rationale).toContain("boosted");
  });

  it("low authority rationale mentions penalised", () => {
    const result = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
      citationAuthorityScore: 0.20,
    });
    expect(result.rationale).toContain("OpenCitations");
    expect(result.rationale).toContain("penalised");
  });

  it("mid-range authority rationale mentions no adjustment", () => {
    const result = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
      citationAuthorityScore: 0.60,
    });
    expect(result.rationale).toContain("OpenCitations");
    expect(result.rationale).toContain("no adjustment");
  });

  it("null citationAuthorityScore: rationale does not mention OpenCitations", () => {
    const result = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
      citationAuthorityScore: null,
    });
    expect(result.rationale).not.toContain("OpenCitations");
  });

  it("isRetracted:false: no retraction mention in rationale", () => {
    const result = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: null,
      chainDistortionScore: null,
      isRetracted: false,
      citationAuthorityScore: null,
    });
    expect(result.rationale).not.toContain("retraction");
  });

  it("existing chain + provenance + OC all stack correctly", () => {
    const combined = computeCompositeTruth({
      upstreamVerdict: "Supported",
      provenanceScore: 0.85,
      chainDistortionScore: 0.1,
      chainHopCount: 5,
      citationAuthorityScore: 0.90,
    });
    // base 0.90 - chain(0.1*0.2=0.02) - prov(0) + provBonus(0.85-0.8)*0.1=0.005 + ocBonus(0.05)
    // = 0.90 - 0.02 + 0.005 + 0.05 = 0.935
    expect(combined.score).toBeCloseTo(0.935, 3);
  });
});
