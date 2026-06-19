/**
 * claimVerifier.ts — Local Model Claim Verifier (Ollama backend)
 *
 * Wraps the locally-running Ollama model (claim-verifier) to provide
 * claim verification without calling the Claude API.
 *
 * MANUS_INSTRUCTIONS §3.2 — wire LocalClaimVerifier to Ollama endpoint.
 *
 * Architecture:
 *   - Ollama serves the claim-verifier model at http://localhost:11434
 *   - This class sends POST /api/generate requests to Ollama
 *   - Falls back gracefully if Ollama is not running (non-fatal)
 *   - modelRouter.ts decides when to use this vs. the orchestrated pipeline
 *
 * Performance targets:
 *   - Latency p99: < 500ms
 *   - Cost per call: $0.0001 (compute only, no API fees)
 *   - Throughput: ~120 calls/minute
 */

import { logger } from "../logger";

const log = logger("inference/claimVerifier");

// ─── Types ─────────────────────────────────────────────────────────────────────

export type LocalVerdict =
  | "Supported"
  | "Contradicted"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Out of Scope"
  | "Needs Expert Review";

export interface LocalVerificationResult {
  verdict: LocalVerdict;
  confidence: number;
  rationale: string;
  latencyMs: number;
  /** Which model produced this result */
  modelId: string;
  /** Whether this result came from the local model or a fallback */
  source: "local_model" | "fallback";
}

export interface LocalVerifierCapabilities {
  /** Domains the local model has been trained on */
  domains: string[];
  /** Whether the model server is currently reachable */
  available: boolean;
  /** Model file identifier */
  modelId: string;
  /** Approximate model size in MB */
  modelSizeMb: number;
}

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Standard Ollama port — configurable via env for docker-compose */
const OLLAMA_BASE_URL =
  process.env.OLLAMA_URL ?? "http://localhost:11434";
const DEFAULT_MODEL_NAME =
  process.env.LOCAL_MODEL_ID ?? "claim-verifier";
const REQUEST_TIMEOUT_MS = 3000; // 3s — if Ollama is slow, fall back

/** Domains the local model covers (trained on calibration corpus) */
const SUPPORTED_DOMAINS = [
  "structural_biology",
  "clinical_medicine",
  "general",
];

// ─── Prompt Template ──────────────────────────────────────────────────────────

function buildVerificationPrompt(claimText: string, domain?: string): string {
  const domainHint = domain ? `Domain: ${domain}\n` : "";
  return (
    `${domainHint}Claim: ${claimText}\n\n` +
    `Verify the claim. Return a JSON object with verdict, confidence, reasoning, and sources.`
  );
}

// ─── LocalClaimVerifier ────────────────────────────────────────────────────────

export class LocalClaimVerifier {
  private readonly ollamaUrl: string;
  private readonly modelId: string;

  constructor(ollamaUrl?: string, modelId?: string) {
    this.ollamaUrl = ollamaUrl ?? OLLAMA_BASE_URL;
    this.modelId = modelId ?? DEFAULT_MODEL_NAME;
  }

  /**
   * Verify a claim using the local Ollama model.
   * Returns a fallback result on any error (non-fatal).
   */
  async verify(
    claimText: string,
    domain?: string
  ): Promise<LocalVerificationResult> {
    const startMs = Date.now();

    try {
      const prompt = buildVerificationPrompt(claimText, domain);
      const raw = await this.callOllama(prompt);
      const latencyMs = Date.now() - startMs;

      const parsed = this.parseModelResponse(raw);
      if (!parsed) {
        log.warn(
          `[LocalClaimVerifier] Failed to parse model response for claim: ${claimText.slice(0, 60)}`
        );
        return this.fallbackResult(latencyMs);
      }

      return {
        verdict: parsed.verdict,
        confidence: parsed.confidence,
        rationale: parsed.rationale,
        latencyMs,
        modelId: this.modelId,
        source: "local_model",
      };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      log.warn(
        `[LocalClaimVerifier] Verification failed (non-fatal): ${String(err)}`
      );
      return this.fallbackResult(latencyMs);
    }
  }

  /**
   * Check whether the local model is healthy and what domains it supports.
   */
  async getCapabilities(): Promise<LocalVerifierCapabilities> {
    const available = await this.isHealthy();
    return {
      domains: available ? SUPPORTED_DOMAINS : [],
      available,
      modelId: this.modelId,
      modelSizeMb: 3072, // Qwen2.5-Coder-1.5B ~3 GB
    };
  }

  /**
   * Alias for isHealthy() — backward compatibility.
   */
  async ping(): Promise<boolean> {
    return this.isHealthy();
  }

  /**
   * Returns true if Ollama is reachable and the model is loaded.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      const resp = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!resp.ok) return false;
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      return (data.models ?? []).some((m) =>
        m.name.startsWith(this.modelId)
      );
    } catch {
      return false;
    }
  }

  /**
   * Check whether the local model supports the given domain.
   */
  supportsDomain(domain?: string): boolean {
    if (!domain) return true; // "general" fallback
    return SUPPORTED_DOMAINS.includes(domain);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Call Ollama /api/generate and return the model's response text.
   * Per MANUS_INSTRUCTIONS §3.2.
   */
  private async callOllama(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const resp = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelId,
          prompt,
          stream: false,
          format: "json",
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(
          `Ollama returned ${resp.status}: ${await resp.text()}`
        );
      }

      const data = (await resp.json()) as { response?: string };
      return data?.response?.trim() ?? "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseModelResponse(
    raw: string
  ): { verdict: LocalVerdict; confidence: number; rationale: string } | null {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as {
        verdict?: string;
        confidence?: number;
        reasoning?: string;
        rationale?: string;
      };

      const validVerdicts: LocalVerdict[] = [
        "Supported",
        "Contradicted",
        "Partially Supported",
        "Ambiguous",
        "Insufficient Evidence",
        "Out of Scope",
        "Needs Expert Review",
      ];

      const verdict = validVerdicts.includes(parsed.verdict as LocalVerdict)
        ? (parsed.verdict as LocalVerdict)
        : "Insufficient Evidence";

      const confidence =
        typeof parsed.confidence === "number" &&
        parsed.confidence >= 0 &&
        parsed.confidence <= 1
          ? parsed.confidence
          : 0.5;

      // Ollama model uses "reasoning" field per the Modelfile SYSTEM prompt
      const rationale =
        typeof parsed.reasoning === "string" && parsed.reasoning.length > 0
          ? parsed.reasoning
          : typeof parsed.rationale === "string" && parsed.rationale.length > 0
          ? parsed.rationale
          : "Local model verdict.";

      return { verdict, confidence, rationale };
    } catch {
      return null;
    }
  }

  private fallbackResult(latencyMs: number): LocalVerificationResult {
    return {
      verdict: "Insufficient Evidence",
      confidence: 0.1,
      rationale: "Local model unavailable — fallback result.",
      latencyMs,
      modelId: this.modelId,
      source: "fallback",
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: LocalClaimVerifier | null = null;

export function getLocalClaimVerifier(): LocalClaimVerifier {
  if (!_instance) {
    _instance = new LocalClaimVerifier();
  }
  return _instance;
}
