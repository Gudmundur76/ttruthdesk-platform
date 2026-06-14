/**
 * evidenceSynthesizer.test.ts
 * Unit tests for synthesiseEvidence and applySynthesis
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EvidenceResult } from "./types";

const mocks = vi.hoisted(() => ({
  mockInvokeLLM: vi.fn(),
}));

vi.mock("../_core/llm", () => ({
  invokeLLM: mocks.mockInvokeLLM,
}));

describe("applySynthesis", () => {
  it("merges synthesis into base result", async () => {
    const { applySynthesis } = await import("./evidenceSynthesizer");
    const base: EvidenceResult = {
      found: true,
      sourceId: "CID:123",
      sourceUrl: "https://pubchem.ncbi.nlm.nih.gov/compound/123",
      evidenceRaw: { cid: 123 },
      confidenceScore: 0.5,
      confidenceFlags: ["base-flag"],
    };
    const synthesis = {
      confidenceScore: 0.9,
      confidenceFlags: ["[LLM-synthesised]", "strong-evidence"],
      verdictRationale: "Well-supported by RCTs",
      synthesisModel: "claude-3-opus",
    };
    const result = applySynthesis(base, synthesis);
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("CID:123");
    expect(result.confidenceScore).toBe(0.9);
    expect(result.confidenceFlags).toContain("[LLM-synthesised]");
    expect(result.evidenceRaw).toMatchObject({ verdictRationale: "Well-supported by RCTs" });
  });

  it("preserves sourceUrl and sourceId from base", async () => {
    const { applySynthesis } = await import("./evidenceSynthesizer");
    const base: EvidenceResult = {
      found: false,
      sourceId: "pmid:9999",
      sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/9999",
      evidenceRaw: null,
      confidenceScore: 0.3,
      confidenceFlags: [],
    };
    const synthesis = {
      confidenceScore: 0.2,
      confidenceFlags: ["[LLM-synthesised]"],
      verdictRationale: "Insufficient evidence",
      synthesisModel: "heuristic",
    };
    const result = applySynthesis(base, synthesis);
    expect(result.sourceId).toBe("pmid:9999");
    expect(result.sourceUrl).toBe("https://pubmed.ncbi.nlm.nih.gov/9999");
    expect(result.found).toBe(false);
  });
});

describe("synthesiseEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeRaw = (overrides = {}) => ({
    domainKey: "protein_supplement",
    domainName: "Nutrition",
    claimText: "Creatine supplementation improves athletic performance",
    extractedValue: "creatine",
    rctCount: 12,
    topPmids: ["12345", "67890"],
    pubchemCid: 586,
    compoundName: "Creatine",
    uniprotFound: false,
    uniprotFlags: [] as string[],
    fdaAdverseCount: 3,
    baseScore: 0.72,
    baseFlags: ["RCT_EVIDENCE"],
    ...overrides,
  });

  it("returns LLM-synthesised result when invokeLLM succeeds", async () => {
    mocks.mockInvokeLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            confidenceScore: 0.88,
            confidenceFlags: ["strong-RCT-support", "well-replicated"],
            verdictRationale: "Multiple RCTs confirm the claim",
          }),
        },
      }],
      model: "claude-3-opus",
    });
    const { synthesiseEvidence } = await import("./evidenceSynthesizer");
    const result = await synthesiseEvidence(makeRaw());
    expect(result.confidenceScore).toBe(0.88);
    expect(result.confidenceFlags).toContain("[LLM-synthesised]");
    expect(result.verdictRationale).toBe("Multiple RCTs confirm the claim");
    expect(result.synthesisModel).toBe("claude-3-opus");
  });

  it("clamps confidenceScore to [0, 1]", async () => {
    mocks.mockInvokeLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            confidenceScore: 1.5, // out of range
            confidenceFlags: [],
            verdictRationale: "Overly confident",
          }),
        },
      }],
      model: "test-model",
    });
    const { synthesiseEvidence } = await import("./evidenceSynthesizer");
    const result = await synthesiseEvidence(makeRaw());
    expect(result.confidenceScore).toBe(1.0);
  });

  it("falls back to heuristic when invokeLLM throws", async () => {
    mocks.mockInvokeLLM.mockRejectedValueOnce(new Error("LLM timeout"));
    const { synthesiseEvidence } = await import("./evidenceSynthesizer");
    const result = await synthesiseEvidence(makeRaw({ baseScore: 0.65, baseFlags: ["HEURISTIC"] }));
    expect(result.confidenceScore).toBe(0.65);
    expect(result.confidenceFlags).toContain("[heuristic-fallback]");
    expect(result.synthesisModel).toBe("heuristic");
  });

  it("falls back to heuristic when LLM returns empty content", async () => {
    mocks.mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
      model: "test-model",
    });
    const { synthesiseEvidence } = await import("./evidenceSynthesizer");
    const result = await synthesiseEvidence(makeRaw({ baseScore: 0.55 }));
    expect(result.synthesisModel).toBe("heuristic");
    expect(result.confidenceScore).toBe(0.55);
  });

  it("uses baseFlags when LLM returns non-array confidenceFlags", async () => {
    mocks.mockInvokeLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            confidenceScore: 0.7,
            confidenceFlags: "not-an-array",
            verdictRationale: "Some rationale",
          }),
        },
      }],
      model: "test-model",
    });
    const { synthesiseEvidence } = await import("./evidenceSynthesizer");
    const result = await synthesiseEvidence(makeRaw({ baseFlags: ["ORIGINAL_FLAG"] }));
    expect(result.confidenceFlags).toContain("ORIGINAL_FLAG");
  });
});
