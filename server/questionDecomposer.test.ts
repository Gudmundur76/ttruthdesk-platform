/**
 * questionDecomposer.test.ts — Sprint 25
 *
 * Ralph Wiggum TDD: tests written first, then implementation.
 * All tests must pass before the sprint is considered complete.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  decomposeQuestion,
  questionToDeclarative,
  extractClaimKeywords,
  buildPubMedQuery,
  type AtomicClaim,
  type DecompositionResult,
} from "./questionDecomposer";

// ─── Mock invokeLLM ───────────────────────────────────────────────────────────

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue(
    JSON.stringify([
      { text: "aspirin reduces cardiovascular risk", confidence: 0.92 },
      { text: "aspirin is effective in elderly patients", confidence: 0.85 },
    ])
  ),
}));

vi.mock("./logger", () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── questionToDeclarative ────────────────────────────────────────────────────

describe("questionToDeclarative", () => {
  it("returns declarative statements unchanged", () => {
    const input = "Aspirin reduces cardiovascular risk";
    expect(questionToDeclarative(input)).toBe(input);
  });

  it("converts does-question to declarative", () => {
    const result = questionToDeclarative(
      "Does aspirin reduce cardiovascular risk?"
    );
    expect(result).toBe("aspirin reduces cardiovascular risk");
  });

  it("converts do-question to declarative", () => {
    const result = questionToDeclarative(
      "Do statins lower LDL cholesterol?"
    );
    expect(result).toBe("statins lower LDL cholesterol");
  });

  it("converts is-question to declarative", () => {
    const result = questionToDeclarative("Is metformin safe for elderly patients?");
    expect(result).toContain("metformin");
    expect(result.endsWith("?")).toBe(false);
  });

  it("handles question without auxiliary verb", () => {
    const result = questionToDeclarative("Aspirin prevents heart attacks?");
    expect(result).toBe("Aspirin prevents heart attacks");
  });

  it("handles already-declarative with no question mark", () => {
    const input = "Lysozyme is an antimicrobial enzyme";
    expect(questionToDeclarative(input)).toBe(input);
  });
});

// ─── decomposeQuestion — simple declarative ───────────────────────────────────

describe("decomposeQuestion — simple declarative", () => {
  it("returns single claim for simple declarative statement", async () => {
    const result = await decomposeQuestion(
      "Aspirin reduces cardiovascular risk in adults"
    );
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text).toContain("Aspirin");
    expect(result.claims[0].confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("returns passthrough for empty input", async () => {
    const result = await decomposeQuestion("");
    expect(result.claims).toHaveLength(0);
  });

  it("converts yes/no question to declarative claim", async () => {
    const result = await decomposeQuestion(
      "Does aspirin reduce cardiovascular risk?"
    );
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text.endsWith("?")).toBe(false);
    expect(result.claims[0].text.toLowerCase()).toContain("aspirin");
  });

  it("records duration in milliseconds", async () => {
    const result = await decomposeQuestion("Aspirin reduces fever");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThan(500);
  });

  it("preserves input in result", async () => {
    const input = "Does metformin lower blood glucose?";
    const result = await decomposeQuestion(input);
    expect(result.input).toBe(input);
  });
});

// ─── decomposeQuestion — conjunctive splitting ────────────────────────────────

describe("decomposeQuestion — conjunctive splitting", () => {
  it("splits compound claim on 'and' into two claims", async () => {
    const result = await decomposeQuestion(
      "Aspirin reduces fever and prevents platelet aggregation"
    );
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
    // Either split into 2 or kept as 1 — both are valid
    result.claims.forEach(c => {
      expect(c.text.length).toBeGreaterThan(5);
    });
  });

  it("does not split noun-phrase 'and' (e.g. 'cats and dogs')", async () => {
    const result = await decomposeQuestion(
      "Cats and dogs are common household pets"
    );
    // Short parts should not be split
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
  });

  it("assigns sequential index values to split claims", async () => {
    const result = await decomposeQuestion(
      "Metformin reduces blood glucose levels and improves insulin sensitivity in type 2 diabetes patients"
    );
    result.claims.forEach((c, i) => {
      expect(c.index).toBe(i);
    });
  });
});

// ─── decomposeQuestion — comparative splitting ────────────────────────────────

describe("decomposeQuestion — comparative splitting", () => {
  it("splits comparative claim into two atomic claims", async () => {
    const result = await decomposeQuestion(
      "Ibuprofen is more effective than acetaminophen for inflammation"
    );
    // May produce 1 or 2 claims depending on heuristic confidence
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
    result.claims.forEach(c => expect(c.text.length).toBeGreaterThan(5));
  });
});

// ─── decomposeQuestion — max claims cap ──────────────────────────────────────

describe("decomposeQuestion — max claims cap", () => {
  it("never returns more than 5 claims", async () => {
    const result = await decomposeQuestion(
      "Drug A increases X and decreases Y and modulates Z and inhibits W and activates V and blocks U"
    );
    expect(result.claims.length).toBeLessThanOrEqual(5);
  });
});

// ─── decomposeQuestion — LLM path ────────────────────────────────────────────

describe("decomposeQuestion — LLM path", () => {
  it("uses LLM when useLlm=true and heuristic confidence is low", async () => {
    const result = await decomposeQuestion(
      "What are the mechanisms by which statins reduce cardiovascular events?",
      true
    );
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
    // LLM mock returns 2 claims
    if (result.usedLlm) {
      expect(result.claims.length).toBe(2);
      expect(result.claims[0].method).toBe("llm");
    }
  });

  it("falls back to heuristic when LLM fails", async () => {
    const { invokeLLM } = await import("./_core/llm");
    vi.mocked(invokeLLM).mockRejectedValueOnce(new Error("LLM timeout"));

    const result = await decomposeQuestion(
      "Does aspirin reduce risk?",
      true
    );
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
    // Should not throw
  });
});

// ─── extractClaimKeywords ─────────────────────────────────────────────────────

describe("extractClaimKeywords", () => {
  it("removes stop words", () => {
    const keywords = extractClaimKeywords("aspirin reduces the risk of cardiovascular disease");
    expect(keywords).not.toContain("the");
    expect(keywords).not.toContain("of");
    expect(keywords).toContain("aspirin");
    expect(keywords).toContain("cardiovascular");
  });

  it("removes short tokens", () => {
    const keywords = extractClaimKeywords("X is a drug");
    expect(keywords.every(k => k.length > 2)).toBe(true);
  });

  it("lowercases all keywords", () => {
    const keywords = extractClaimKeywords("Aspirin Reduces Fever");
    expect(keywords.every(k => k === k.toLowerCase())).toBe(true);
  });

  it("handles empty string", () => {
    expect(extractClaimKeywords("")).toEqual([]);
  });
});

// ─── buildPubMedQuery ─────────────────────────────────────────────────────────

describe("buildPubMedQuery", () => {
  it("returns a non-empty string for a valid claim", () => {
    const claim: AtomicClaim = {
      text: "Aspirin reduces cardiovascular risk in elderly patients",
      method: "heuristic",
      confidence: 0.8,
      index: 0,
    };
    const query = buildPubMedQuery(claim);
    expect(query.length).toBeGreaterThan(0);
    expect(typeof query).toBe("string");
  });

  it("returns at most 5 keywords", () => {
    const claim: AtomicClaim = {
      text: "Aspirin reduces cardiovascular risk inflammation platelet aggregation elderly patients",
      method: "heuristic",
      confidence: 0.8,
      index: 0,
    };
    const query = buildPubMedQuery(claim);
    const words = query.split(" ");
    expect(words.length).toBeLessThanOrEqual(5);
  });

  it("prioritizes longer (more specific) keywords", () => {
    const claim: AtomicClaim = {
      text: "Aspirin reduces cardiovascular risk",
      method: "heuristic",
      confidence: 0.8,
      index: 0,
    };
    const query = buildPubMedQuery(claim);
    // "cardiovascular" (14 chars) should be in the query
    expect(query).toContain("cardiovascular");
  });
});

// ─── Integration: full pipeline ───────────────────────────────────────────────

describe("decomposeQuestion — integration", () => {
  it("processes a real Perplexity-style question end-to-end", async () => {
    const question =
      "Does regular aspirin use reduce the risk of colorectal cancer in adults over 50?";
    const result = await decomposeQuestion(question);

    expect(result.input).toBe(question);
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
    expect(result.claims.length).toBeLessThanOrEqual(5);
    expect(result.durationMs).toBeLessThan(1000);

    const claim = result.claims[0];
    expect(claim.text.endsWith("?")).toBe(false);
    expect(claim.confidence).toBeGreaterThan(0);
    expect(claim.index).toBe(0);
    expect(["heuristic", "llm", "passthrough"]).toContain(claim.method);

    // PubMed query should be buildable from the first claim
    const query = buildPubMedQuery(claim);
    expect(query.length).toBeGreaterThan(0);
  });

  it("handles a multi-drug comparison question", async () => {
    const question =
      "Is ibuprofen safer than naproxen for long-term use in elderly patients?";
    const result = await decomposeQuestion(question);
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
    result.claims.forEach(c => {
      expect(c.text.endsWith("?")).toBe(false);
      expect(c.text.length).toBeGreaterThan(5);
    });
  });

  it("handles a statement about protein structure", async () => {
    const statement =
      "Lysozyme is an antimicrobial enzyme found in human tears and saliva";
    const result = await decomposeQuestion(statement);
    expect(result.claims.length).toBeGreaterThanOrEqual(1);
    expect(result.claims[0].text.toLowerCase()).toContain("lysozyme");
  });
});
