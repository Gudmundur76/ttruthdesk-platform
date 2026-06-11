/**
 * passageExtractor.test.ts
 *
 * Unit tests for the Phase 100 passage extraction helper.
 * The LLM invokeLLM call is mocked so tests run offline and deterministically.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock invokeLLM before importing the module under test ─────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";
import { extractPassageForClaim } from "./passageExtractor";

const mockInvokeLLM = vi.mocked(invokeLLM);

// Helper to build a mock LLM response
function makeLLMResponse(passage: string | null, confidence: number) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({ passage, confidence }),
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractPassageForClaim", () => {
  const rawText =
    "Protein folding is the physical process by which a protein chain acquires its native three-dimensional structure. " +
    "Misfolded proteins are associated with a number of diseases including Alzheimer's disease and Parkinson's disease. " +
    "The hydrophobic collapse model suggests that hydrophobic residues drive the initial folding event.";

  it("returns a PassageResult when the LLM finds a high-confidence passage", async () => {
    const targetPassage =
      "Misfolded proteins are associated with a number of diseases including Alzheimer's disease and Parkinson's disease.";
    mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse(targetPassage, 0.92) as never
    );

    const result = await extractPassageForClaim(
      "Misfolded proteins cause Alzheimer's disease.",
      rawText
    );

    expect(result).not.toBeNull();
    expect(result!.sourcePassage).toBe(targetPassage);
    expect(result!.passageConfidence).toBeCloseTo(0.92);
    expect(result!.passageStartChar).toBeGreaterThanOrEqual(0);
    expect(result!.passageEndChar).toBeGreaterThan(result!.passageStartChar);
  });

  it("returns null when confidence is below the 0.4 threshold", async () => {
    mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse("Some low-confidence passage", 0.3) as never
    );

    const result = await extractPassageForClaim(
      "Some claim that barely matches.",
      rawText
    );

    expect(result).toBeNull();
  });

  it("returns null when the LLM returns passage: null", async () => {
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(null, 0) as never);

    const result = await extractPassageForClaim(
      "A claim with no matching passage.",
      rawText
    );

    expect(result).toBeNull();
  });

  it("returns null when the LLM hallucinates a passage not in the source text", async () => {
    mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse(
        "This sentence does not exist in the source text at all.",
        0.95
      ) as never
    );

    const result = await extractPassageForClaim("Some claim.", rawText);

    expect(result).toBeNull();
  });

  it("returns null when rawText is too short", async () => {
    const result = await extractPassageForClaim("Some claim.", "short");
    expect(result).toBeNull();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("returns null when rawText is empty", async () => {
    const result = await extractPassageForClaim("Some claim.", "");
    expect(result).toBeNull();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("returns null gracefully when invokeLLM throws", async () => {
    mockInvokeLLM.mockRejectedValueOnce(new Error("LLM timeout"));

    const result = await extractPassageForClaim("Some claim.", rawText);
    expect(result).toBeNull();
  });

  it("clamps passageConfidence to [0, 1]", async () => {
    const targetPassage =
      "Protein folding is the physical process by which a protein chain acquires its native three-dimensional structure.";
    mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse(targetPassage, 1.5) as never // LLM returned > 1.0
    );

    const result = await extractPassageForClaim("Protein folding.", rawText);
    expect(result).not.toBeNull();
    expect(result!.passageConfidence).toBeLessThanOrEqual(1.0);
  });

  it("correctly computes character offsets", async () => {
    const targetPassage =
      "The hydrophobic collapse model suggests that hydrophobic residues drive the initial folding event.";
    mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse(targetPassage, 0.88) as never
    );

    const result = await extractPassageForClaim(
      "Hydrophobic residues initiate folding.",
      rawText
    );

    expect(result).not.toBeNull();
    // Verify the offsets actually point to the passage in rawText
    const extracted = rawText.slice(
      result!.passageStartChar,
      result!.passageEndChar
    );
    expect(extracted).toBe(targetPassage);
  });
});
