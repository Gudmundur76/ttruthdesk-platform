/**
 * autonomousIngest.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the autonomous knowledge loop service.
 *
 * All external dependencies (DB, LLM, adapters, alertDispatcher, eventBus)
 * are mocked so the tests run without a live database or network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock all external dependencies before importing the module under test ────

vi.mock("./db", () => ({
  createDocument: vi.fn().mockResolvedValue(42),
  insertClaims: vi.fn().mockResolvedValue(undefined),
  updateDocumentStatus: vi.fn().mockResolvedValue(undefined),
  updateClaimVerdict: vi.fn().mockResolvedValue(undefined),
  getClaimsByDocument: vi.fn().mockResolvedValue([
    {
      id: 1,
      claimText: "Lysozyme has antimicrobial activity",
      claimType: "protein_name",
      proteinName: "Lysozyme",
      organism: "Homo sapiens",
      pdbId: null,
      extractedValue: null,
      verdict: "Supported",
      confidenceScore: 0.9,
    },
  ]),
  upsertGraphEntity: vi.fn().mockResolvedValue({ id: 100, canonicalName: "Lysozyme", entityType: "protein" }),
  upsertGraphRelation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            claims: [
              {
                claimText: "Lysozyme has antimicrobial activity against gram-positive bacteria",
                claimType: "protein_name",
                proteinName: "Lysozyme",
                organism: "Homo sapiens",
              },
              {
                claimText: "Salmon collagen has high thermal stability",
                claimType: "general_molecular",
                extractedValue: "high thermal stability",
              },
            ],
          }),
        },
      },
    ],
  }),
}));

vi.mock("./verticalAdapters", () => ({
  getVertical: vi.fn().mockReturnValue({
    lookupEvidence: vi.fn().mockResolvedValue({
      found: true,
      sourceId: "1LYZ",
      sourceUrl: "https://www.rcsb.org/structure/1LYZ",
      evidenceRaw: { resolution: 1.5 },
      confidenceScore: 0.92,
      confidenceFlags: [],
    }),
  }),
}));

vi.mock("./alertDispatcher", () => ({
  dispatchHighRiskAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./autonomousLoop/eventBus", () => ({
  publishEvent: vi.fn().mockResolvedValue(7),
}));

vi.mock("./seo/indexNow", () => ({
  reportUrl: vi.fn().mockReturnValue("https://truthdesk.is/reports/42"),
}));

// ─── Import after mocks are set up ────────────────────────────────────────────

import { processQueryResults, triggerAutonomousIngest } from "./autonomousIngest";
import * as db from "./db";
import * as llm from "./_core/llm";
import * as eventBus from "./autonomousLoop/eventBus";
import * as alertDispatcher from "./alertDispatcher";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("autonomousIngest.processQueryResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early when no pubmed results and no uniprot entries", async () => {
    await processQueryResults({ query: "test query" });
    expect(db.createDocument).not.toHaveBeenCalled();
  });

  it("creates a document when pubmed results are provided", async () => {
    await processQueryResults({
      query: "lysozyme antimicrobial",
      pubmedResults: [
        {
          pmid: "12345678",
          title: "Lysozyme structure and function",
          abstractSnippet: "Lysozyme is a ubiquitous antimicrobial enzyme.",
          citationUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
          authors: ["Smith J"],
          journal: "Nature",
          year: 2020,
        },
      ],
    });

    expect(db.createDocument).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(db.createDocument).mock.calls[0][0];
    expect(callArgs.sourceType).toBe("paste");
    expect(callArgs.title).toContain("CopilotKit Query");
    expect(callArgs.title).toContain("PMID:12345678");
    expect(callArgs.status).toBe("extracting");
  });

  it("calls LLM to extract claims from combined text", async () => {
    await processQueryResults({
      query: "salmon collagen",
      pubmedResults: [
        {
          pmid: "99999999",
          title: "Salmon collagen biosimilar potential",
          abstractSnippet: "Salmon collagen shows promise as a biosimilar scaffold.",
          citationUrl: "https://pubmed.ncbi.nlm.nih.gov/99999999/",
        },
      ],
    });

    expect(llm.invokeLLM).toHaveBeenCalledOnce();
    const messages = vi.mocked(llm.invokeLLM).mock.calls[0][0].messages;
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("salmon collagen");
  });

  it("inserts extracted claims into the database", async () => {
    await processQueryResults({
      query: "lysozyme structure",
      pubmedResults: [
        {
          pmid: "11111111",
          title: "Lysozyme X-ray structure",
          abstractSnippet: "High-resolution structure of lysozyme at 1.5 Å.",
          citationUrl: "https://pubmed.ncbi.nlm.nih.gov/11111111/",
        },
      ],
    });

    expect(db.insertClaims).toHaveBeenCalledOnce();
    const claimInserts = vi.mocked(db.insertClaims).mock.calls[0][0];
    expect(claimInserts.length).toBeGreaterThan(0);
    expect(claimInserts[0].documentId).toBe(42);
    expect(claimInserts[0].claimType).toBeDefined();
  });

  it("publishes a document_submitted event to the autonomous loop", async () => {
    await processQueryResults({
      query: "protein folding",
      pubmedResults: [
        {
          pmid: "22222222",
          title: "Protein folding mechanisms",
          abstractSnippet: "Chaperones assist in protein folding.",
          citationUrl: "https://pubmed.ncbi.nlm.nih.gov/22222222/",
        },
      ],
    });

    expect(eventBus.publishEvent).toHaveBeenCalledWith(
      "document_submitted",
      expect.objectContaining({
        documentId: 42,
        source: "copilot_query",
        query: "protein folding",
      })
    );
  });

  it("upserts graph entities for each inserted claim", async () => {
    await processQueryResults({
      query: "lysozyme",
      pubmedResults: [
        {
          pmid: "33333333",
          title: "Lysozyme in immune defense",
          abstractSnippet: "Lysozyme plays a key role in innate immunity.",
          citationUrl: "https://pubmed.ncbi.nlm.nih.gov/33333333/",
        },
      ],
    });

    // Should upsert at least a document entity + protein entity
    expect(db.upsertGraphEntity).toHaveBeenCalled();
    const entityCalls = vi.mocked(db.upsertGraphEntity).mock.calls;
    const entityTypes = entityCalls.map(c => c[0].entityType);
    expect(entityTypes).toContain("document");
  });

  it("upserts PMID concept entities for each PubMed result", async () => {
    await processQueryResults({
      query: "collagen structure",
      pubmedResults: [
        {
          pmid: "44444444",
          title: "Collagen triple helix structure",
          abstractSnippet: "Collagen forms a characteristic triple helix.",
          citationUrl: "https://pubmed.ncbi.nlm.nih.gov/44444444/",
        },
      ],
    });

    const entityCalls = vi.mocked(db.upsertGraphEntity).mock.calls;
    const pmidEntity = entityCalls.find(c => c[0].canonicalName === "PMID:44444444");
    expect(pmidEntity).toBeDefined();
    expect(pmidEntity![0].entityType).toBe("concept");
  });

  it("upserts UniProt accession entities when uniprot entries are provided", async () => {
    await processQueryResults({
      query: "P00698",
      uniprotEntries: [
        {
          accession: "P00698",
          proteinName: "Lysozyme C",
          organism: "Gallus gallus",
          url: "https://www.uniprot.org/uniprot/P00698",
        },
      ],
    });

    const entityCalls = vi.mocked(db.upsertGraphEntity).mock.calls;
    const uniprotEntity = entityCalls.find(c => c[0].canonicalName === "P00698");
    expect(uniprotEntity).toBeDefined();
    expect(uniprotEntity![0].entityType).toBe("protein");
  });

  it("marks document as complete after processing", async () => {
    await processQueryResults({
      query: "enzyme kinetics",
      pubmedResults: [
        {
          pmid: "55555555",
          title: "Enzyme kinetics review",
          abstractSnippet: "Michaelis-Menten kinetics govern enzyme activity.",
          citationUrl: "https://pubmed.ncbi.nlm.nih.gov/55555555/",
        },
      ],
    });

    const statusCalls = vi.mocked(db.updateDocumentStatus).mock.calls;
    const finalStatus = statusCalls[statusCalls.length - 1];
    expect(finalStatus[1]).toBe("complete");
  });
});

describe("autonomousIngest.triggerAutonomousIngest", () => {
  it("does not throw when called fire-and-forget", () => {
    expect(() => {
      triggerAutonomousIngest({
        query: "test",
        pubmedResults: [],
        uniprotEntries: [],
      });
    }).not.toThrow();
  });
});
