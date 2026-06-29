/**
 * relevanceUtils.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  extractRelevanceKeywords,
  computeRelevanceScore,
  isRelevant,
  relevanceAdjustedConfidence,
  MIN_RELEVANCE_THRESHOLD,
  SEMANTIC_RELEVANCE_THRESHOLD,
} from "./relevanceUtils";

describe("extractRelevanceKeywords", () => {
  it("extracts meaningful keywords from text", () => {
    const kw = extractRelevanceKeywords(
      "The quick brown fox jumps over the lazy dog"
    );
    expect(kw.has("quick")).toBe(true);
    expect(kw.has("brown")).toBe(true);
    expect(kw.has("fox")).toBe(true);
    expect(kw.has("the")).toBe(false);
    expect(kw.has("over")).toBe(false);
  });

  it("removes tokens shorter than 3 characters", () => {
    const kw = extractRelevanceKeywords("gas is a substance");
    expect(kw.has("gas")).toBe(true);
    expect(kw.has("is")).toBe(false);
  });

  it("lowercases all tokens", () => {
    const kw = extractRelevanceKeywords("BRCA1 Gene Expression");
    expect(kw.has("brca1")).toBe(true);
    expect(kw.has("gene")).toBe(true);
    expect(kw.has("expression")).toBe(true);
  });

  it("returns empty set for empty string", () => {
    expect(extractRelevanceKeywords("").size).toBe(0);
  });

  it("strips punctuation (commas, exclamation marks become spaces)", () => {
    // punctuation regex: /[^a-z0-9\s\-]/g → hyphens kept, commas/! become spaces
    const kw = extractRelevanceKeywords("cancer, treatment!");
    expect(kw.has("cancer")).toBe(true);
    expect(kw.has("treatment")).toBe(true);
  });

  it("preserves hyphenated tokens as single tokens", () => {
    const kw = extractRelevanceKeywords("protein-folding structure");
    // "protein-folding" is one token (hyphen kept), "structure" is another
    expect(kw.has("protein-folding")).toBe(true);
    expect(kw.has("structure")).toBe(true);
  });
});

describe("computeRelevanceScore", () => {
  it("returns 0.5 when claim has no keywords", () => {
    expect(computeRelevanceScore("the a an", "title", "abstract")).toBe(0.5);
  });

  it("returns 0 when document is empty", () => {
    expect(computeRelevanceScore("cancer treatment", null, null)).toBe(0);
  });

  it("returns 1.0 for identical claim and document", () => {
    const score = computeRelevanceScore(
      "cancer treatment therapy",
      "cancer treatment therapy",
      null
    );
    expect(score).toBe(1.0);
  });

  it("returns value between 0 and 1 for partial overlap", () => {
    const score = computeRelevanceScore(
      "diabetes insulin treatment",
      "insulin resistance",
      "treatment of type 2 diabetes"
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns 0 for completely unrelated claim and document", () => {
    const score = computeRelevanceScore(
      "quantum computing algorithms",
      "football soccer sports",
      null
    );
    expect(score).toBe(0);
  });
});

describe("isRelevant", () => {
  it("returns true when score meets default threshold", () => {
    expect(
      isRelevant(
        "diabetes insulin treatment",
        "insulin treatment diabetes",
        "type 2 diabetes insulin therapy"
      )
    ).toBe(true);
  });

  it("returns false when score is below default threshold", () => {
    expect(isRelevant("quantum computing", "football sports", null)).toBe(
      false
    );
  });

  it("respects custom threshold", () => {
    const score = computeRelevanceScore(
      "cancer treatment",
      "cancer therapy",
      null
    );
    expect(
      isRelevant("cancer treatment", "cancer therapy", null, score - 0.01)
    ).toBe(true);
    expect(
      isRelevant("cancer treatment", "cancer therapy", null, score + 0.5)
    ).toBe(false);
  });
});

describe("relevanceAdjustedConfidence", () => {
  it("returns value between 0.1 and 0.99", () => {
    const conf = relevanceAdjustedConfidence(
      0.8,
      "cancer treatment",
      "cancer therapy",
      "treatment of cancer"
    );
    expect(conf).toBeGreaterThanOrEqual(0.1);
    expect(conf).toBeLessThanOrEqual(0.99);
  });

  it("returns minimum 0.1 even for low base confidence and irrelevant document", () => {
    const conf = relevanceAdjustedConfidence(
      0.0,
      "quantum computing",
      "football sports",
      null
    );
    expect(conf).toBeGreaterThanOrEqual(0.1);
  });

  it("blends base confidence and relevance score", () => {
    const highConf = relevanceAdjustedConfidence(
      0.9,
      "cancer treatment",
      "cancer therapy",
      "treatment of cancer"
    );
    const lowConf = relevanceAdjustedConfidence(
      0.1,
      "cancer treatment",
      "cancer therapy",
      "treatment of cancer"
    );
    expect(highConf).toBeGreaterThan(lowConf);
  });
});

describe("constants", () => {
  it("MIN_RELEVANCE_THRESHOLD is 0.12", () => {
    expect(MIN_RELEVANCE_THRESHOLD).toBe(0.12);
  });

  it("SEMANTIC_RELEVANCE_THRESHOLD is 0.1", () => {
    expect(SEMANTIC_RELEVANCE_THRESHOLD).toBe(0.1);
  });
});
