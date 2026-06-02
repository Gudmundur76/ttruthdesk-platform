/**
 * discoveryAgent.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the discovery agent deduplication, quality gate signal density,
 * and discovery loop candidate filtering logic.
 */
import { describe, it, expect } from "vitest";

// ─── Signal density helper (extracted from discoveryLoopJob.ts for testing) ──

const CLAIM_SIGNALS = [
  /\bPDB\b/i,
  /\b[1-9][A-Z0-9]{3}\b/,
  /\bcrystal structure\b/i,
  /\bcryo-?EM\b/i,
  /\bX-ray\b/i,
  /\bresolution\b.*\bÅ\b/i,
  /\bbinding affinity\b/i,
  /\bIC50\b/i,
  /\bKd\b/,
  /\bKi\b/,
  /\bomega-3\b/i,
  /\bastaxanthin\b/i,
  /\bcollagen\b/i,
  /\bEPA\b/,
  /\bDHA\b/,
  /\bmarine peptide\b/i,
];

function signalDensity(text: string): number {
  return CLAIM_SIGNALS.filter((re) => re.test(text)).length;
}

// ─── Quality gate tests ───────────────────────────────────────────────────────

describe("signalDensity quality gate", () => {
  it("returns 0 for a generic abstract with no molecular signals", () => {
    const text = "This study investigates the role of diet in cardiovascular health.";
    expect(signalDensity(text)).toBe(0);
  });

  it("returns 1 for a text with only one signal", () => {
    const text = "The crystal structure of the protein was determined.";
    expect(signalDensity(text)).toBe(1);
  });

  it("returns >= 2 for a claim-dense structural biology abstract", () => {
    const text =
      "We solved the crystal structure of lysozyme (PDB: 1LYZ) at 1.8 Å resolution using X-ray crystallography.";
    expect(signalDensity(text)).toBeGreaterThanOrEqual(2);
  });

  it("returns >= 2 for a salmon biotech abstract", () => {
    const text =
      "Salmon-derived collagen peptides showed high DHA and omega-3 content with IC50 values below 10 μM.";
    expect(signalDensity(text)).toBeGreaterThanOrEqual(2);
  });

  it("correctly identifies PDB ID pattern", () => {
    expect(signalDensity("Structure 1ABC was deposited.")).toBeGreaterThan(0);
    expect(signalDensity("Structure 0ABC was deposited.")).toBe(0); // must start with 1-9
  });

  it("passes the quality gate threshold (>= 2) for cryo-EM papers", () => {
    const text = "Cryo-EM structure of the ribosome determined at 3.2 Å resolution with binding affinity measurements.";
    expect(signalDensity(text)).toBeGreaterThanOrEqual(2);
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
