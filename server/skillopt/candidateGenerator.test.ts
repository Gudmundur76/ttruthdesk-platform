/**
 * candidateGenerator.test.ts — Tests for SkillOpt candidate generation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateCandidates, type CandidateGenerationConfig } from "./candidateGenerator";

// ─── Mock multiLLM so LLM-generated candidates are controlled ─────────────────
vi.mock("../_core/multiLLM", () => ({
  invokeMultiLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content:
            "You are a scientific claim extractor. Extract SPECIFIC, VERIFIABLE claims. Include entity names and measurable values. Return JSON array.",
        },
      },
    ],
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baseConfig(
  overrides: Partial<CandidateGenerationConfig> = {}
): CandidateGenerationConfig {
  return {
    instructionSet: "claim_extraction",
    currentInstruction:
      "Extract scientific claims from the text. Return JSON array.",
    count: 8,
    useLlmGeneration: false,
    ...overrides,
  };
}

// ─── generateCandidates ───────────────────────────────────────────────────────

describe("generateCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns at most `count` candidates", async () => {
    const candidates = await generateCandidates(baseConfig({ count: 5 }));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(5);
  });

  it("all candidates have required fields", async () => {
    const candidates = await generateCandidates(baseConfig());
    for (const c of candidates) {
      expect(c).toHaveProperty("instruction");
      expect(c).toHaveProperty("strategy");
      expect(c).toHaveProperty("changeDescription");
      expect(typeof c.instruction).toBe("string");
      expect(c.instruction.length).toBeGreaterThan(0);
    }
  });

  it("generates local_edit candidates when no reference instructions", async () => {
    const candidates = await generateCandidates(baseConfig({ count: 4 }));
    const localEdits = candidates.filter(c => c.strategy === "local_edit");
    expect(localEdits.length).toBeGreaterThan(0);
  });

  it("generates cross_pollination candidates when reference instructions provided", async () => {
    const candidates = await generateCandidates(
      baseConfig({
        count: 8,
        referenceInstructions: [
          "Reference instruction A with different format.",
          "Reference instruction B with different constraints.",
        ],
      })
    );
    const crossPoll = candidates.filter(c => c.strategy === "cross_pollination");
    expect(crossPoll.length).toBeGreaterThan(0);
  });

  it("does not generate llm_generated candidates when useLlmGeneration=false", async () => {
    const candidates = await generateCandidates(
      baseConfig({ count: 8, useLlmGeneration: false })
    );
    const llmGen = candidates.filter(c => c.strategy === "llm_generated");
    expect(llmGen).toHaveLength(0);
  });

  it("generates llm_generated candidates when useLlmGeneration=true", async () => {
    const candidates = await generateCandidates(
      baseConfig({ count: 8, useLlmGeneration: true })
    );
    const llmGen = candidates.filter(c => c.strategy === "llm_generated");
    expect(llmGen.length).toBeGreaterThan(0);
  });

  it("works for evidence_lookup instruction set", async () => {
    const candidates = await generateCandidates(
      baseConfig({ instructionSet: "evidence_lookup", count: 4 })
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(4);
  });

  it("works for confidence_scoring instruction set", async () => {
    const candidates = await generateCandidates(
      baseConfig({ instructionSet: "confidence_scoring", count: 4 })
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(4);
  });

  it("all local_edit candidates extend the current instruction", async () => {
    const current = "Base instruction text.";
    const candidates = await generateCandidates(
      baseConfig({ currentInstruction: current, count: 6, useLlmGeneration: false })
    );
    const localEdits = candidates.filter(c => c.strategy === "local_edit");
    for (const c of localEdits) {
      expect(c.instruction).toContain(current.trimEnd());
    }
  });

  it("handles count=1 without error", async () => {
    const candidates = await generateCandidates(baseConfig({ count: 1 }));
    expect(candidates).toHaveLength(1);
  });

  it("handles LLM generation failure gracefully (non-fatal)", async () => {
    const { invokeMultiLLM } = await import("../_core/multiLLM");
    vi.mocked(invokeMultiLLM).mockRejectedValueOnce(new Error("API timeout"));
    // Should not throw — LLM failure is non-fatal
    const candidates = await generateCandidates(
      baseConfig({ count: 4, useLlmGeneration: true })
    );
    expect(Array.isArray(candidates)).toBe(true);
  });
});
