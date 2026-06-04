/**
 * llmLargeContext.ts
 *
 * Large-context LLM helper using the Kimi (Moonshot AI) API.
 * Provides up to 1 million token context — ideal for:
 *   - Full-codebase-aware quality scoring
 *   - Semantic similarity across large corpora
 *   - Multi-document evidence synthesis
 *   - Structured JSON extraction from long documents
 *
 * The API is OpenAI-compatible. Set KIMI_API_KEY in env to activate.
 * Falls back to the built-in Manus LLM when the key is absent.
 *
 * Model defaults (kimi.com plan):
 *   kimi-for-coding   — 262K ctx, Kimi K2.6, reasoning support, image/video in
 *
 * Model defaults (platform.moonshot.ai plan — set KIMI_BASE_URL=https://api.moonshot.ai/v1):
 *   kimi-k2.6         — 1M ctx, thinking support, best quality
 *   moonshot-v1-128k  — 128K ctx, faster, lower cost
 *   moonshot-v1-32k   — 32K ctx, fastest
 */

import { ENV } from "./env.js";
import { invokeLLM } from "./llm.js";

export type LargeContextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LargeContextOptions = {
  /** Override the default model (kimi-k2.6) */
  model?: string;
  /** Max tokens to generate. Default: 4096 */
  maxTokens?: number;
  /** Enable deep thinking mode (kimi-k2.6 only). Default: false */
  thinking?: boolean;
  /** Response format for structured JSON output */
  responseFormat?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
};

export type LargeContextResponse = {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** True if the Kimi API was used; false if fell back to built-in LLM */
  usedKimi: boolean;
};

/**
 * Invoke the large-context LLM.
 * Uses Kimi API when KIMI_API_KEY is set; falls back to built-in LLM otherwise.
 */
export async function invokeLargeContextLLM(
  messages: LargeContextMessage[],
  options: LargeContextOptions = {}
): Promise<LargeContextResponse> {
  const { model, maxTokens = 4096, thinking = false, responseFormat } = options;

  // Fall back to built-in LLM when no Kimi key is configured
  if (!ENV.kimiApiKey) {
    const fallback = await invokeLLM({ messages });
    const content =
      typeof fallback.choices?.[0]?.message?.content === "string"
        ? fallback.choices[0].message.content
        : "";
    return {
      content,
      model: "manus_builtin_fallback",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      usedKimi: false,
    };
  }

  const selectedModel = model ?? ENV.kimiModel;

  const body: Record<string, unknown> = {
    model: selectedModel,
    messages,
    max_tokens: maxTokens,
  };

  // Thinking mode: supported on kimi-k2.6 (moonshot platform) and kimi-for-coding (kimi.com plan)
  if (thinking && (selectedModel === "kimi-k2.6" || selectedModel === "kimi-for-coding")) {
    body.thinking = { type: "enabled" };
  }

  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const response = await fetch(`${ENV.kimiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ENV.kimiApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Kimi API error ${response.status}: ${errorText}`
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };

  const content = data.choices?.[0]?.message?.content ?? "";

  return {
    content,
    model: data.model ?? selectedModel,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
    usedKimi: true,
  };
}

/**
 * Invoke the large-context LLM and parse the response as JSON.
 * Throws if the response is not valid JSON.
 */
export async function invokeLargeContextLLMJson<T = unknown>(
  messages: LargeContextMessage[],
  schema: {
    name: string;
    strict: boolean;
    schema: Record<string, unknown>;
  },
  options: Omit<LargeContextOptions, "responseFormat"> = {}
): Promise<{ data: T; meta: Omit<LargeContextResponse, "content"> }> {
  const result = await invokeLargeContextLLM(messages, {
    ...options,
    responseFormat: { type: "json_schema", json_schema: schema },
  });

  let data: T;
  try {
    data = JSON.parse(result.content) as T;
  } catch {
    throw new Error(
      `Kimi API returned non-JSON content: ${result.content.slice(0, 200)}`
    );
  }

  return {
    data,
    meta: {
      model: result.model,
      usage: result.usage,
      usedKimi: result.usedKimi,
    },
  };
}

/**
 * Lightweight connectivity check — calls /v1/models to verify the API key works.
 * Returns true on success, throws on auth failure.
 */
export async function checkKimiConnectivity(): Promise<{
  ok: boolean;
  models: string[];
}> {
  if (!ENV.kimiApiKey) {
    return { ok: false, models: [] };
  }

  const response = await fetch(`${ENV.kimiBaseUrl}/models`, {
    headers: { Authorization: `Bearer ${ENV.kimiApiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Kimi connectivity check failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    data: Array<{ id: string }>;
  };
  const models = (data.data ?? []).map((m) => m.id);

  return { ok: true, models };
}
