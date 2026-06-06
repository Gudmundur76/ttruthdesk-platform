/**
 * server/platform/llmAdapter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * LLM adapter — implements ILLMAdapter.
 *
 * Wraps invokeLLM() from server/_core/llm.ts and normalises the response into
 * the platform-agnostic LLMResult shape. Swap this adapter to use a different
 * LLM provider without touching business logic.
 */
import { invokeLLM } from "../_core/llm";
import type { ILLMAdapter, LLMOptions, LLMResult } from "./types";

const DEFAULT_MODEL = "openai/gpt-4o-mini";

class ManusLLMAdapter implements ILLMAdapter {
  isAvailable(): boolean {
    return !!(process.env.BUILT_IN_FORGE_API_KEY && process.env.BUILT_IN_FORGE_API_URL);
  }

  defaultModel(): string {
    return DEFAULT_MODEL;
  }

  async complete(options: LLMOptions): Promise<LLMResult> {
    const invokeOptions: Parameters<typeof invokeLLM>[0] = {
      messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (options.responseFormat) {
      invokeOptions.response_format = options.responseFormat as Parameters<typeof invokeLLM>[0]["response_format"];
    }
    const response = await invokeLLM(invokeOptions);
    const choice = response.choices?.[0];
    const content =
      typeof choice?.message?.content === "string"
        ? choice.message.content
        : JSON.stringify(choice?.message?.content ?? "");
    return {
      content,
      model: (response.model as string) ?? DEFAULT_MODEL,
      promptTokens: (response.usage?.prompt_tokens as number) ?? 0,
      completionTokens: (response.usage?.completion_tokens as number) ?? 0,
    };
  }
}

let _adapter: ManusLLMAdapter | null = null;

export function getLLMAdapter(): ILLMAdapter {
  if (!_adapter) _adapter = new ManusLLMAdapter();
  return _adapter;
}

export function setLLMAdapter(adapter: ILLMAdapter): void {
  _adapter = adapter as ManusLLMAdapter;
}
