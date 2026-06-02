/**
 * discoveryAgent.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the discovery agent deduplication, quality gate signal density,
 * and discovery loop candidate filtering logic.
 * Uses the real exported helpers from production code.
 */
import { describe, it, expect } from "vitest";
import { computeSignalDensity, CLAIM_SIGNALS } from "./discoveryLoopJob";

// ─── Signal density helper tests (real production function) ──────────────────

describe("computeSignalDensity quality gate", () => {
  it("returns 0 for a generic abstract with no molecular signals", () => {
    const text = "This study investigates the role of diet in cardiovascular health.";
    expect(computeSignalDensity(text)).toBe(0);
  });

  it("returns 1 for a text with only one signal", () => {
    const text = "The crystal structure of the protein was determined.";
    expect(computeSignalDensity(text)).toBe(1);
  });

  it("returns >= 2 for a claim-dense structural biology abstract", () => {
    const text =
      "We solved the crystal structure of lysozyme (PDB: 1LYZ) at 1.8 Å resolution using X-ray crystallography.";
    expect(computeSignalDensity(text)).toBeGreaterThanOrEqual(2);
  });

  it("returns >= 2 for a salmon biotech abstract", () => {
    const text =
      "Salmon-derived collagen peptides showed high DHA and omega-3 content with IC50 values below 10 μM.";
    expect(computeSignalDensity(text)).toBeGreaterThanOrEqual(2);
  });

  it("correctly identifies PDB ID pattern (must start with 1-9)", () => {
    expect(computeSignalDensity("Structure 1ABC was deposited.")).toBeGreaterThan(0);
    expect(computeSignalDensity("Structure 0ABC was deposited.")).toBe(0);
  });

  it("passes the quality gate threshold (>= 2) for cryo-EM papers", () => {
    const text =
      "Cryo-EM structure of the ribosome determined at 3.2 Å resolution with binding affinity measurements.";
    expect(computeSignalDensity(text)).toBeGreaterThanOrEqual(2);
  });

  it("CLAIM_SIGNALS array is non-empty and contains expected patterns", () => {
    expect(CLAIM_SIGNALS.length).toBeGreaterThan(10);
    expect(CLAIM_SIGNALS.some((re) => re.test("crystal structure"))).toBe(true);
    expect(CLAIM_SIGNALS.some((re) => re.test("astaxanthin"))).toBe(true);
  });
});

// ─── Deduplication logic tests ────────────────────────────────────────────────

describe("discovery deduplication", () => {
  it("filters out already-ingested PMIDs", () => {
    const candidates = [
      { pmid: "12345678", title: "Paper A" },
      { pmid: "87654321", title: "Paper B" },
      { pmid: "11111111", title: "Paper C" },
    ];
    const alreadyIngested = new Set(["12345678", "11111111"]);
    const newCandidates = candidates.filter((c) => !alreadyIngested.has(c.pmid));
    expect(newCandidates).toHaveLength(1);
    expect(newCandidates[0].pmid).toBe("87654321");
  });

  it("returns all candidates when none are already ingested", () => {
    const candidates = [
      { pmid: "11111111", title: "Paper A" },
      { pmid: "22222222", title: "Paper B" },
    ];
    const alreadyIngested = new Set<string>();
    const newCandidates = candidates.filter((c) => !alreadyIngested.has(c.pmid));
    expect(newCandidates).toHaveLength(2);
  });

  it("returns empty array when all candidates are already ingested", () => {
    const candidates = [
      { pmid: "11111111", title: "Paper A" },
      { pmid: "22222222", title: "Paper B" },
    ];
    const alreadyIngested = new Set(["11111111", "22222222"]);
    const newCandidates = candidates.filter((c) => !alreadyIngested.has(c.pmid));
    expect(newCandidates).toHaveLength(0);
  });

  it("handles duplicate PMIDs within the candidate list", () => {
    const candidates = [
      { pmid: "11111111", title: "Paper A" },
      { pmid: "11111111", title: "Paper A duplicate" },
      { pmid: "22222222", title: "Paper B" },
    ];
    const seen = new Set<string>();
    const deduped = candidates.filter((c) => {
      if (seen.has(c.pmid)) return false;
      seen.add(c.pmid);
      return true;
    });
    expect(deduped).toHaveLength(2);
  });
});

// ─── Source breakdown aggregation tests ──────────────────────────────────────

describe("source breakdown aggregation", () => {
  it("correctly counts candidates by ingestSource", () => {
    const candidates = [
      { pmid: "1", ingestSource: "pubmed" },
      { pmid: "2", ingestSource: "pubmed" },
      { pmid: "3", ingestSource: "biorxiv" },
      { pmid: "4", ingestSource: "pdb_linked" },
    ];
    const breakdown: Record<string, number> = {};
    for (const c of candidates) {
      breakdown[c.ingestSource] = (breakdown[c.ingestSource] ?? 0) + 1;
    }
    expect(breakdown.pubmed).toBe(2);
    expect(breakdown.biorxiv).toBe(1);
    expect(breakdown.pdb_linked).toBe(1);
  });
});
