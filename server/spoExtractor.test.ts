/**
 * spoExtractor.test.ts
 * Ralph Wiggum TDD loop — tests written before integration.
 * These tests cover the heuristic path (no LLM needed) so they run in CI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractSpoTriple } from "./spoExtractor";

// Mock fetch so LLM calls fail → heuristic path is tested
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("no network in test"))
  );
});

describe("extractSpoTriple — heuristic fallback", () => {
  it("extracts SPO from 'X is an Y found in Z'", async () => {
    const result = await extractSpoTriple(
      "Lysozyme is an antimicrobial enzyme found in human tears"
    );
    expect(result.subject.toLowerCase()).toContain("lysozyme");
    expect(result.predicate.toLowerCase()).toMatch(/is|found/);
    expect(result.object.toLowerCase()).toMatch(/enzyme|tears|antimicrobial/);
    expect(result.method).toBe("heuristic");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("extracts SPO from 'X reduces Y'", async () => {
    const result = await extractSpoTriple(
      "salmon aquaculture reduces Neoparamoeba perurans parasite loads"
    );
    expect(result.subject.toLowerCase()).toContain("salmon");
    expect(result.predicate.toLowerCase()).toMatch(/reduc/);
    expect(result.object.toLowerCase()).toMatch(/parasite|neoparamoeba/);
    expect(result.method).toBe("heuristic");
  });

  it("extracts SPO from a question (normalizes to assertion)", async () => {
    const result = await extractSpoTriple(
      "Has salmon aquaculture reduced Neoparamoeba perurans parasite loads since 2018?"
    );
    expect(result.subject).toBeTruthy();
    expect(result.predicate).toBeTruthy();
    expect(result.object).toBeTruthy();
    expect(result.method).toBe("heuristic");
  });

  it("always returns a result — never throws", async () => {
    const result = await extractSpoTriple("x");
    expect(result).toBeDefined();
    expect(result.subject).toBeTruthy();
    expect(result.predicate).toBeTruthy();
    expect(result.object).toBeTruthy();
  });

  it("returns confidence in [0, 1]", async () => {
    const result = await extractSpoTriple("Protein p53 inhibits tumour growth");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("extracts SPO from 'X is associated with Y'", async () => {
    const result = await extractSpoTriple(
      "BRCA1 mutations are associated with increased breast cancer risk"
    );
    expect(result.subject.toLowerCase()).toContain("brca1");
    expect(result.predicate.toLowerCase()).toContain("associated");
    expect(result.object.toLowerCase()).toMatch(/breast|cancer|risk/);
  });

  it("extracts SPO from 'X binds to Y' — subject is always correct", async () => {
    // Compound sentence: heuristic picks first matching verb pattern.
    // The important invariant is subject=aspirin and method=heuristic.
    const result = await extractSpoTriple(
      "Aspirin binds to COX-2 and inhibits prostaglandin synthesis"
    );
    expect(result.subject.toLowerCase()).toContain("aspirin");
    // predicate is whichever verb the heuristic finds first (binds or inhibits)
    expect(result.predicate.toLowerCase()).toMatch(/bind|inhibit/);
    expect(result.method).toBe("heuristic");
  });
});

describe("extractSpoTriple — response shape", () => {
  it("returns all required fields", async () => {
    const result = await extractSpoTriple("CO2 causes global warming");
    expect(result).toHaveProperty("subject");
    expect(result).toHaveProperty("predicate");
    expect(result).toHaveProperty("object");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("method");
    expect(["llm", "heuristic"]).toContain(result.method);
  });

  it("all string fields are non-empty", async () => {
    const result = await extractSpoTriple(
      "Climate change increases extreme weather events"
    );
    expect(result.subject.length).toBeGreaterThan(0);
    expect(result.predicate.length).toBeGreaterThan(0);
    expect(result.object.length).toBeGreaterThan(0);
  });
});
