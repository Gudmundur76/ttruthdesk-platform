import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies before importing the module under test
vi.mock("./db", () => ({
  getDocumentById: vi.fn(),
  getClaimsByDocument: vi.fn(),
  getDb: vi.fn(),
}));
vi.mock("./_core/multiLLM", () => ({
  invokeMultiLLM: vi.fn(),
  extractLLMText: vi
    .fn()
    .mockReturnValue('{"sourceRefs":[],"evidenceSummary":"Strong evidence."}'),
}));
vi.mock("./logger", () => ({
  logger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { FactCheckAssembler } from "./factCheckAssembler";
import { getDocumentById, getClaimsByDocument, getDb } from "./db";
import { invokeMultiLLM, extractLLMText } from "./_core/multiLLM";

describe("FactCheckAssembler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default extractLLMText mock
    vi.mocked(extractLLMText).mockReturnValue(
      '{"sourceRefs":[],"evidenceSummary":"Strong evidence."}'
    );
  });

  it("exports FactCheckAssembler class and factCheckAssembler singleton", async () => {
    const mod = await import("./factCheckAssembler");
    expect(mod.FactCheckAssembler).toBeDefined();
    expect(mod.factCheckAssembler).toBeDefined();
  });

  it("throws NOT_FOUND when document does not exist", async () => {
    vi.mocked(getDocumentById).mockResolvedValue(null);
    const assembler = new FactCheckAssembler();
    await expect(assembler.assemble(999)).rejects.toThrow(
      "Document 999 not found"
    );
  });

  it("throws when document has no claims", async () => {
    vi.mocked(getDocumentById).mockResolvedValue({
      id: 1,
      title: "Test",
      rawText: "test",
      status: "complete",
    } as any);
    vi.mocked(getClaimsByDocument).mockResolvedValue([]);
    const assembler = new FactCheckAssembler();
    await expect(assembler.assemble(1)).rejects.toThrow("no claims");
  });

  it("assembles a fact-check document with LLM calls", async () => {
    vi.mocked(getDocumentById).mockResolvedValue({
      id: 1,
      title: "Protein folding study",
      rawText: "This paper claims...",
      status: "complete",
    } as any);
    vi.mocked(getClaimsByDocument).mockResolvedValue([
      {
        id: 10,
        claimText: "Protein X folds in 2ms",
        verdict: "Supported",
        confidenceScore: 0.85,
        documentId: 1,
        pdbEvidenceUrl: null,
      } as any,
    ]);
    // invokeMultiLLM returns an LLMResponse object; extractLLMText extracts the text
    vi.mocked(invokeMultiLLM).mockResolvedValue({
      choices: [{ message: { content: "" } }],
    } as any);
    // preamble call
    vi.mocked(extractLLMText)
      .mockReturnValueOnce("This study examines protein folding kinetics.")
      // enrichOneClaim call
      .mockReturnValueOnce(
        '{"sourceRefs":[{"title":"PDB Entry 1ABC","relevanceNote":"Direct structural evidence"}],"evidenceSummary":"Strong PDB evidence."}'
      )
      // overall verdict call
      .mockReturnValueOnce(
        '{"verdict":"Supported","confidence":0.85,"rationale":"All claims supported."}'
      )
      // relevance analysis call
      .mockReturnValueOnce(
        "The claims are consistent with established structural biology."
      );

    const mockDb = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const assembler = new FactCheckAssembler();
    const result = await assembler.assemble(1);

    expect(result.documentId).toBe(1);
    expect(result.title).toBe("Protein folding study");
    expect(result.claimFactChecks).toHaveLength(1);
    expect(result.claimFactChecks[0].claimId).toBe(10);
    expect(result.overallVerdict).toBe("Supported");
    expect(result.factCheckPreamble).toBe(
      "This study examines protein folding kinetics."
    );
    expect(result.relevanceAnalysis).toBe(
      "The claims are consistent with established structural biology."
    );
    expect(invokeMultiLLM).toHaveBeenCalledTimes(4); // preamble + 1 claim + verdict + relevance
  });
});
