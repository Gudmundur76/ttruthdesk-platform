/**
 * agentOrchestrator.test.ts
 * Unit tests for the Manus-style agent orchestrator.
 * All external adapters are mocked — no network calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentResponse } from "./agentOrchestrator";

// ─── Mock all external dependencies ──────────────────────────────────────────

vi.mock("./questionDecomposer", () => ({
  decomposeQuestion: vi.fn(),
  buildPubMedQuery: vi.fn().mockReturnValue("aspirin cardiovascular risk"),
}));

vi.mock("./domainClassifier", () => ({
  classifyClaim: vi.fn(),
}));

vi.mock("./ncbiAdapter", () => ({
  fetchNcbiResults: vi.fn(),
}));

vi.mock("./pdbAdapter", () => ({
  verdictForClaim: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { runAgent } from "./agentOrchestrator";
import { decomposeQuestion, buildPubMedQuery } from "./questionDecomposer";
import {
  classifyClaim,
  type SourceId,
  type DomainLabel,
} from "./domainClassifier";
import { fetchNcbiResults } from "./ncbiAdapter";
import { verdictForClaim } from "./pdbAdapter";

const mockDecompose = vi.mocked(decomposeQuestion);
const mockClassify = vi.mocked(classifyClaim);
const mockNcbi = vi.mocked(fetchNcbiResults);
const mockPdb = vi.mocked(verdictForClaim);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CLAIM_ASPIRIN = {
  text: "Aspirin reduces cardiovascular risk in adults over 50",
  method: "heuristic" as const,
  confidence: 0.9,
  index: 0,
};

const PUBMED_ROUTE = {
  routes: [
    {
      sourceId: "pubmed" as SourceId,
      confidence: 0.9,
      reason: "medicine domain",
    },
  ],
  domain: "pharmacology" as DomainLabel,
  claim: CLAIM_ASPIRIN,
  durationMs: 5,
};

const PDB_ROUTE = {
  routes: [
    {
      sourceId: "rcsb_pdb" as SourceId,
      confidence: 0.95,
      reason: "structural biology",
    },
  ],
  domain: "structural_biology" as DomainLabel,
  claim: CLAIM_ASPIRIN,
  durationMs: 5,
};

const NCBI_RESULT = [
  {
    pmid: "28886670",
    title: "Aspirin in Primary Prevention of Cardiovascular Disease",
    abstractSnippet:
      "Aspirin significantly reduced the risk of major cardiovascular events.",
    citationUrl: "https://pubmed.ncbi.nlm.nih.gov/28886670/",
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a well-formed AgentResponse with correct shape", async () => {
    mockDecompose.mockResolvedValue({
      input: "Does aspirin reduce cardiovascular risk?",
      claims: [CLAIM_ASPIRIN],
      durationMs: 50,
      usedLlm: false,
    });
    mockClassify.mockReturnValue(PUBMED_ROUTE);
    mockNcbi.mockResolvedValue(NCBI_RESULT);

    const result: AgentResponse = await runAgent(
      "Does aspirin reduce cardiovascular risk?"
    );

    expect(result.question).toBe("Does aspirin reduce cardiovascular risk?");
    expect(result.claims).toHaveLength(1);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.overallVerdict).toBeDefined();
  });

  it("returns Supported verdict when 2+ NCBI results found", async () => {
    mockDecompose.mockResolvedValue({
      input: "Aspirin reduces risk",
      claims: [CLAIM_ASPIRIN],
      durationMs: 10,
      usedLlm: false,
    });
    mockClassify.mockReturnValue(PUBMED_ROUTE);
    mockNcbi.mockResolvedValue([
      ...NCBI_RESULT,
      { ...NCBI_RESULT[0], pmid: "12345" },
    ]);

    const result = await runAgent("Aspirin reduces risk");

    expect(result.claims[0].verdict).toBe("Supported");
    expect(result.claims[0].confidence).toBeGreaterThan(0.8);
    expect(result.overallVerdict).toBe("Supported");
  });

  it("returns Partially Supported verdict when exactly 1 NCBI result found", async () => {
    mockDecompose.mockResolvedValue({
      input: "Aspirin reduces risk",
      claims: [CLAIM_ASPIRIN],
      durationMs: 10,
      usedLlm: false,
    });
    mockClassify.mockReturnValue(PUBMED_ROUTE);
    mockNcbi.mockResolvedValue([NCBI_RESULT[0]]);

    const result = await runAgent("Aspirin reduces risk");

    expect(result.claims[0].verdict).toBe("Partially Supported");
    expect(result.claims[0].confidence).toBe(0.65);
  });

  it("returns Insufficient Evidence when no NCBI results found", async () => {
    mockDecompose.mockResolvedValue({
      input: "Unknown claim",
      claims: [CLAIM_ASPIRIN],
      durationMs: 10,
      usedLlm: false,
    });
    mockClassify.mockReturnValue(PUBMED_ROUTE);
    mockNcbi.mockResolvedValue([]);

    const result = await runAgent("Unknown claim");

    expect(result.claims[0].verdict).toBe("Insufficient Evidence");
    expect(result.claims[0].evidence).toBeNull();
    expect(result.overallVerdict).toBe("Insufficient Evidence");
  });

  it("routes to PDB adapter when domain is structural_biology", async () => {
    mockDecompose.mockResolvedValue({
      input: "Lysozyme is found in human tears",
      claims: [{ ...CLAIM_ASPIRIN, text: "Lysozyme is found in human tears" }],
      durationMs: 10,
      usedLlm: false,
    });
    mockClassify.mockReturnValue(PDB_ROUTE);
    mockPdb.mockResolvedValue({
      verdict: "Supported",
      rationale:
        "Lysozyme (PDB: 1LYZ) is a well-characterised antimicrobial enzyme present in tears.",
      evidenceUrl: "https://www.rcsb.org/structure/1LYZ",
      evidenceRaw: null,
    });

    const result = await runAgent("Lysozyme is found in human tears");

    expect(mockPdb).toHaveBeenCalledOnce();
    expect(mockNcbi).not.toHaveBeenCalled();
    expect(result.claims[0].verdict).toBe("Supported");
    expect(result.claims[0].evidence?.url).toContain("rcsb.org");
  });

  it("includes sentence-level provenance in evidence", async () => {
    mockDecompose.mockResolvedValue({
      input: "Aspirin reduces risk",
      claims: [CLAIM_ASPIRIN],
      durationMs: 10,
      usedLlm: false,
    });
    mockClassify.mockReturnValue(PUBMED_ROUTE);
    mockNcbi.mockResolvedValue(NCBI_RESULT);

    const result = await runAgent("Aspirin reduces risk");

    const evidence = result.claims[0].evidence;
    expect(evidence).not.toBeNull();
    expect(evidence?.pmid).toBe("28886670");
    expect(evidence?.sentence).toBe(
      "Aspirin significantly reduced the risk of major cardiovascular events."
    );
    expect(evidence?.url).toContain("pubmed.ncbi.nlm.nih.gov");
  });

  it("handles multiple claims in parallel and aggregates verdict", async () => {
    const claim1 = { ...CLAIM_ASPIRIN, text: "Aspirin reduces risk", index: 0 };
    const claim2 = {
      ...CLAIM_ASPIRIN,
      text: "Ibuprofen reduces fever",
      index: 1,
    };
    mockDecompose.mockResolvedValue({
      input: "Aspirin reduces risk and ibuprofen reduces fever",
      claims: [claim1, claim2],
      durationMs: 20,
      usedLlm: false,
    });
    mockClassify.mockReturnValue(PUBMED_ROUTE);
    mockNcbi.mockResolvedValue([
      ...NCBI_RESULT,
      { ...NCBI_RESULT[0], pmid: "99999" },
    ]);

    const result = await runAgent(
      "Aspirin reduces risk and ibuprofen reduces fever"
    );

    expect(result.claims).toHaveLength(2);
    expect(result.overallVerdict).toBe("Supported");
  });

  it("returns Insufficient Evidence for empty question after decomposition", async () => {
    mockDecompose.mockResolvedValue({
      input: "hmm",
      claims: [],
      durationMs: 5,
      usedLlm: false,
    });

    const result = await runAgent("hmm");

    expect(result.claims).toHaveLength(0);
    expect(result.overallVerdict).toBe("Insufficient Evidence");
  });

  it("handles verifier errors gracefully without crashing", async () => {
    mockDecompose.mockResolvedValue({
      input: "Aspirin reduces risk",
      claims: [CLAIM_ASPIRIN],
      durationMs: 10,
      usedLlm: false,
    });
    mockClassify.mockReturnValue(PUBMED_ROUTE);
    mockNcbi.mockRejectedValue(new Error("NCBI timeout"));

    const result = await runAgent("Aspirin reduces risk");

    expect(result.claims[0].verdict).toBe("Insufficient Evidence");
    expect(result.claims[0].evidence).toBeNull();
  });

  it("includes domain label from classifier in each claim result", async () => {
    mockDecompose.mockResolvedValue({
      input: "Aspirin reduces risk",
      claims: [CLAIM_ASPIRIN],
      durationMs: 10,
      usedLlm: false,
    });
    mockClassify.mockReturnValue(PUBMED_ROUTE);
    mockNcbi.mockResolvedValue(NCBI_RESULT);

    const result = await runAgent("Aspirin reduces risk");

    expect(result.claims[0].domain).toBe("pharmacology");
  });
});
