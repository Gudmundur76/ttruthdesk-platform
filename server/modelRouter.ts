/**
 * modelRouter.ts — Local Model vs. Orchestrated Pipeline Router
 *
 * MANUS_INSTRUCTIONS §4 — decides whether to use the local Ollama model
 * (claim-verifier) or the full orchestrated pipeline for a given claim.
 *
 * Routing rules:
 *   1. If LOCAL_MODEL_ENABLED=false → always use orchestrated pipeline
 *   2. If local model is not healthy → fall back to orchestrated pipeline
 *   3. If claim domain is not supported by local model → orchestrated pipeline
 *   4. If confidence threshold is set and local result is below it → escalate
 *   5. Otherwise → use local model (fast, cheap, no API cost)
 *
 * This file is the single source of truth for routing decisions.
 * The /api/v2/verify-local endpoint in apiV2Router.ts calls this.
 */

import { getLocalClaimVerifier, LocalVerificationResult } from "./inference/claimVerifier";
import { logger } from "./logger";

const log = logger("modelRouter");

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Set LOCAL_MODEL_ENABLED=false to force all traffic to orchestrated pipeline */
const LOCAL_MODEL_ENABLED =
  (process.env.LOCAL_MODEL_ENABLED ?? "true").toLowerCase() !== "false";

/** Minimum confidence for local model to be trusted; below this, escalate */
const CONFIDENCE_THRESHOLD = parseFloat(
  process.env.LOCAL_MODEL_CONFIDENCE_THRESHOLD ?? "0.6"
);

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RouterDecision =
  | "local_model"
  | "orchestrated_pipeline"
  | "escalate";

export interface RoutingResult {
  decision: RouterDecision;
  localResult?: LocalVerificationResult;
  reason: string;
}

// ─── Router ────────────────────────────────────────────────────────────────────

export class ModelRouter {
  /**
   * Route a claim verification request.
   *
   * Returns a RoutingResult that tells the caller:
   *   - "local_model": use localResult directly
   *   - "orchestrated_pipeline": call the full pipeline
   *   - "escalate": local model ran but confidence is too low; use pipeline
   */
  async route(claimText: string, domain?: string): Promise<RoutingResult> {
    // Rule 1: feature flag
    if (!LOCAL_MODEL_ENABLED) {
      return {
        decision: "orchestrated_pipeline",
        reason: "LOCAL_MODEL_ENABLED=false",
      };
    }

    const verifier = getLocalClaimVerifier();

    // Rule 2: health check
    const healthy = await verifier.isHealthy();
    if (!healthy) {
      log.info("[ModelRouter] Local model not healthy — routing to pipeline");
      return {
        decision: "orchestrated_pipeline",
        reason: "local_model_unavailable",
      };
    }

    // Rule 3: domain support
    if (!verifier.supportsDomain(domain)) {
      return {
        decision: "orchestrated_pipeline",
        reason: `domain_not_supported: ${domain ?? "unknown"}`,
      };
    }

    // Run local model
    const localResult = await verifier.verify(claimText, domain);

    // Rule 4: confidence threshold
    if (localResult.confidence < CONFIDENCE_THRESHOLD) {
      log.info(
        `[ModelRouter] Low confidence (${localResult.confidence.toFixed(2)}) — escalating`
      );
      return {
        decision: "escalate",
        localResult,
        reason: `confidence_below_threshold: ${localResult.confidence.toFixed(2)} < ${CONFIDENCE_THRESHOLD}`,
      };
    }

    return {
      decision: "local_model",
      localResult,
      reason: "local_model_confident",
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _router: ModelRouter | null = null;

export function getModelRouter(): ModelRouter {
  if (!_router) {
    _router = new ModelRouter();
  }
  return _router;
}
