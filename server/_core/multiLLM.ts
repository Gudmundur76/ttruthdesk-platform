/**
 * multiLLM.ts — Unified LLM router for the two-pass corpus strategy.
 *
 * Routes LLM calls to one of five providers based on ENV.llmProvider:
 *   - "manus_builtin"  → invokeLLM() from ./llm (default, Manus-managed)
 *   - "openrouter"     → OpenRouter free models with key rotation + openrouter/free meta-router
 *   - "freellmapi"     → Self-hosted Ollama/Gemma 4 (or any OpenAI-compatible server)
 *   - "kimi"           → Moonshot AI Kimi K2 direct API (premium quality pass)
 *   - "ornith_slm"     → Self-hosted Ornith-1.0-9B via slm-infra-deploy cortex.py (OpenAI-compatible)
 *
 * OpenRouter free model pool (June 2026):
 *   Tier "quality":  moonshotai/kimi-k2.6:free  (262k ctx, best scientific reasoning)
 *   Tier "draft":    openrouter/free             (meta-router — auto-picks best free model)
 *   Tier "fallback": google/gemma-4-31b-it:free  (262k ctx, structured outputs)
 *
 * Extended free model rotation (tried in order when primary is rate-limited):
 *   - openrouter/free                           (meta-router, always available)
 *   - baidu/ernie-4.5-21b-a3b:free             (131k ctx, strong structured output)
 *   - z-ai/glm-4.5-air:free                    (131k ctx, MoE, thinking mode)
 *   - nvidia/nemotron-3-super-120b-a12b:free   (1M ctx, 120B MoE, agentic)
 *   - openai/gpt-oss-20b:free                  (131k ctx, OpenAI open-weight)
 *   - meta-llama/llama-3.3-70b-instruct:free   (131k ctx, reliable extraction)
 *   - google/gemma-4-31b-it:free               (262k ctx, structured output)
 *   - moonshotai/kimi-k2.6:free                (262k ctx, scientific reasoning)
 *
 * Key rotation: set OPENROUTER_API_KEYS=key1,key2,key3 for round-robin across
 * multiple free-tier keys to multiply throughput.
 *
 * Self-hosted Gemma 4 / Ollama: set LLM_PROVIDER=freellmapi and
 *   FREELM_API_URL=http://localhost:11434/v1 (Ollama default)
 *   FREELM_MODEL=gemma4:27b-it-q4_K_M (or any Ollama model)
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

export interface LLMResponse {
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

// ─── Key rotation pool ────────────────────────────────────────────────────────

/**
 * Parses OPENROUTER_API_KEYS (comma-separated) into a rotation pool.
 * Falls back to OPENROUTER_API_KEY (single key) for backward compatibility.
 */
function buildKeyPool(): string[] {
  const multi = process.env.OPENROUTER_API_KEYS ?? "";
  if (multi.trim()) {
    return multi
      .split(",")
      .map(k => k.trim())
      .filter(Boolean);
  }
  const single = ENV.openRouterApiKey;
  return single ? [single] : [];
}

let _keyPoolIndex = 0;
const _keyPool: string[] = buildKeyPool();

/**
 * Returns the next API key from the rotation pool (round-robin).
 * Throws if the pool is empty.
 */
export function getNextOpenRouterKey(): string {
  if (_keyPool.length === 0) {
    throw new Error(
      "[multiLLM] No OpenRouter API keys configured. Set OPENROUTER_API_KEY or OPENROUTER_API_KEYS."
    );
  }
  const key = _keyPool[_keyPoolIndex % _keyPool.length];
  _keyPoolIndex++;
  return key;
}

/**
 * Returns the current key pool size (for health checks).
 */
export function getKeyPoolSize(): number {
  return _keyPool.length;
}

// ─── Free model rotation list ─────────────────────────────────────────────────

/**
 * Full ordered list of free OpenRouter models to try on rate-limit.
 * openrouter/free is always first — it's the meta-router that picks
 * the best available free model automatically.
 */
