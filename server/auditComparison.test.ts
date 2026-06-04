import { describe, it, expect } from "vitest";

// ─── Pure algorithm tests (no DB) ────────────────────────────────────────────

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const normA = normalise(a);
  const normB = normalise(b);
  const wordsA = new Set(normA.split(" "));
  const wordsB = new Set(normB.split(" "));
  const intersection = Array.from(wordsA).filter((w) => wordsB.has(w)).length;
  const union = new Set([...Array.from(wordsA), ...Array.from(wordsB)]).size;
  return union > 0 ? intersection / union : 0;
}

describe("Jaccard similarity", () => {
  it("returns 1.0 for identical strings", () => {
    const score = jaccardSimilarity(
      "Whey protein supplementation increases muscle mass",
      "Whey protein supplementation increases muscle mass"
    );
    expect(score).toBe(1.0);
  });

  it("returns 0 for completely different strings", () => {
    const score = jaccardSimilarity("apple orange banana", "car truck bus");
    expect(score).toBe(0);
  });

  it("returns a partial score for overlapping strings", () => {
    const score = jaccardSimilarity(
      "Creatine improves strength and power output",
      "Creatine supplementation improves power output in athletes"
    );
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(1.0);
  });

  it("is symmetric", () => {
    const a = "Protein intake affects muscle protein synthesis";
    const b = "Muscle protein synthesis is affected by dietary protein";
    expect(jaccardSimilarity(a, b)).toBeCloseTo(jaccardSimilarity(b, a), 10);
  });

  it("handles empty strings gracefully", () => {
    // Two empty strings share the empty-string token so score is 1; the
    // important invariant is that a non-empty vs empty string scores 0.
    expect(jaccardSimilarity("hello", "")).toBe(0);
    expect(jaccardSimilarity("", "world")).toBe(0);
  });

  it("normalises punctuation and case", () => {
    const score = jaccardSimilarity(
      "Whey Protein (20g) increases MPS!",
      "whey protein 20g increases mps"
    );
    expect(score).toBe(1.0);
  });
});

// ─── Pair matching algorithm ──────────────────────────────────────────────────

type ClaimLike = { id: number; claimText: string; verdict: string | null; confidenceScore: number | null };

function matchClaims(claimsA: ClaimLike[], claimsB: ClaimLike[]) {
  const pairs: Array<{
    claimA: ClaimLike | null;
    claimB: ClaimLike | null;
    similarity: "exact" | "similar" | "unique";
    verdictChanged: boolean;
    confidenceChanged: boolean;
  }> = [];
  const usedB = new Set<number>();

  for (const cA of claimsA) {
    let bestMatch: ClaimLike | null = null;
    let bestScore = 0;
    for (const cB of claimsB) {
      if (usedB.has(cB.id)) continue;
      const score = jaccardSimilarity(cA.claimText, cB.claimText);
      if (score > bestScore) { bestScore = score; bestMatch = cB; }
    }
    if (bestMatch && bestScore >= 0.5) {
      usedB.add(bestMatch.id);
      pairs.push({
        claimA: cA,
        claimB: bestMatch,
        similarity: bestScore >= 0.9 ? "exact" : "similar",
        verdictChanged: cA.verdict !== bestMatch.verdict,
        confidenceChanged: Math.abs((cA.confidenceScore ?? 0) - (bestMatch.confidenceScore ?? 0)) > 0.05,
      });
    } else {
      pairs.push({ claimA: cA, claimB: null, similarity: "unique", verdictChanged: false, confidenceChanged: false });
    }
  }
  for (const cB of claimsB) {
    if (!usedB.has(cB.id)) {
      pairs.push({ claimA: null, claimB: cB, similarity: "unique", verdictChanged: false, confidenceChanged: false });
    }
  }
  return pairs;
}

describe("matchClaims", () => {
  const claimA1: ClaimLike = { id: 1, claimText: "Whey protein increases muscle mass", verdict: "Supported", confidenceScore: 0.85 };
  const claimA2: ClaimLike = { id: 2, claimText: "Creatine improves strength output", verdict: "Supported", confidenceScore: 0.75 };
  const claimB1: ClaimLike = { id: 10, claimText: "Whey protein increases muscle mass", verdict: "Supported", confidenceScore: 0.85 };
  const claimB2: ClaimLike = { id: 11, claimText: "Creatine improves strength output", verdict: "Contradicted", confidenceScore: 0.40 };
  const claimB3: ClaimLike = { id: 12, claimText: "Collagen peptides improve joint health", verdict: "Partially Supported", confidenceScore: 0.60 };

  it("matches identical claims as exact", () => {
    const pairs = matchClaims([claimA1], [claimB1]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].similarity).toBe("exact");
    expect(pairs[0].verdictChanged).toBe(false);
  });

  it("detects verdict changes", () => {
    const pairs = matchClaims([claimA2], [claimB2]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].verdictChanged).toBe(true);
  });

  it("detects confidence changes", () => {
    const pairs = matchClaims([claimA2], [claimB2]);
    expect(pairs[0].confidenceChanged).toBe(true);
  });

  it("marks unmatched claims as unique", () => {
    const pairs = matchClaims([claimA1], [claimB3]);
    expect(pairs).toHaveLength(2);
    const uniqueA = pairs.find((p) => p.claimA?.id === 1 && !p.claimB);
    const uniqueB = pairs.find((p) => p.claimB?.id === 12 && !p.claimA);
    expect(uniqueA).toBeDefined();
    expect(uniqueB).toBeDefined();
  });

  it("does not reuse a B claim for multiple A claims", () => {
    const dupA: ClaimLike = { id: 3, claimText: "Whey protein increases muscle mass", verdict: "Supported", confidenceScore: 0.80 };
    const pairs = matchClaims([claimA1, dupA], [claimB1]);
    const matched = pairs.filter((p) => p.claimB?.id === 10);
    expect(matched).toHaveLength(1);
  });

  it("computes correct summary stats", () => {
    const pairs = matchClaims([claimA1, claimA2], [claimB1, claimB2, claimB3]);
    const verdictChanges = pairs.filter((p) => p.verdictChanged).length;
    const onlyInA = pairs.filter((p) => p.claimA && !p.claimB).length;
    const onlyInB = pairs.filter((p) => !p.claimA && p.claimB).length;
    expect(verdictChanges).toBe(1);
    expect(onlyInA).toBe(0);
    expect(onlyInB).toBe(1);
  });
});

// ─── Summary calculation ──────────────────────────────────────────────────────

describe("confidence delta calculation", () => {
  it("is positive when B has higher average confidence", () => {
    const claimsA = [{ confidenceScore: 0.5 }, { confidenceScore: 0.6 }];
    const claimsB = [{ confidenceScore: 0.8 }, { confidenceScore: 0.9 }];
    const avgA = claimsA.reduce((s, c) => s + (c.confidenceScore ?? 0), 0) / claimsA.length;
    const avgB = claimsB.reduce((s, c) => s + (c.confidenceScore ?? 0), 0) / claimsB.length;
    expect(avgB - avgA).toBeGreaterThan(0);
  });

  it("is negative when B has lower average confidence", () => {
    const claimsA = [{ confidenceScore: 0.9 }];
    const claimsB = [{ confidenceScore: 0.3 }];
    const avgA = claimsA[0].confidenceScore!;
    const avgB = claimsB[0].confidenceScore!;
    expect(avgB - avgA).toBeLessThan(0);
  });

  it("rounds to 3 decimal places", () => {
    const delta = 0.123456789;
    const rounded = Math.round(delta * 1000) / 1000;
    expect(rounded).toBe(0.123);
  });
});
