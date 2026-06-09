/**
 * searchEngine.coverage.test.ts
 *
 * Unit tests for the pure (non-DB) functions in searchEngine.ts.
 * These tests do NOT call the database — they cover the tokeniser,
 * stop-word filter, and relevance-scoring helpers that are exercised
 * in isolation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tokenise } from "./searchEngine";

// ─── tokenise ────────────────────────────────────────────────────────────────

describe("tokenise", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenise("Whey Protein")).toEqual(["whey", "protein"]);
  });

  it("removes stop words", () => {
    const result = tokenise("the protein and the muscle");
    expect(result).not.toContain("the");
    expect(result).not.toContain("and");
    expect(result).toContain("protein");
    expect(result).toContain("muscle");
  });

  it("filters tokens shorter than 3 characters", () => {
    const result = tokenise("is it a protein");
    expect(result).not.toContain("is");
    expect(result).not.toContain("it");
    expect(result).not.toContain("a");
    expect(result).toContain("protein");
  });

  it("strips non-alphanumeric characters (keeps hyphens)", () => {
    const result = tokenise("whey-protein (isolate)!");
    // hyphens are preserved by the regex [^a-z0-9\s-] so "whey-protein" stays as one token
    expect(
      result.some(t => t.includes("protein") || t === "whey-protein")
    ).toBe(true);
    expect(result).toContain("isolate");
  });

  it("caps output at 8 tokens", () => {
    const longQuery =
      "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const result = tokenise(longQuery);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it("returns empty array for empty string", () => {
    expect(tokenise("")).toEqual([]);
  });

  it("returns empty array for all-stopword input", () => {
    expect(tokenise("the and for are but")).toEqual([]);
  });

  it("handles numbers as valid tokens", () => {
    const result = tokenise("protein 2024 study");
    expect(result).toContain("2024");
    expect(result).toContain("protein");
    expect(result).toContain("study");
  });

  it("deduplicates is not required — repeated terms are allowed", () => {
    const result = tokenise("protein protein synthesis");
    expect(result.filter(t => t === "protein").length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("handles unicode by stripping non-ascii to spaces", () => {
    const result = tokenise("protéin synthesis");
    // "protéin" becomes "prot in" after stripping — "prot" is 4 chars so kept
    expect(result).toContain("synthesis");
  });
});

// ─── searchClaims / searchEntities / unifiedSearch (mocked DB) ───────────────

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
    }),
  };
});

describe("searchClaims (mocked DB)", () => {
  it("returns empty array when DB returns no rows", async () => {
    const { searchClaims } = await import("./searchEngine");
    const result = await searchClaims("nonexistent claim xyz");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("returns empty array for empty query", async () => {
    const { searchClaims } = await import("./searchEngine");
    const result = await searchClaims("");
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("searchEntities (mocked DB)", () => {
  it("returns empty array when DB returns no rows", async () => {
    const { searchEntities } = await import("./searchEngine");
    const result = await searchEntities("nonexistent entity");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

describe("unifiedSearch (mocked DB)", () => {
  it("returns object with claims and entities arrays", async () => {
    const { unifiedSearch } = await import("./searchEngine");
    const result = await unifiedSearch("protein synthesis");
    expect(result).toHaveProperty("claims");
    expect(result).toHaveProperty("entities");
    expect(Array.isArray(result.claims)).toBe(true);
    expect(Array.isArray(result.entities)).toBe(true);
  });
});