export const FREE_MODEL_ROTATION: string[] = [
  "openrouter/free", // meta-router (always available)
  "baidu/ernie-4.5-21b-a3b:free", // Baidu ERNIE 4.5 — strong structured output
  "z-ai/glm-4.5-air:free", // GLM 4.5 Air — MoE, thinking mode
  "nvidia/nemotron-3-super-120b-a12b:free", // NVIDIA 120B MoE — 1M context
  "openai/gpt-oss-20b:free", // OpenAI open-weight — Apache 2.0
  "meta-llama/llama-3.3-70b-instruct:free", // Llama 3.3 70B — reliable extraction
  "google/gemma-4-31b-it:free", // Gemma 4 31B — 262k ctx
  "moonshotai/kimi-k2.6:free", // Kimi K2.6 — scientific reasoning
];

/**
 * Returns the best free OpenRouter model for the given task tier.
 * "quality"  → Kimi K2.6 (best scientific reasoning)
 * "draft"    → openrouter/free meta-router (auto-picks best available)
 * "fallback" → Gemma 4 31B (structured outputs)
 */
export function getOpenRouterModel(
  tier: "quality" | "draft" | "fallback" = "draft"
): string {
  switch (tier) {
    case "quality":
      return "moonshotai/kimi-k2.6:free";
    case "fallback":
      return "google/gemma-4-31b-it:free";
    case "draft":
    default:
      return "openrouter/free"; // meta-router
  }
}

/**
 * Builds the full model priority list for a given tier.
 * Primary model first, then the full rotation list (deduplicated).
 */
export function buildModelPriorityList(
  tier: "quality" | "draft" | "fallback"
): string[] {
  const primary = getOpenRouterModel(tier);
  return [primary, ...FREE_MODEL_ROTATION].filter(
    (m, i, arr) => arr.indexOf(m) === i
  );
}

// ─── Provider name helper ─────────────────────────────────────────────────────

export function getActiveLLMProvider(): string {
  return ENV.llmProvider;
}

// ─── OpenAI-compatible HTTP caller ───────────────────────────────────────────

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

// ─── Unified invoke ───────────────────────────────────────────────────────────

/**
 * Drop-in replacement for invokeLLM() that routes to the configured provider.
 * Returns the same shape as invokeLLM() with an additional `_provider` field.
 *
 * OpenRouter path uses key rotation + full model fallback list so that
 * rate limits on any single model/key are transparently bypassed.
 */
