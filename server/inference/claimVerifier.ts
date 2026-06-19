/**
 * claimVerifier.ts — Local Model Claim Verifier
 *
 * Wraps a locally-running llama.cpp inference server to provide claim
 * verification without calling the Claude API.
 *
 * PRD_SKILLOPT_AGENT2MODEL §3 — agent2model inference layer.
 *
 * Architecture:
 *   - The local model is served by modelServer.ts (llama.cpp HTTP server)
 *   - This class sends HTTP requests to the local server
 *   - Falls back to "Insufficient Evidence" on any error (non-fatal)
 *   - The router in verificationRouter.ts decides when to use this vs. the
 *     orchestrated pipeline
 *
 * Performance targets (PRD §5):
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
  | "Out of Scope";

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

const DEFAULT_MODEL_SERVER_URL =
  process.env.LOCAL_MODEL_SERVER_URL ?? "http://127.0.0.1:8080";
const DEFAULT_MODEL_ID = process.env.LOCAL_MODEL_ID ?? "claim-verifier-v1-q4";
const REQUEST_TIMEOUT_MS = 3000; // 3s timeout — if local model is slow, fall back

/** Domains the distilled model covers (trained on calibration corpus) */
const SUPPORTED_DOMAINS = [
  "structural_biology",
  "clinical",
  "economic",
  "legal",
  "environmental",
  "general",
];

// ─── Prompt Template ──────────────────────────────────────────────────────────

function buildVerificationPrompt(claimText: string, domain?: string): string {
  const domainHint = domain ? `Domain: ${domain}\n` : "";
  return `You are a scientific claim verifier. Evaluate the following claim and return a structured verdict.

${domainHint}Claim: ${claimText}

Return a JSON object with exactly these fields:
{
  "verdict": one of ["Supported", "Contradicted", "Partially Supported", "Ambiguous", "Insufficient Evidence", "Out of Scope"],
  "confidence": a float between 0.0 and 1.0,
  "rationale": a single sentence explaining the verdict
}

Return ONLY the JSON object. No other text.`;
}

// ─── LocalClaimVerifier ────────────────────────────────────────────────────────

export class LocalClaimVerifier {
  private readonly serverUrl: string;
  private readonly modelId: string;

  constructor(serverUrl?: string, modelId?: string) {
    this.serverUrl = serverUrl ?? DEFAULT_MODEL_SERVER_URL;
    this.modelId = modelId ?? DEFAULT_MODEL_ID;
  }

  /**
   * Verify a claim using the local model.
   * Returns a fallback result on any error (non-fatal).
   */
  async verify(
    claimText: string,
    domain?: string
  ): Promise<LocalVerificationResult> {
    const startMs = Date.now();

    try {
      const prompt = buildVerificationPrompt(claimText, domain);
      const response = await this.callModelServer(prompt);
      const latencyMs = Date.now() - startMs;

      const parsed = this.parseModelResponse(response);
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
   * Check what domains the local model can handle.
   * Also pings the model server to check availability.
   */
  async getCapabilities(): Promise<LocalVerifierCapabilities> {
    const available = await this.ping();
    return {
      domains: available ? SUPPORTED_DOMAINS : [],
      available,
      modelId: this.modelId,
      modelSizeMb: 400, // Q4_K_M quantization of 2-4B model
    };
  }

  /**
   * Ping the model server to check if it is reachable.
   */
  async ping(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);
      const resp = await fetch(`${this.serverUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async callModelServer(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      // llama.cpp HTTP server API — compatible with OpenAI /v1/completions
      const resp = await fetch(`${this.serverUrl}/v1/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          max_tokens: 200,
          temperature: 0.1,
          stop: ["\n\n", "```"],
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(
          `Model server returned ${resp.status}: ${await resp.text()}`
        );
      }

      const data = (await resp.json()) as {
        choices?: Array<{ text?: string }>;
      };
      return data?.choices?.[0]?.text?.trim() ?? "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseModelResponse(
    raw: string
  ): { verdict: LocalVerdict; confidence: number; rationale: string } | null {
    try {
      // Extract JSON from the response (model may include preamble)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as {
        verdict?: string;
        confidence?: number;
        rationale?: string;
      };

      const validVerdicts: LocalVerdict[] = [
        "Supported",
        "Contradicted",
        "Partially Supported",
        "Ambiguous",
        "Insufficient Evidence",
        "Out of Scope",
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

      const rationale =
        typeof parsed.rationale === "string" && parsed.rationale.length > 0
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
