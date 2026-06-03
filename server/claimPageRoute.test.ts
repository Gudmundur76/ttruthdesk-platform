/**
 * claimPageRoute.test.ts
 * Tests for the FAQPage JSON-LD builder and ClaimReview dateModified field.
 */

import { describe, it, expect } from "vitest";
import { buildClaimReviewJsonLd } from "./claimPageRoute";

const BASE_URL = "https://protein-desk-5r5rzpyg.manus.space";

const baseClaim = {
  id: 1,
  claimText: "Hemoglobin adopts a tetrameric structure at physiological pH",
  verdict: "Supported",
  verdictRationale: "PDB entry 1HHO confirms tetrameric assembly with 2.1 Å resolution.",
  pdbEvidenceUrl: "https://www.rcsb.org/structure/1HHO",
  pdbId: "1HHO",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-06-15T12:00:00Z"),
  confidenceScore: 0.92,
};

const baseDocument = {
  id: 10,
  title: "Structural Biology of Hemoglobin",
  createdAt: new Date("2024-01-01T00:00:00Z"),
};

describe("buildClaimReviewJsonLd — ClaimReview schema", () => {
  it("returns a ClaimReview object with correct type", () => {
    const { claimReview } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    expect(claimReview["@type"]).toBe("ClaimReview");
  });

  it("includes dateModified from claim.updatedAt", () => {
    const { claimReview } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    expect(claimReview.dateModified).toBe("2024-06-15T12:00:00.000Z");
  });

  it("falls back to createdAt when updatedAt is null", () => {
    const claim = { ...baseClaim, updatedAt: null };
    const { claimReview } = buildClaimReviewJsonLd(claim, baseDocument, BASE_URL);
    expect(claimReview.dateModified).toBe("2024-01-01T00:00:00.000Z");
  });

  it("falls back to current date when both updatedAt and createdAt are null", () => {
    const claim = { ...baseClaim, updatedAt: null, createdAt: null };
    const { claimReview } = buildClaimReviewJsonLd(claim, baseDocument, BASE_URL);
    // Just check it's a valid ISO string
    expect(() => new Date(claimReview.dateModified as string)).not.toThrow();
  });

  it("sets ratingValue to 1 for Supported verdict", () => {
    const { claimReview } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    expect((claimReview.reviewRating as Record<string, string>).ratingValue).toBe("1");
  });

  it("sets ratingValue to 0 for Contradicted verdict", () => {
    const claim = { ...baseClaim, verdict: "Contradicted" };
    const { claimReview } = buildClaimReviewJsonLd(claim, baseDocument, BASE_URL);
    expect((claimReview.reviewRating as Record<string, string>).ratingValue).toBe("0");
  });

  it("sets ratingValue to 0.75 for Partially Supported verdict", () => {
    const claim = { ...baseClaim, verdict: "Partially Supported" };
    const { claimReview } = buildClaimReviewJsonLd(claim, baseDocument, BASE_URL);
    expect((claimReview.reviewRating as Record<string, string>).ratingValue).toBe("0.75");
  });

  it("includes citation when pdbEvidenceUrl is present", () => {
    const { claimReview } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    expect(claimReview.citation).toBeDefined();
    expect((claimReview.citation as unknown[])[0]).toMatchObject({
      "@type": "ScholarlyArticle",
      url: "https://www.rcsb.org/structure/1HHO",
    });
  });

  it("omits citation when pdbEvidenceUrl is null", () => {
    const claim = { ...baseClaim, pdbEvidenceUrl: null };
    const { claimReview } = buildClaimReviewJsonLd(claim, baseDocument, BASE_URL);
    expect(claimReview.citation).toBeUndefined();
  });
});

describe("buildClaimReviewJsonLd — FAQPage schema", () => {
  it("returns a FAQPage object with correct type", () => {
    const { faqPage } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    expect(faqPage["@type"]).toBe("FAQPage");
  });

  it("includes dateModified in FAQPage", () => {
    const { faqPage } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    expect(faqPage.dateModified).toBe("2024-06-15T12:00:00.000Z");
  });

  it("includes a Question about whether the claim is true", () => {
    const { faqPage } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    const questions = faqPage.mainEntity as Array<{ "@type": string; name: string }>;
    expect(questions[0]["@type"]).toBe("Question");
    expect(questions[0].name).toContain("Hemoglobin adopts a tetrameric structure");
  });

  it("answer starts with the verdict", () => {
    const { faqPage } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    const questions = faqPage.mainEntity as Array<{
      acceptedAnswer: { text: string };
    }>;
    expect(questions[0].acceptedAnswer.text).toMatch(/^Supported/);
  });

  it("includes confidence question when confidenceScore is present", () => {
    const { faqPage } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    const questions = faqPage.mainEntity as Array<{ "@type": string; name: string }>;
    expect(questions).toHaveLength(2);
    expect(questions[1].name).toContain("confident");
  });

  it("omits confidence question when confidenceScore is null", () => {
    const claim = { ...baseClaim, confidenceScore: null };
    const { faqPage } = buildClaimReviewJsonLd(claim, baseDocument, BASE_URL);
    const questions = faqPage.mainEntity as Array<{ "@type": string }>;
    expect(questions).toHaveLength(1);
  });

  it("confidence answer includes percentage", () => {
    const { faqPage } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    const questions = faqPage.mainEntity as Array<{
      acceptedAnswer: { text: string };
    }>;
    expect(questions[1].acceptedAnswer.text).toContain("92%");
  });

  it("includes evidence URL in answer when pdbEvidenceUrl is present", () => {
    const { faqPage } = buildClaimReviewJsonLd(baseClaim, baseDocument, BASE_URL);
    const questions = faqPage.mainEntity as Array<{
      acceptedAnswer: { text: string };
    }>;
    expect(questions[0].acceptedAnswer.text).toContain("https://www.rcsb.org/structure/1HHO");
  });

  it("includes PDB ID in answer when pdbEvidenceUrl is null but pdbId is set", () => {
    const claim = { ...baseClaim, pdbEvidenceUrl: null, pdbId: "2HHB" };
    const { faqPage } = buildClaimReviewJsonLd(claim, baseDocument, BASE_URL);
    const questions = faqPage.mainEntity as Array<{
      acceptedAnswer: { text: string };
    }>;
    expect(questions[0].acceptedAnswer.text).toContain("2HHB");
  });
});
