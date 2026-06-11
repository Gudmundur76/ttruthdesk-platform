/**
 * misrepresentationClassifier.test.ts
 * Phase 101: Unit tests for the misrepresentation classification helper
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyMisrepresentation,
  type MisrepresentationResult,
} from "./misrepresentationClassifier";

// ── Mock the LLM helper ──────────────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";
const mockInvokeLLM = vi.mocked(invokeLLM);

// Helper: build a mock LLM response with a given classification
function mockLLMResponse(
  misrepresentationType: string,
  classificationConfidence: number,
  reasoning: string
) {
  return {
    id: "mock-id",
    created: Date.now(),
    model: "mock-model",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant" as const,
          content: JSON.stringify({
            misrepresentationType,
            classificationConfidence,
            reasoning,
          }),
        },
      },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("classifyMisrepresentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for Supported verdicts (not contested)", async () => {
    const result = await classifyMisrepresentation(
      "Protein X increases muscle mass.",
      "Supported",
      "In a controlled trial, protein X supplementation led to significant increases in lean muscle mass."
    );
    expect(result).toBeNull();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("returns null for Insufficient Evidence verdicts", async () => {
    const result = await classifyMisrepresentation(
      "Protein X cures cancer.",
      "Insufficient Evidence",
      "No relevant studies were found."
    );
    expect(result).toBeNull();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("returns null when source passage is null (no passage available)", async () => {
    const result = await classifyMisrepresentation(
      "Protein X doubles lifespan.",
      "Contradicted",
      null
    );
    expect(result).toBeNull();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("returns null when source passage is too short (< 30 chars)", async () => {
    const result = await classifyMisrepresentation(
      "Protein X is beneficial.",
      "Contradicted",
      "Short text."
    );
    expect(result).toBeNull();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("classifies amplification for Contradicted verdict", async () => {
    mockInvokeLLM.mockResolvedValueOnce(
      mockLLMResponse(
        "amplification",
        0.92,
        "Claim overstates the effect size from 'modest' to 'dramatic'."
      )
    );

    const result = await classifyMisrepresentation(
      "Protein X dramatically increases muscle mass in all adults.",
      "Contradicted",
      "In a 12-week RCT of 45 elderly men, protein X supplementation showed a modest but statistically significant increase in lean mass compared to placebo."
    );

    expect(result).not.toBeNull();
    expect(result!.misrepresentationType).toBe("amplification");
    expect(result!.classificationConfidence).toBeCloseTo(0.92);
    expect(result!.reasoning).toContain("overstates");
  });

  it("classifies selective_omission for Partially Supported verdict", async () => {
    mockInvokeLLM.mockResolvedValueOnce(
      mockLLMResponse(
        "selective_omission",
        0.85,
        "Claim omits the 'in mice only' qualification from the source."
      )
    );

    const result = await classifyMisrepresentation(
      "Compound Y reverses age-related cognitive decline.",
      "Partially Supported",
      "In aged mice, compound Y administration for 8 weeks reversed several markers of age-related cognitive decline. Human trials are pending."
    );

    expect(result!.misrepresentationType).toBe("selective_omission");
    expect(result!.classificationConfidence).toBeGreaterThan(0.8);
  });

  it("classifies causal_overclaim for Contradicted verdict", async () => {
    mockInvokeLLM.mockResolvedValueOnce(
      mockLLMResponse(
        "causal_overclaim",
        0.88,
        "Source shows correlation only; claim asserts causation."
      )
    );

    const result = await classifyMisrepresentation(
      "High protein intake causes lower cardiovascular disease risk.",
      "Contradicted",
      "Observational data from 10,000 participants showed an association between higher protein intake and lower rates of cardiovascular events (HR 0.78, 95% CI 0.65–0.93)."
    );

    expect(result!.misrepresentationType).toBe("causal_overclaim");
  });

  it("clamps confidence values outside [0, 1] to the valid range", async () => {
    mockInvokeLLM.mockResolvedValueOnce(
      mockLLMResponse(
        "scope_drift",
        1.5,
        "Confidence above 1.0 should be clamped."
      )
    );

    const result = await classifyMisrepresentation(
      "Protein Z improves cognition in all populations.",
      "Contradicted",
      "In a study of 200 college-aged athletes, protein Z supplementation was associated with improved working memory scores after 4 weeks of training."
    );

    expect(result!.classificationConfidence).toBeLessThanOrEqual(1.0);
    expect(result!.misrepresentationType).toBe("scope_drift");
  });

  it("returns null and does not throw when LLM call fails", async () => {
    mockInvokeLLM.mockRejectedValueOnce(new Error("LLM timeout"));

    const result = await classifyMisrepresentation(
      "Protein X prevents all disease.",
      "Contradicted",
      "In a small pilot study, protein X supplementation was associated with reduced inflammation markers in 20 participants over 6 weeks."
    );

    expect(result).toBeNull();
  });

  it("returns null for an unrecognised misrepresentationType from LLM", async () => {
    mockInvokeLLM.mockResolvedValueOnce(
      mockLLMResponse(
        "hallucination_type_xyz",
        0.7,
        "Unknown category returned by LLM."
      )
    );

    const result = await classifyMisrepresentation(
      "Protein X has zero side effects.",
      "Contradicted",
      "The study noted several adverse events including nausea and headache in the treatment group, though these were mild and transient."
    );

    expect(result).toBeNull();
  });
});
