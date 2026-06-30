/**
 * trainingExporter.ts
 *
 * Autopilot training export — per-verdict export of high-confidence
 * verified claims into the CLF (cognitive-loop-framework) training corpus.
 *
 * Two export channels:
 *   1. MRAgent episodic memory  — calls ingestVerifiedClaim() so the memory
 *      server can use the verdict for future pre-flight context injection and
 *      real-time contradiction detection.
 *
 *   2. CLF corpus JSONL file    — if ENV.clfCorpusPath is set, appends a
 *      JSONL line to the corpus file so the Oumi LoRA training pipeline can
 *      pick it up on the next CorpusWatcher trigger (≥50 new examples).
 *
 * Both channels are non-blocking: failures are silently logged.
 *
 * JSONL line format (matches CLF CorpusWatcher schema):
 * {
 *   "id": "<claimId>",
 *   "text": "VERDICT: <verdict>\nCLAIM: <claimText>",
 *   "label": "<verdict>",
 *   "confidence": <confidenceScore>,
 *   "citation": "<citation>",
 *   "domain": "<domain>",
 *   "exportedAt": "<ISO timestamp>"
 * }
 */

import * as fs from "fs";
import * as path from "path";
import { ingestVerifiedClaim } from "./mrAgentClient";
import { emitVerdictEvent } from "./trainingBridge";
import { logger, errData } from "./logger";
import { ENV } from "./_core/env";

const log = logger("trainingExporter");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrainingExportParams {
  claimId: number;
  claimText: string;
  verdict: string;
  confidenceScore: number;
  citation: string;
  domain: string;
}

export interface TrainingExportResult {
  exported: boolean;
  channels: ("mrAgent" | "clfCorpus" | "trainingBridge")[];
  skippedReason?: string;
}

// ── Core export function ──────────────────────────────────────────────────────

/**
 * Export a high-confidence verified claim to the training corpus.
 *
 * Skips silently if:
 *   - confidenceScore < ENV.trainingExportMinConfidence
 *   - both channels are unavailable (mrAgent disabled + no clfCorpusPath)
 *
 * Never throws.
 */
export async function exportHighConfidenceVerdict(
  params: TrainingExportParams
): Promise<TrainingExportResult> {
  const { claimId, claimText, verdict, confidenceScore, citation, domain } =
    params;

  // ── Confidence gate ───────────────────────────────────────────────────────
  if (confidenceScore < ENV.trainingExportMinConfidence) {
    return {
      exported: false,
      channels: [],
      skippedReason: `confidence ${confidenceScore.toFixed(3)} < threshold ${ENV.trainingExportMinConfidence}`,
    };
  }

  const channels: ("mrAgent" | "clfCorpus" | "trainingBridge")[] = [];
  const episodeText = `VERDICT: ${verdict}\nCLAIM: ${claimText}`;
  const episodeId = `claim-${claimId}-${Date.now()}`;

  // ── Channel 1: MRAgent episodic memory ────────────────────────────────────
  if (ENV.mrAgentEnabled) {
    try {
      const result = await ingestVerifiedClaim({
        episodeId,
        text: episodeText,
        origin: `ttruthdesk:claim:${claimId}`,
        tags: [domain, verdict.toLowerCase().replace(/\s+/g, "_")],
        citation,
      });
      if (result?.success) {
        channels.push("mrAgent");
        log.info(`[TrainingExporter] Claim ${claimId} ingested into MRAgent`, {
          episodeId: result.episode_id,
        });
      }
    } catch (err) {
      log.warn(
        `[TrainingExporter] MRAgent ingest failed for claim ${claimId} (non-fatal)`,
        errData(err)
      );
    }
  }

  // ── Channel 2: CLF corpus JSONL ───────────────────────────────────────────
  if (ENV.clfCorpusPath) {
    try {
      const line = JSON.stringify({
        id: String(claimId),
        text: episodeText,
        label: verdict,
        confidence: confidenceScore,
        citation,
        domain,
        exportedAt: new Date().toISOString(),
      });

      const dir = path.dirname(ENV.clfCorpusPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.appendFileSync(ENV.clfCorpusPath, line + "\n", "utf8");
      channels.push("clfCorpus");
      log.info(`[TrainingExporter] Claim ${claimId} appended to CLF corpus`, {
        path: ENV.clfCorpusPath,
      });
    } catch (err) {
      log.warn(
        `[TrainingExporter] CLF corpus write failed for claim ${claimId} (non-fatal)`,
        errData(err)
      );
    }
  }

  // ── Channel 3: trainingBridge (emitVerdictEvent) ────────────────────────────────
  // Route through the established trainingBridge pipeline so the CLF LoRA
  // training loop receives the verdict via the same path as processQueryResults.
  try {
    emitVerdictEvent({
      claimText,
      verdict,
      rationale: `Confidence: ${confidenceScore.toFixed(3)}`,
      sourceUrl: citation || undefined,
      domain,
    });
    channels.push("trainingBridge");
    log.info(`[TrainingExporter] Claim ${claimId} emitted to trainingBridge`, {
      verdict,
      domain,
    });
  } catch (err) {
    log.warn(
      `[TrainingExporter] trainingBridge emit failed for claim ${claimId} (non-fatal)`,
      errData(err)
    );
  }

  if (channels.length === 0) {
    return {
      exported: false,
      channels: [],
      skippedReason:
        "no export channels available (mrAgent disabled, no clfCorpusPath, trainingBridge failed)",
    };
  }

  return { exported: true, channels };
}
