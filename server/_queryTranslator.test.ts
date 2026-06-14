/**
 * _queryTranslator.test.ts
 * Unit tests for server/_queryTranslator.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockInvokeMultiLLM: vi.fn(),
}));

vi.mock("./_core/multiLLM", () => ({ invokeMultiLLM: mocks.mockInvokeMultiLLM }));

const makeLLMResponse = (claims: Array<{ claimText: string; searchQuery: string; proteinName: string | null; organism: string | null }>) => ({
  choices: [
    {
      message: {
        content: JSON.stringify({ claims }),
      },
    },
  ],
});

describe("translateQueryToClaims()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns empty array when LLM throws", async () => {
    mocks.mockInvokeMultiLLM.mockRejectedValue(new Error("LLM timeout"));
    const { translateQueryToClaims } = await import("./_queryTranslator");
    const result = await translateQueryToClaims("What is collagen?");
    expect(result).toEqual([]);
  });

  it("returns empty array when LLM returns no content", async () => {
    mocks.mockInvokeMultiLLM.mockResolvedValue({ choices: [{ message: { content: null } }] });
    const { translateQueryToClaims } = await import("./_queryTranslator");
    const result = await translateQueryToClaims("What is collagen?");
    expect(result).toEqual([]);
  });

  it("returns empty array when LLM returns empty claims array", async () => {
    mocks.mockInvokeMultiLLM.mockResolvedValue(makeLLMResponse([]));
    const { translateQueryToClaims } = await import("./_queryTranslator");
    const result = await translateQueryToClaims("What is collagen?");
    expect(result).toEqual([]);
  });

  it("returns parsed claims when LLM returns valid response", async () => {
    const claims = [
      { claimText: "Salmon collagen has antimicrobial properties", searchQuery: "salmon collagen antimicrobial", proteinName: "collagen type I", organism: "Salmo salar" },
      { claimText: "Collagen type I promotes wound healing", searchQuery: "collagen wound healing", proteinName: "collagen type I", organism: null },
    ];
    mocks.mockInvokeMultiLLM.mockResolvedValue(makeLLMResponse(claims));
    const { translateQueryToClaims } = await import("./_queryTranslator");
    const result = await translateQueryToClaims("What are the properties of salmon collagen?");
    expect(result).toHaveLength(2);
    expect(result[0].claimText).toBe("Salmon collagen has antimicrobial properties");
    expect(result[0].organism).toBe("Salmo salar");
  });

  it("caps results at 5 claims even when LLM returns more", async () => {
    const claims = Array.from({ length: 8 }, (_, i) => ({
      claimText: `Claim ${i + 1}`,
      searchQuery: `query ${i + 1}`,
      proteinName: null,
      organism: null,
    }));
    mocks.mockInvokeMultiLLM.mockResolvedValue(makeLLMResponse(claims));
    const { translateQueryToClaims } = await import("./_queryTranslator");
    const result = await translateQueryToClaims("Test question");
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("returns empty array when LLM returns invalid JSON", async () => {
    mocks.mockInvokeMultiLLM.mockResolvedValue({
      choices: [{ message: { content: "not valid json {{{" } }],
    });
    const { translateQueryToClaims } = await import("./_queryTranslator");
    const result = await translateQueryToClaims("Test question");
    expect(result).toEqual([]);
  });

  it("truncates question to 500 chars before sending to LLM", async () => {
    mocks.mockInvokeMultiLLM.mockResolvedValue(makeLLMResponse([]));
    const { translateQueryToClaims } = await import("./_queryTranslator");
    const longQuestion = "A".repeat(1000);
    await translateQueryToClaims(longQuestion);
    const callArgs = mocks.mockInvokeMultiLLM.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("A".repeat(500));
    expect(userMessage.content).not.toContain("A".repeat(501));
  });
});
