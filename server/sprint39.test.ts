/**
 * sprint39.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for Sprint 39 changes:
 *   1. citedPmids field in ClaimResult
 *   2. Zero-citation confidence penalty in computeConfidence
 *   3. POST /api/public/decompose-claim endpoint
 *   4. hivProtease vertical adapter registered
 *   5. structural_biology HIV MeSH terms present
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// ─── 1 & 2: citedPmids + zero-citation confidence penalty ────────────────────

// We test these via the batch-verify route using mocked dependencies
vi.mock("./claimExtractor", () => ({
  extractClaims: vi.fn().mockResolvedValue([]),
}));
vi.mock("./pdbAdapter", () => ({
  verdictForClaim: vi.fn().mockResolvedValue({
    verdict: "Insufficient Evidence",
    rationale: "No PDB match",
    evidenceUrl: null,
    evidenceRaw: null,
  }),
}));
vi.mock("./discoveryLoopJob", () => ({
  computeSignalDensity: vi.fn().mockReturnValue(0),
}));
vi.mock("./_queryTranslator", () => ({
  translateQueryToClaims: vi.fn().mockResolvedValue([]),
}));
vi.mock("./autonomousIngest", () => ({
  triggerAutonomousIngest: vi.fn(),
  // PubMedResult type is only used for typing, no runtime value needed
}));
vi.mock("./ncbiAdapter", () => ({
  fetchNcbiResults: vi.fn().mockResolvedValue([]),
}));
vi.mock("./verticalAdapters/types", () => ({
  getVertical: vi.fn().mockReturnValue(null),
}));
vi.mock("./verticalAdapters", () => ({}));

import {
  registerPublicBatchVerifyRoute,
  _resetRateLimitForTesting,
} from "./publicBatchVerifyRoute";

function makeBatchApp() {
  const app = express();
  app.use(express.json());
  registerPublicBatchVerifyRoute(app);
  return app;
}

describe("Sprint 39 — citedPmids + zero-citation confidence penalty", () => {
  beforeEach(() => {
    _resetRateLimitForTesting();
  });

  it("includes citedPmids: [] when no PubMed results are found", async () => {
    const app = makeBatchApp();
    const res = await request(app)
      .post("/api/public/batch-verify")
      .send({ claims: ["Aspirin reduces inflammation"] });

    expect(res.status).toBe(200);
    const result = res.body.results[0];
    expect(result).toHaveProperty("citedPmids");
    expect(Array.isArray(result.citedPmids)).toBe(true);
    expect(result.citedPmids).toHaveLength(0);
  });

  it("caps confidence at 0.65 when verdict is Supported but no PubMed results", async () => {
    // Override extractClaims to return a claim so tryStructuredVerdict runs,
    // and pdbAdapter to return Supported with no pubmed evidence
    const { extractClaims } = await import("./claimExtractor");
    vi.mocked(extractClaims).mockResolvedValueOnce([
      {
        claimType: "pdb_structure",
        claimText: "Protein 1ABC has a resolution of 1.8 Å",
        pdbId: "1ABC",
        proteinName: "Test protein",
        experimentalMethod: "X-ray",
        resolution: "1.8",
        organism: null,
        ligand: null,
        extractedValue: "1ABC",
      } as never,
    ]);
    const { verdictForClaim } = await import("./pdbAdapter");
    vi.mocked(verdictForClaim).mockResolvedValueOnce({
      verdict: "Supported",
      rationale: "PDB match found",
      evidenceUrl: "https://rcsb.org/structure/1ABC",
      evidenceRaw: null as never,
    });

    const app = makeBatchApp();
    const res = await request(app)
      .post("/api/public/batch-verify")
      .send({ claims: ["Protein 1ABC has a resolution of 1.8 Å"] });

    expect(res.status).toBe(200);
    const result = res.body.results[0];
    // Verdict is Supported but pubmedResults is empty → confidence capped at 0.65
    expect(result.verdict).toBe("Supported");
    expect(result.confidence).toBeLessThanOrEqual(0.65);
    expect(result.citedPmids).toHaveLength(0);
  });

  it("does NOT cap confidence when PubMed results are present", async () => {
    const { fetchNcbiResults } = await import("./ncbiAdapter");
    vi.mocked(fetchNcbiResults).mockResolvedValueOnce([
      {
        pmid: "12345678",
        title: "HIV protease inhibitor study",
        abstractSnippet: "Darunavir binds HIV-1 protease",
        journal: "J Med Chem",
        year: 2020,
        citationUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
      },
      {
        pmid: "23456789",
        title: "Structure of HIV-1 protease",
        abstractSnippet: "Co-crystal structure at 1.5 Å",
        journal: "Nature",
        year: 2019,
        citationUrl: "https://pubmed.ncbi.nlm.nih.gov/23456789/",
      },
    ] as never);

    const app = makeBatchApp();
    const res = await request(app)
      .post("/api/public/batch-verify")
      .send({ claims: ["Darunavir inhibits HIV-1 protease"] });

    expect(res.status).toBe(200);
    const result = res.body.results[0];
    expect(result.citedPmids).toHaveLength(2);
    expect(result.citedPmids).toContain("12345678");
    expect(result.citedPmids).toContain("23456789");
    // With 2 PubMed results, confidence should be above 0.65
    expect(result.confidence).toBeGreaterThan(0.65);
  });
});

// ─── 3: decompose-claim endpoint ─────────────────────────────────────────────

vi.mock("./questionDecomposer", () => ({
  decomposeQuestion: vi.fn().mockResolvedValue({
    input: "test",
    claims: [
      { index: 0, text: "Decahydroisoquinoline scaffold inhibits HIV-1 protease", method: "heuristic", confidence: 0.88 },
      { index: 1, text: "Predicted pIC50=8.7 for Compound X", method: "heuristic", confidence: 0.72 },
    ],
    durationMs: 12,
    usedLlm: false,
  }),
}));

import {
  registerPublicDecomposeClaimRoute,
  _resetRateLimitForTesting as _resetDecomposeRateLimit,
  isVerifiable,
} from "./publicDecomposeClaimRoute";

function makeDecomposeApp() {
  const app = express();
  app.use(express.json());
  registerPublicDecomposeClaimRoute(app);
  return app;
}

describe("Sprint 39 — POST /api/public/decompose-claim", () => {
  beforeEach(() => {
    _resetDecomposeRateLimit();
  });

  it("returns 400 when claim is missing", async () => {
    const app = makeDecomposeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 when claim is empty string", async () => {
    const app = makeDecomposeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claim: "   " });
    expect(res.status).toBe(400);
  });

  it("returns decomposed claims with verifiable flag", async () => {
    const app = makeDecomposeApp();
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({
        claim: "Compound X shows predicted pIC50=8.7 against HIV-1 protease via decahydroisoquinoline scaffold",
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.apiVersion).toBe("1.1");
    expect(Array.isArray(res.body.claims)).toBe(true);

    // First claim (structural) should be verifiable
    const structural = res.body.claims.find((c: { text: string }) =>
      c.text.includes("Decahydroisoquinoline")
    );
    expect(structural).toBeDefined();
    expect(structural.verifiable).toBe(true);

    // Second claim (predicted value) should NOT be verifiable
    const predicted = res.body.claims.find((c: { text: string }) =>
      c.text.includes("Predicted pIC50")
    );
    expect(predicted).toBeDefined();
    expect(predicted.verifiable).toBe(false);
  });

  it("handles CORS preflight for notus.is origin", async () => {
    const app = makeDecomposeApp();
    const res = await request(app)
      .options("/api/public/decompose-claim")
      .set("Origin", "https://notus.is");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://notus.is");
  });

  it("returns 429 after rate limit exceeded", async () => {
    const app = makeDecomposeApp();
    // Send 20 requests (the limit)
    for (let i = 0; i < 20; i++) {
      await request(app)
        .post("/api/public/decompose-claim")
        .send({ claim: `Claim ${i}` });
    }
    // 21st should be rate-limited
    const res = await request(app)
      .post("/api/public/decompose-claim")
      .send({ claim: "One more claim" });
    expect(res.status).toBe(429);
  });
});

// ─── isVerifiable unit tests ──────────────────────────────────────────────────

describe("Sprint 39 — isVerifiable heuristic", () => {
  it("returns false for predicted pIC50 claims", () => {
    expect(isVerifiable("Predicted pIC50=8.7 for Compound X")).toBe(false);
    expect(isVerifiable("predicted Ki=2.3 nM against HIV protease")).toBe(false);
  });

  it("returns false for in silico claims", () => {
    expect(isVerifiable("In silico docking suggests binding affinity of -9.2 kcal/mol")).toBe(false);
  });

  it("returns false for SMILES-containing claims", () => {
    expect(isVerifiable("SMILES: CC(C)Cc1ccccc1 shows activity")).toBe(false);
  });

  it("returns false for docking score claims", () => {
    expect(isVerifiable("Docking score of -8.5 kcal/mol predicted")).toBe(false);
  });

  it("returns true for structural biology claims", () => {
    expect(isVerifiable("Decahydroisoquinoline scaffold inhibits HIV-1 protease")).toBe(true);
    expect(isVerifiable("Darunavir binds HIV-1 protease at the active site")).toBe(true);
    expect(isVerifiable("PDB entry 2IQG shows darunavir co-crystal structure")).toBe(true);
  });

  it("returns true for mechanism-of-action claims", () => {
    expect(isVerifiable("HIV-1 protease cleaves the Gag-Pol polyprotein")).toBe(true);
  });
});

// ─── 4: hivProtease vertical adapter registered ───────────────────────────────

describe("Sprint 39 — hivProtease vertical adapter", () => {
  it("is registered under domainKey hiv_protease", async () => {
    // Import the registry after all adapters are loaded
    const { getVertical } = await import("./verticalAdapters/types");
    // We need the real implementation, not the mock
    vi.unmock("./verticalAdapters/types");
    vi.unmock("./verticalAdapters");

    // Re-import to get real registry
    const { listVerticals } = await import("./verticalAdapters/types");
    const verticals = listVerticals();
    const hivAdapter = verticals.find(v => v.domainKey === "hiv_protease");
    expect(hivAdapter).toBeDefined();
    expect(hivAdapter?.displayName).toContain("HIV");
  });
});

// ─── 5: structural_biology HIV MeSH terms ────────────────────────────────────

describe("Sprint 39 — structural_biology HIV MeSH terms", () => {
  it("includes HIV Protease Inhibitors MeSH term in discoverySearchTerms", async () => {
    vi.unmock("./verticalAdapters/types");
    vi.unmock("./verticalAdapters");
    const { getVertical } = await import("./verticalAdapters/types");
    const adapter = getVertical("structural_biology");
    expect(adapter).toBeDefined();
    const terms = adapter?.discoverySearchTerms ?? [];
    const hasHivMesh = terms.some(t => t.includes("HIV Protease Inhibitors[MeSH]"));
    expect(hasHivMesh).toBe(true);
  });
});