// eslint-disable-next-line complexity -- provider routing requires branching per provider
export async function invokeMultiLLM(
  options: LLMOptions,
  openRouterTier: "quality" | "draft" | "fallback" = "draft",
  providerOverride?: string
): Promise<LLMResponse> {
  // providerOverride allows callers to specify a provider without mutating global ENV
  const provider = providerOverride ?? ENV.llmProvider;

  // ── OpenRouter (free model swarm with key rotation) ───────────────────────
  if (provider === "openrouter") {
    const keyPool = _keyPool;
    if (keyPool.length === 0) {
      throw new Error(
        "[multiLLM] OPENROUTER_API_KEY is required for openrouter provider"
      );
    }

    const modelList = buildModelPriorityList(openRouterTier);
    let lastError: Error | null = null;

    // Try each model in the priority list; on 429, rotate to next model AND next key
    for (let i = 0; i < modelList.length; i++) {
      const model = modelList[i];
      // Rotate key per model attempt for maximum throughput
      const apiKey = keyPool[(_keyPoolIndex + i) % keyPool.length];
      try {
        console.log(
          `[multiLLM] OpenRouter → ${model} (key ${((_keyPoolIndex + i) % keyPool.length) + 1}/${keyPool.length})`
        );
        const result = await callOpenAICompatible(
          "https://openrouter.ai/api/v1",
          apiKey,
          model,
          options
        );
        result._provider = `openrouter:${model}`;
        // Advance key index on success so next call uses a different key
        _keyPoolIndex = (_keyPoolIndex + i + 1) % keyPool.length;
        return result;
      } catch (err) {
        const msg = String(err);
        if (
          msg.includes("429") ||
          msg.includes("rate-limited") ||
          msg.includes("temporarily") ||
          msg.includes("overloaded")
        ) {
          console.warn(
            `[multiLLM] OpenRouter ${model} rate-limited, trying next model...`
          );
          lastError = err instanceof Error ? err : new Error(msg);
          await new Promise(r => setTimeout(r, 500)); // brief pause before retry
          continue;
        }
        throw err; // Non-rate-limit errors bubble up immediately
      }
    }
    throw (
      lastError ?? new Error("[multiLLM] All OpenRouter models rate-limited")
    );
  }

  // ── Self-hosted Ollama / Gemma 4 / FreeLLMAPI ────────────────────────────
  if (provider === "freellmapi") {
    const model = process.env.FREELM_MODEL ?? "auto";
    if (!ENV.freeLLMApiKey && model === "auto") {
      console.warn(
        "[multiLLM] FREELM_API_KEY not set, using empty key for FreeLLMAPI/Ollama"
      );
    }
    const result = await callOpenAICompatible(
      ENV.freeLLMApiUrl,
      ENV.freeLLMApiKey || "freellmapi-no-key",
      model,
      options
    );
    result._provider = `freellmapi:${model}`;
    return result;
  }

  // ── Kimi direct API (premium quality pass) ───────────────────────────────
  if (provider === "kimi") {
    if (!ENV.kimiApiKey) {
      throw new Error("[multiLLM] KIMI_API_KEY is required for kimi provider");
    }
    const result = await callOpenAICompatible(
      "https://api.moonshot.cn/v1",
      ENV.kimiApiKey,
      "moonshot-v1-128k",
      options
    );
    result._provider = "kimi";
    return result;
  }

  // ── Ornith-1.0 SLM (self-hosted via slm-infra-deploy cortex.py) ────────────
  // Set LLM_PROVIDER=ornith_slm and ORNITH_SLM_URL=http://<slm-host>:8080
  // to route all LLM calls through the locally hosted Ornith-1.0-9B model.
  // cortex.py exposes an OpenAI-compatible /v1/chat/completions endpoint.
  if (provider === "ornith_slm") {
    const ornithUrl = process.env["ORNITH_SLM_URL"] ?? "http://localhost:8080";
    const ornithModel = process.env["ORNITH_SLM_MODEL"] ?? "ornith-1.0-9b";
    const result = await callOpenAICompatible(
      ornithUrl,
      process.env["ORNITH_SLM_API_KEY"] ?? "ornith-local",
      ornithModel,
      options
    );
    result._provider = `ornith_slm:${ornithModel}`;
    // Extract Ornith <think> reasoning trace if present and strip from visible content
    const rawContent = result.choices?.[0]?.message?.content ?? "";
    const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      (result as LLMResponse & { _ornithReasoning?: string })._ornithReasoning =
        thinkMatch[1].trim();
      result.choices[0].message.content = rawContent
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .trim();
    }
    return result;
  }

  // ── Default: manus_builtin ────────────────────────────────────────────────
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

/**
 * Returns a health summary of the current LLM configuration.
 * Used by GET /api/admin/llm-health.
 */
export function getLLMHealthSummary(): {
  provider: string;
  keyPoolSize: number;
  freeModelCount: number;
  primaryModel: string;
  modelRotation: string[];
  selfHostedUrl: string | null;
} {
  const provider = ENV.llmProvider;
  return {
    provider,
    keyPoolSize: _keyPool.length,
    freeModelCount: FREE_MODEL_ROTATION.length,
    primaryModel:
      provider === "openrouter" ? getOpenRouterModel("draft") : provider,
    modelRotation: provider === "openrouter" ? FREE_MODEL_ROTATION : [],
    selfHostedUrl:
      provider === "freellmapi"
        ? ENV.freeLLMApiUrl
        : provider === "ornith_slm"
          ? (process.env["ORNITH_SLM_URL"] ?? "http://localhost:8080")
          : null,
  };
}
