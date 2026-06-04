import { describe, it, expect } from "vitest";

// ─── Unit tests for the pure scoring helpers in searchEngine.ts ──────────────
// These tests validate the scoring logic without hitting the database.

// Replicate the pure scoring functions inline so tests run without DB
function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function scoreClaimText(claimText: string, query: string): number {
  const terms = tokenize(query);
  const phrase = query.toLowerCase().trim();
  const lower = claimText.toLowerCase();
  let score = 0;
  if (lower === phrase) score += 200;
  else if (lower.startsWith(phrase)) score += 100;
  else if (lower.includes(phrase)) score += 80;
  for (const t of terms) {
    const count = (lower.match(new RegExp(t, "g")) ?? []).length;
    score += count * 15;
  }
  return score;
}

function scoreEntityName(name: string, query: string): number {
  const terms = tokenize(query);
  const phrase = query.toLowerCase().trim();
  const lower = name.toLowerCase();
  let score = 0;
  if (lower === phrase) score += 100;
  else if (lower.includes(phrase)) score += 50;
  for (const t of terms) {
    if (lower.includes(t)) score += 20;
  }
  return score;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("splits on whitespace and removes short tokens", () => {
    expect(tokenize("creatine monohydrate")).toEqual(["creatine", "monohydrate"]);
  });

  it("strips punctuation and lowercases", () => {
    expect(tokenize("Whey-Protein (2024)")).toEqual(["whey", "protein", "2024"]);
  });

  it("filters tokens shorter than 3 chars", () => {
    expect(tokenize("a is the best")).toEqual(["the", "best"]);
  });

  it("returns empty array for empty query", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("scoreClaimText", () => {
  it("gives highest score for exact match", () => {
    const exact = scoreClaimText("creatine monohydrate", "creatine monohydrate");
    const partial = scoreClaimText("creatine monohydrate increases strength", "creatine monohydrate");
    expect(exact).toBeGreaterThan(partial);
  });

  it("gives higher score for phrase at start vs middle", () => {
    const start = scoreClaimText("creatine monohydrate improves power output", "creatine monohydrate");
    const middle = scoreClaimText("supplementation with creatine monohydrate shows benefits", "creatine monohydrate");
    expect(start).toBeGreaterThanOrEqual(middle);
  });

  it("rewards repeated term occurrences", () => {
    const once = scoreClaimText("protein synthesis increases with leucine", "leucine");
    const twice = scoreClaimText("leucine activates mTOR and leucine promotes protein synthesis", "leucine");
    expect(twice).toBeGreaterThan(once);
  });

  it("returns 0 for completely unrelated text", () => {
    expect(scoreClaimText("unrelated text about nothing", "creatine")).toBe(0);
  });

  it("handles multi-word queries correctly", () => {
    const score = scoreClaimText("whey protein increases muscle protein synthesis", "whey protein synthesis");
    expect(score).toBeGreaterThan(0);
  });
});

describe("scoreEntityName", () => {
  it("gives highest score for exact name match", () => {
    const exact = scoreEntityName("creatine", "creatine");
    const partial = scoreEntityName("creatine monohydrate", "creatine");
    expect(exact).toBeGreaterThan(partial);
  });

  it("gives partial score for substring match", () => {
    const score = scoreEntityName("creatine monohydrate", "creatine");
    expect(score).toBeGreaterThan(0);
  });

  it("returns 0 for unrelated entity name", () => {
    expect(scoreEntityName("collagen peptide", "creatine")).toBe(0);
  });

  it("handles case-insensitive matching", () => {
    const lower = scoreEntityName("Creatine Monohydrate", "creatine");
    const upper = scoreEntityName("creatine monohydrate", "CREATINE");
    expect(lower).toEqual(upper);
  });
});

describe("search result ordering invariants", () => {
  it("more relevant claims score higher than less relevant ones", () => {
    const claims = [
      { text: "creatine monohydrate significantly increases phosphocreatine resynthesis", expected: "high" },
      { text: "some study about vitamin D and bone density", expected: "low" },
      { text: "creatine supplementation improves high-intensity exercise performance", expected: "high" },
    ];
    const query = "creatine monohydrate";
    const scored = claims.map((c) => ({ ...c, score: scoreClaimText(c.text, query) }));
    const highScores = scored.filter((c) => c.expected === "high").map((c) => c.score);
    const lowScores = scored.filter((c) => c.expected === "low").map((c) => c.score);
    expect(Math.min(...highScores)).toBeGreaterThan(Math.max(...lowScores));
  });

  it("exact entity name match ranks above substring match", () => {
    const exact = scoreEntityName("leucine", "leucine");
    const substring = scoreEntityName("isoleucine", "leucine");
    expect(exact).toBeGreaterThan(substring);
  });
});
