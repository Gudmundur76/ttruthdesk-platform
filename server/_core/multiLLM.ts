/**
 * multiLLM.ts — Unified LLM router for the two-pass corpus strategy.
 *
 * Routes LLM calls to one of four providers based on ENV.llmProvider:
 *   - "manus_builtin"  → invokeLLM() from ./llm (default, Manus-managed)
 *   - "openrouter"     → OpenRouter free models (Kimi K2.6 / Llama 3.3 70B)
 *   - "freellmapi"     → FreeLLMAPI self-hosted proxy (free tier aggregator)
 *   - "kimi"           → Moonshot AI Kimi K2 direct API (premium quality pass)
 *
 * OpenRouter model selection:
 *   - Quality pass (qualityPassJob): moonshotai/kimi-k2.6:free  (262k ctx, tool calling)
 *   - Bulk seed / draft pass:        meta-llama/llama-3.3-70b-instruct:free (131k ctx)
 *   - Fallback:                      google/gemma-4-31b-it:free (262k ctx, structured output)
 *
 * All providers share the same Message/response interface so callers
 * never need to know which backend is active.
 */

import { ENV } from "./env";
import { invokeLLM } from "./llm";

// ─── Types (mirror invokeLLM signature) ──────────────────────────────────────

type Role = "system" | "user" | "assistant" | "tool" | "function";

interface TextContent {
  type: "text";
  text: string;
}

export interface LLMMessage {
  role: Role;
  content: string | TextContent[];
}

interface LLMOptions {
  messages: LLMMessage[];
  response_format?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  temperature?: number;
  max_tokens?: number;
}

interface LLMResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  // Non-standard: which provider actually handled this request
  _provider?: string;
}

// ─── FreeLLMAPI / Kimi direct caller ─────────────────────────────────────────

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  options: LLMOptions
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
  };
  if (options.response_format) body.response_format = options.response_format;
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000), // 2 min timeout
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`LLM API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  return resp.json() as Promise<LLMResponse>;
}

// ─── OpenRouter model selector ──────────────────────────────────────────────

/**
 * Returns the best free OpenRouter model for the given task tier.
 *   "quality"  → Kimi K2.6 (262k ctx, best scientific reasoning)
 *   "draft"    → Llama 3.3 70B (131k ctx, fast, reliable extraction)
 *   "fallback" → Gemma 4 31B (262k ctx, structured outputs)
 */
export function getOpenRouterModel(tier: "quality" | "draft" | "fallback" = "draft"): string {
  switch (tier) {
    case "quality":  return "moonshotai/kimi-k2.6:free";
    case "fallback": return "google/gemma-4-31b-it:free";
    case "draft":
    default:         return "meta-llama/llama-3.3-70b-instruct:free";
  }
}

// ─── Provider name helper ─────────────────────────────────────────────────────

export function getActiveLLMProvider(): string {
  return ENV.llmProvider;
}

// ─── Unified invoke ───────────────────────────────────────────────────────────

/**
 * Drop-in replacement for invokeLLM() that routes to the configured provider.
 * Returns the same shape as invokeLLM() with an additional `_provider` field.
 */
export async function invokeMultiLLM(options: LLMOptions, openRouterTier: "quality" | "draft" | "fallback" = "draft"): Promise<LLMResponse> {
  const provider = ENV.llmProvider;

  if (provider === "openrouter") {
    if (!ENV.openRouterApiKey) {
      throw new Error("[multiLLM] OPENROUTER_API_KEY is required for openrouter provider");
    }
    // Model priority list: preferred first, fallbacks on 429
    const modelPriority: string[] = [
      getOpenRouterModel(openRouterTier),
      // Ensure fallback models are distinct from the primary
      ...(openRouterTier === "quality"
        ? ["google/gemma-4-31b-it:free", "meta-llama/llama-3.3-70b-instruct:free"]
        : openRouterTier === "draft"
        ? ["google/gemma-4-31b-it:free", "moonshotai/kimi-k2.6:free"]
        : ["meta-llama/llama-3.3-70b-instruct:free", "moonshotai/kimi-k2.6:free"]),
    ].filter((m, i, arr) => arr.indexOf(m) === i); // deduplicate

    let lastError: Error | null = null;
    for (const model of modelPriority) {
      try {
        console.log(`[multiLLM] OpenRouter → ${model}`);
        const result = await callOpenAICompatible(
          "https://openrouter.ai/api/v1",
          ENV.openRouterApiKey,
          model,
          options
        );
        result._provider = `openrouter:${model}`;
        return result;
      } catch (err) {
        const msg = String(err);
        // Retry on rate limit or provider errors with next model
        if (msg.includes("429") || msg.includes("rate-limited") || msg.includes("temporarily")) {
          console.warn(`[multiLLM] OpenRouter ${model} rate-limited, trying next model...`);
          lastError = err instanceof Error ? err : new Error(msg);
          await new Promise(r => setTimeout(r, 1000)); // brief pause before retry
          continue;
        }
        throw err; // Non-rate-limit errors bubble up immediately
      }
    }
    throw lastError ?? new Error("[multiLLM] All OpenRouter models rate-limited");
  }

  if (provider === "freellmapi") {
    if (!ENV.freeLLMApiKey) {
      // FreeLLMAPI running locally may not require a key — fall back gracefully
      console.warn("[multiLLM] FREELM_API_KEY not set, using empty key for FreeLLMAPI");
    }
    const result = await callOpenAICompatible(
      ENV.freeLLMApiUrl,
      ENV.freeLLMApiKey || "freellmapi-no-key",
      "auto", // FreeLLMAPI router picks best available model
      options
    );
    result._provider = "freellmapi";
    return result;
  }

  if (provider === "kimi") {
    if (!ENV.kimiApiKey) {
      throw new Error("[multiLLM] KIMI_API_KEY is required for kimi provider");
    }
    const result = await callOpenAICompatible(
      "https://api.moonshot.cn/v1",
      ENV.kimiApiKey,
      "moonshot-v1-128k", // Kimi K2 128K context model
      options
    );
    result._provider = "kimi";
    return result;
  }

  // Default: manus_builtin
  // invokeLLM returns the raw API response — same shape
  const result = await invokeLLM(options as Parameters<typeof invokeLLM>[0]);
  (result as LLMResponse)._provider = "manus_builtin";
  return result as unknown as LLMResponse;
}

/**
 * Extract text content from an LLM response choice.
 * Works across all providers.
 */
export function extractLLMText(response: LLMResponse): string {
  return response.choices?.[0]?.message?.content ?? "";
}
