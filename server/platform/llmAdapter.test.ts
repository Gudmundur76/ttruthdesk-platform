/**
 * llmAdapter.test.ts
 * Unit tests for server/platform/llmAdapter.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockInvokeLLM: vi.fn(),
}));

vi.mock("../_core/llm", () => ({ invokeLLM: mocks.mockInvokeLLM }));
vi.mock("../logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("llmAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("getLLMAdapter returns an adapter instance", async () => {
    const { getLLMAdapter } = await import("./llmAdapter");
    const adapter = getLLMAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.complete).toBe("function");
  });

  it("setLLMAdapter replaces the singleton", async () => {
    const { getLLMAdapter, setLLMAdapter } = await import("./llmAdapter");
    const mockAdapter = {
      complete: vi.fn().mockResolvedValue({
        content: "mocked response",
        model: "test-model",
        promptTokens: 10,
        completionTokens: 5,
      }),
      defaultModel: vi.fn().mockReturnValue("test-model"),
      isAvailable: vi.fn().mockReturnValue(true),
    };
    setLLMAdapter(mockAdapter as never);
    const adapter = getLLMAdapter();
    const result = await adapter.complete({ messages: [{ role: "user", content: "hello" }] });
    expect(result.content).toBe("mocked response");
  });

  it("complete calls invokeLLM and returns structured result", async () => {
    mocks.mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "The answer is 42." } }],
      model: "claude-3-5-haiku",
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    });

    const { getLLMAdapter } = await import("./llmAdapter");
    const adapter = getLLMAdapter();
    const result = await adapter.complete({
      messages: [{ role: "user", content: "What is the answer?" }],
    });

    expect(mocks.mockInvokeLLM).toHaveBeenCalledOnce();
    expect(result.content).toBe("The answer is 42.");
    expect(result.model).toBe("claude-3-5-haiku");
    expect(result.promptTokens).toBe(20);
    expect(result.completionTokens).toBe(8);
  });

  it("complete passes responseFormat when provided", async () => {
    mocks.mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: '{"name":"Alice"}' } }],
      model: "gpt-4o",
      usage: { prompt_tokens: 15, completion_tokens: 6 },
    });

    const { getLLMAdapter } = await import("./llmAdapter");
    const adapter = getLLMAdapter();
    await adapter.complete({
      messages: [{ role: "user", content: "Extract name" }],
      responseFormat: { type: "json_schema", json_schema: { name: "test", strict: true, schema: { type: "object", properties: {}, required: [], additionalProperties: false } } },
    });

    expect(mocks.mockInvokeLLM).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: expect.objectContaining({ type: "json_schema" }) })
    );
  });

  it("complete handles non-string content gracefully", async () => {
    mocks.mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: [{ type: "text", text: "multi-part" }] } }],
      model: "claude-3-5-haiku",
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    });

    const { getLLMAdapter } = await import("./llmAdapter");
    const adapter = getLLMAdapter();
    const result = await adapter.complete({
      messages: [{ role: "user", content: "hello" }],
    });

    // Non-string content is JSON.stringified
    expect(typeof result.content).toBe("string");
  });
});
