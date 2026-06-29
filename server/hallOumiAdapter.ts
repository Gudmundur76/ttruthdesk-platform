/**
 * hallOumiAdapter.ts
 *
 * Integrates HallOumi-8B (oumi-ai/HallOumi-8B) as a secondary verification
 * signal for claims that the deterministic pipeline returns as "Ambiguous" or
 * "Insufficient Evidence".
 *
 * HallOumi was trained specifically for claim verification against context
 * documents and outperforms GPT-4 / Claude 3.5 Sonnet on hallucination
 * detection benchmarks. It returns per-sentence verdicts with confidence
 * scores and exact citation spans.
 *
 * This adapter is NON-DESTRUCTIVE: it stores hallOumiSupported,
 * hallOumiConfidence, and hallOumiRationale on the claim record but does NOT
 * overwrite the deterministic verdict. The deterministic verdict remains the
 * authoritative signal; HallOumi provides a secondary confidence layer.
 *
 * Activation: set HALLOUMI_ENABLED=true and HALLOUMI_URL=http://<host>:8001
 * in the environment. Start the server with:
 *   slm-infra-deploy/scripts/start-halloumi-cpu.sh
 *
 * HallOumi input format (from oumi-ai/oumi GitHub source):
 *   System: "You are a claim verification assistant..."
 *   User:   "<claim>\n\nContext:\n<evidence_text>"
 *
 * HallOumi output format:
 *   One line per claim sentence:
 *   "<sentence> |supported| <confidence>" or
 *   "<sentence> |unsupported| <confidence>"
 *   Followed by an optional explanation paragraph.
 */

import { ENV } from "./_core/env";
import { updateClaimVerdict } from "./db";
import { logger } from "./logger";
import type { VerdictResult } from "./pdbAdapter";

const log = logger("hallOumiAdapter");

/** Parsed output from a single HallOumi response */
export interface HallOumiResult {
  supported: boolean;
  confidence: number; // 0.0–1.0
  rationale: string;
  rawResponse: string;
}

/**
 * Build the HallOumi prompt.
 * Format matches the oumi-ai/oumi inference notebook exactly.
 */
function buildHallOumiPrompt(
  claimText: string,
  evidenceText: string
): { system: string; user: string } {
  return {
    system:
      "You are a claim verification assistant. " +
      "For each claim sentence, determine if it is supported by the provided context. " +
      "Format each verdict as: <sentence> |supported| <confidence> or <sentence> |unsupported| <confidence>. " +
      "Confidence is a number between 0.0 and 1.0. " +
      "After all sentences, provide a brief explanation.",
    user: `Claim: ${claimText}\n\nContext:\n${evidenceText}`,
  };
}

/**
 * Parse HallOumi output into a structured result.
 * Handles both |supported| and |unsupported| tags with confidence scores.
 */
export function parseHallOumiResponse(raw: string): HallOumiResult {
  const lines = raw.trim().split("\n");
  let supportedCount = 0;
  let unsupportedCount = 0;
  let totalConfidence = 0;
  let verdictLineCount = 0;
  const rationaleLines: string[] = [];

  // Regex: matches "<text> |supported| 0.87" or "<text> |unsupported| 0.23"
  // Confidence value is optional — defaults to 0.5 when absent
  const verdictRe = /\|(supported|unsupported)\|(?:\s*([\d.]+))?/i;

  for (const line of lines) {
    const match = verdictRe.exec(line);
    if (match) {
      const label = match[1].toLowerCase();
      const conf = Math.min(1.0, Math.max(0.0, match[2] != null ? parseFloat(match[2]) : 0.5));
      if (label === "supported") {
        supportedCount++;
      } else {
        unsupportedCount++;
      }
      totalConfidence += conf;
      verdictLineCount++;
    } else if (line.trim().length > 0) {
      rationaleLines.push(line.trim());
    }
  }

  // Aggregate: majority vote across all verdict lines
  const supported =
    verdictLineCount === 0 ? false : supportedCount >= unsupportedCount;
  const confidence =
    verdictLineCount === 0 ? 0.0 : totalConfidence / verdictLineCount;
  const rationale =
    rationaleLines.join(" ").slice(0, 1000) ||
    (supported ? "HallOumi: claim supported by context." : "HallOumi: claim not supported by context.");

  return { supported, confidence, rationale, rawResponse: raw };
}

/**
 * Extract a plain-text evidence string from a VerdictResult.
 * Used to build the HallOumi context window.
 */
function extractEvidenceText(result: VerdictResult): string {
  const parts: string[] = [];
  if (result.rationale) parts.push(result.rationale);
  if (result.evidenceUrl) parts.push(`Source: ${result.evidenceUrl}`);
  if (result.evidenceRaw) {
    try {
      const raw = result.evidenceRaw as Record<string, unknown>;
      // Extract common text fields from evidence objects
      for (const key of ["abstract", "description", "title", "summary", "text", "content"]) {
        const val = raw[key];
        if (typeof val === "string" && val.length > 0) {
          parts.push(val.slice(0, 2000));
          break; // Use first available text field only
        }
      }
    } catch {
      // evidenceRaw is not an object — ignore
    }
  }
  return parts.join("\n\n").slice(0, 4000) || "No additional context available.";
}

/**
 * Call the local HallOumi server (OpenAI-compatible /v1/chat/completions).
 * Returns the raw response text or throws on network/parse error.
 */
async function callHallOumiServer(
  claimText: string,
  evidenceText: string
): Promise<string> {
  const { system, user } = buildHallOumiPrompt(claimText, evidenceText);
  const url = `${ENV.hallOumiUrl}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ENV.hallOumiModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 512,
      temperature: 0.0, // Deterministic — HallOumi is a classifier, not a generator
    }),
    signal: AbortSignal.timeout(30_000), // 30s timeout — CPU inference is slow
  });

  if (!response.ok) {
    throw new Error(
      `HallOumi server returned ${response.status}: ${await response.text()}`
    );
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("HallOumi server returned empty content");
  return content;
}

/**
 * Main entry point called from analysisPipeline.ts.
 *
 * Augments the claim record with HallOumi's secondary confidence signal.
 * Non-blocking — all errors are caught and logged; the deterministic verdict
 * is never modified.
 */
export async function augmentWithHallOumi(
  claimId: number,
  claimText: string,
  result: VerdictResult
): Promise<void> {
  if (!ENV.hallOumiEnabled) return;

  const evidenceText = extractEvidenceText(result);

  let hallOumiResult: HallOumiResult;
  try {
    const raw = await callHallOumiServer(claimText, evidenceText);
    hallOumiResult = parseHallOumiResponse(raw);
  } catch (err) {
    log.warn("[HallOumi] Server call failed:", err);
    return;
  }

  try {
    await updateClaimVerdict(claimId, {
      hallOumiSupported: hallOumiResult.supported,
      hallOumiConfidence: hallOumiResult.confidence,
      hallOumiRationale: hallOumiResult.rationale,
    });
    log.info(
      `[HallOumi] Claim ${claimId}: ${hallOumiResult.supported ? "supported" : "unsupported"} ` +
        `(confidence=${hallOumiResult.confidence.toFixed(2)})`
    );
  } catch (err) {
    log.warn("[HallOumi] Failed to persist augmentation result:", err);
  }
}
