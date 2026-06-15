/**
 * verdictWebhookRoute.ts
 *
 * Fires a POST to the cognitive-loop-framework after each claim is verified.
 * This is the entry point for the self-improving data flywheel:
 *
 *   ttruthdesk verifies claim
 *     → POST /cognitive/ingest (this module)
 *       → ClaimsCorpusGenerator appends 4 training pairs
 *         → CorpusWatcher checks threshold (50 pairs)
 *           → IncrementalTrainer runs finetunePipeline.py
 *             → Ollama refreshes claims-slm
 *               → Next claim is verified by a better model
 *
 * Design:
 * - Fire-and-forget: the webhook call is non-blocking (background fetch)
 * - HMAC-SHA256 signed: the cognitive loop verifies the signature
 * - Graceful degradation: if the cognitive loop is down, verification still succeeds
 * - No PII: only claim text, verdict, confidence, entities, and provenance are sent
 *
 * Design constraints: max 200 lines, max 20 lines/function, max 3 params
 */
import { createHmac } from "crypto";
import { ENV } from "./_core/env";
import { logger, errData } from "./logger";
const log = logger("verdictWebhookRoute");

// ── Types ─────────────────────────────────────────────────────────────────────
export interface VerdictWebhookPayload {
  claimId: string | null;
  claimText: string;
  verdict: string;
  confidence: number;
  contextSentence: string;
  entities: Array<{ type: string; name: string; canonicalId: string }>;
  provenance: string;
}

// ── HMAC signature ────────────────────────────────────────────────────────────
function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// ── Fire-and-forget POST to cognitive loop ────────────────────────────────────
async function postToCognitiveLoop(
  payload: VerdictWebhookPayload
): Promise<void> {
  const baseUrl = ENV.cognitiveLoopUrl;
  if (!baseUrl) return; // Flywheel disabled — no URL configured

  const url = `${baseUrl}/cognitive/ingest`;
  const body = JSON.stringify({ event: payload });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ttruthdesk-platform/1.0",
  };

  if (ENV.cognitiveLoopWebhookSecret) {
    headers["x-webhook-signature"] = signPayload(
      body,
      ENV.cognitiveLoopWebhookSecret
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(
      `Cognitive loop returned ${res.status}: ${await res.text().catch(() => "")}`
    );
  }
  const result = (await res.json()) as { ok: boolean; pairsGenerated?: number };
  log.info("[VerdictWebhook] Flywheel fed", {
    claimId: payload.claimId,
    verdict: payload.verdict,
    pairsGenerated: result.pairsGenerated ?? 0,
  });
}

/**
 * Fire the verdict webhook in the background.
 * This is intentionally non-blocking — claim verification must not be
 * delayed or failed because the cognitive loop is unavailable.
 */
export function fireVerdictWebhook(payload: VerdictWebhookPayload): void {
  if (!ENV.cognitiveLoopUrl) return; // Fast path: flywheel disabled

  postToCognitiveLoop(payload).catch(err => {
    // Log but do not rethrow — the webhook is best-effort
    log.warn("[VerdictWebhook] Failed to feed flywheel (non-fatal)", {
      error: errData(err),
      claimId: payload.claimId,
    });
  });
}

/**
 * Build a VerdictWebhookPayload from the verify_claim response fields.
 * Extracts only the fields needed for training — no user data, no PII.
 */
export function buildVerdictPayload(params: {
  claimId: string | null;
  claimText: string;
  verdict: string;
  confidence: number;
  pubmedResults: Array<{ abstractSnippet?: string; title?: string }>;
  entities?: Array<{ type: string; name: string; canonicalId?: string }>;
  rationale?: string;
}): VerdictWebhookPayload {
  // Use the first PubMed abstract snippet as the context sentence
  const contextSentence =
    params.pubmedResults[0]?.abstractSnippet ??
    params.pubmedResults[0]?.title ??
    params.claimText;

  // Build provenance string from rationale
  const provenance = params.rationale
    ? `${params.rationale} → ${params.verdict}`
    : `Verdict: ${params.verdict} (confidence: ${params.confidence.toFixed(2)})`;

  return {
    claimId: params.claimId,
    claimText: params.claimText,
    verdict: params.verdict,
    confidence: params.confidence,
    contextSentence,
    entities: (params.entities ?? []).map(e => ({
      type: e.type,
      name: e.name,
      canonicalId: e.canonicalId ?? e.name,
    })),
    provenance,
  };
}
