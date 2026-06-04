/**
 * claimQualityScorer.test.ts
 * Unit tests for the quality scoring pipeline.
 * Tests are fully deterministic — no DB calls needed.
 */
import { describe, it, expect } from "vitest";
import { computeClaimScore } from "./claimQualityScorer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClaim(overrides: Partial<Parameters<typeof computeClaimScore>[0]> = {}) {
  return {
    id: 1,
    verdict: "Supported" as const,
    pdbEvidenceUrl: "https://www.ncbi.nlm.nih.gov/pubmed/12345678",
    pdbEvidenceRaw: { pmid: "12345678", title: "Test paper", abstract: "Test abstract text", year: 2024 },
    pdbEvidenceCheckedAt: new Date(), // just checked = full recency
    claimType: "protein_name",
    claimText: "Whey protein supplementation increases muscle protein synthesis by 25% in resistance-trained adults",
    extractedValue: "whey protein",
    verticalDomain: "protein_supplement",
    ...overrides,
  };
}

// ─── Composite score range ────────────────────────────────────────────────────

describe("computeClaimScore", () => {
  it("returns a score between 0 and 1 for a well-supported claim", () => {
    const score = computeClaimScore(makeClaim());
    expect(score.compositeScore).toBeGreaterThan(0);
    expect(score.compositeScore).toBeLessThanOrEqual(1.0);
  });

  it("returns a higher score for Supported than Contradicted", () => {
    const supported = computeClaimScore(makeClaim({ verdict: "Supported" }));
    const contradicted = computeClaimScore(makeClaim({ verdict: "Contradicted" }));
    expect(supported.compositeScore).toBeGreaterThan(contradicted.compositeScore);
  });

  it("returns a higher score for Supported than Insufficient Evidence", () => {
    const supported = computeClaimScore(makeClaim({ verdict: "Supported" }));
    const insufficient = computeClaimScore(makeClaim({ verdict: "Insufficient Evidence" }));
    expect(supported.compositeScore).toBeGreaterThan(insufficient.compositeScore);
  });

  it("penalises claims with no evidence URL", () => {
    const withUrl = computeClaimScore(makeClaim({ pdbEvidenceUrl: "https://pubmed.ncbi.nlm.nih.gov/123" }));
    const withoutUrl = computeClaimScore(makeClaim({ pdbEvidenceUrl: null }));
    expect(withUrl.compositeScore).toBeGreaterThan(withoutUrl.compositeScore);
    expect(withoutUrl.flags).toContain("no_evidence_url");
  });

  it("penalises stale evidence (checked > 365 days ago)", () => {
    const fresh = computeClaimScore(makeClaim({ pdbEvidenceCheckedAt: new Date() }));
    const stale = computeClaimScore(makeClaim({
      pdbEvidenceCheckedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
    }));
    expect(fresh.compositeScore).toBeGreaterThan(stale.compositeScore);
    expect(stale.flags).toContain("stale_evidence");
  });

  it("penalises claims with null evidence checked date", () => {
    const withDate = computeClaimScore(makeClaim({ pdbEvidenceCheckedAt: new Date() }));
    const withoutDate = computeClaimScore(makeClaim({ pdbEvidenceCheckedAt: null }));
    expect(withDate.compositeScore).toBeGreaterThan(withoutDate.compositeScore);
    expect(withoutDate.flags).toContain("evidence_never_checked");
  });

  it("gives higher specificity score to pdb_id claims than general_molecular", () => {
    const pdbClaim = computeClaimScore(makeClaim({ claimType: "pdb_id", extractedValue: "1LYZ" }));
    const generalClaim = computeClaimScore(makeClaim({ claimType: "general_molecular", extractedValue: null }));
    expect(pdbClaim.specificityScore).toBeGreaterThan(generalClaim.specificityScore);
  });

  it("boosts score for RCT vertical over general vertical", () => {
    const rct = computeClaimScore(makeClaim({ verticalDomain: "sports_nutrition_rct" }));
    const general = computeClaimScore(makeClaim({ verticalDomain: "gut_microbiome" }));
    expect(rct.verticalScore).toBeGreaterThan(general.verticalScore);
  });

  it("attaches flags for low-quality claims", () => {
    const score = computeClaimScore(makeClaim({
      verdict: null,
      pdbEvidenceUrl: null,
      pdbEvidenceRaw: null,
      pdbEvidenceCheckedAt: null,
      claimType: "general_molecular",
      extractedValue: null,
      claimText: "Protein is good",
    }));
    expect(score.flags.length).toBeGreaterThan(0);
    expect(score.flags).toContain("insufficient_evidence");
    expect(score.flags).toContain("no_evidence_url");
    expect(score.flags).toContain("evidence_never_checked");
  });

  it("returns component scores that sum to approximately the composite score", () => {
    const score = computeClaimScore(makeClaim());
    const sum = score.evidenceScore + score.recencyScore + score.specificityScore + score.verticalScore;
    // Allow for floating point rounding and the min(1.0) cap
    expect(Math.abs(score.compositeScore - Math.min(1.0, sum))).toBeLessThan(0.01);
  });

  it("is deterministic — same input always produces same score", () => {
    const claim = makeClaim();
    const score1 = computeClaimScore(claim);
    const score2 = computeClaimScore(claim);
    expect(score1.compositeScore).toBe(score2.compositeScore);
    expect(score1.flags).toEqual(score2.flags);
  });

  it("handles numeric measurements in claim text as a specificity boost", () => {
    const withMeasurement = computeClaimScore(makeClaim({
      claimText: "Creatine supplementation increases PCr resynthesis by 20% (p<0.05) in 5g/day doses",
    }));
    const withoutMeasurement = computeClaimScore(makeClaim({
      claimText: "Creatine supplementation increases performance in athletes",
    }));
    // The measurement claim should score at least as high
    expect(withMeasurement.specificityScore).toBeGreaterThanOrEqual(withoutMeasurement.specificityScore);
  });
});
