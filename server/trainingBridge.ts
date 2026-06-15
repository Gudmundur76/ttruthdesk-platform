/**
 * trainingBridge.ts
 *
 * Singleton bridge between the autonomous ingest loop and the
 * cognitive-loop-framework training pipeline.
 *
 * Responsibilities:
 *  - Initialise the ClaimsCorpusGenerator + CorpusWatcher + IncrementalTrainer
 *    once at server startup (lazy, on first use).
 *  - Expose emitVerdictEvent() so autonomousIngest.ts can feed verified
 *    claims into the corpus without knowing about the training internals.
 *  - Call watcher.check() after each event so training is triggered
 *    automatically when the corpus reaches the density threshold.
 *
 * The training pipeline is intentionally fire-and-forget: it runs in the
 * background and never blocks the ingest loop or the API response.
 *
 * Design constraints: max 200 lines, max 20 lines/function, max 3 params
 */

import * as path from "path";
import { logger } from "./logger";
const log = logger("trainingBridge");

// ── Types (inline to match cognitive-loop-framework VerdictEvent exactly) ─────

interface EntityRecord {
  type: string;
  name: string;
  canonicalId: string;
}

interface VerdictEvent {
  claimId: string;
  claimText: string;
  verdict: string;
  confidence: number;
  contextSentence: string;
  entities: EntityRecord[];
  provenance: string;
}

// ── Internal bridge event (what autonomousIngest provides) ────────────────────

export interface IngestVerdictEvent {
  claimText: string;
  verdict: string;
  rationale: string;
  sourceUrl?: string;
  domain?: string;
  entityName?: string;
}

interface _CorpusReadyStats {
  newExamplesCount: number;
  totalExamples: number;
}

// ── Lazy-initialised singleton ────────────────────────────────────────────────

let pipelineReady = false;
let generator: { processVerdictEvent: (e: VerdictEvent) => void } | null = null;
let watcher: { check: () => void } | null = null;

const CORPUS_PATH =
  process.env["TRAINING_CORPUS_PATH"] ??
  path.join(process.cwd(), "data", "training", "claims_corpus.jsonl");

const MIN_PAIRS_THRESHOLD = Number(process.env["TRAINING_MIN_PAIRS"] ?? "50");

/**
 * Lazily import and initialise the training pipeline.
 * Uses dynamic import so the framework package is optional at runtime —
 * if it is not installed, training is silently skipped.
 */
async function ensurePipeline(): Promise<boolean> {
  if (pipelineReady) return true;
  try {
    // Use a runtime string so tsc cannot statically resolve the optional
    // sibling package — it may not be present in CI or production.
    const modulePath = "../../cognitive-loop-framework/src/training/index.js";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import(/* @vite-ignore */ modulePath)) as any;
    const pipeline = mod.createTrainingPipeline({
      corpusPath: CORPUS_PATH,
      minPairsThreshold: MIN_PAIRS_THRESHOLD,
    });
    generator = pipeline.generator;
    watcher = pipeline.watcher;
    pipelineReady = true;
    log.info(
      `[trainingBridge] Pipeline ready — corpus: ${CORPUS_PATH}, threshold: ${MIN_PAIRS_THRESHOLD}`
    );
    return true;
  } catch (err) {
    // Framework package not available — training disabled, not an error
    log.debug(
      `[trainingBridge] Training pipeline not available: ${String(err)}`
    );
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Feed a verified claim into the training corpus and check whether
 * a training run should be triggered.
 *
 * Safe to call fire-and-forget — never throws.
 */
export function emitVerdictEvent(event: IngestVerdictEvent): void {
  ensurePipeline()
    .then(ready => {
      if (!ready || !generator || !watcher) return;
      // Map from ingest event to the full VerdictEvent the framework expects
      const frameworkEvent: VerdictEvent = {
        claimId: `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        claimText: event.claimText,
        verdict: event.verdict,
        confidence: event.verdict === "Supported" ? 0.85 : 0.5,
        contextSentence: event.rationale.slice(0, 500),
        entities: event.entityName
          ? [
              {
                type: "protein",
                name: event.entityName,
                canonicalId: event.entityName,
              },
            ]
          : [],
        provenance: event.sourceUrl ?? `domain:${event.domain ?? "unknown"}`,
      };
      generator.processVerdictEvent(frameworkEvent);
      watcher.check();
    })
    .catch(err => {
      log.warn(`[trainingBridge] emitVerdictEvent failed: ${String(err)}`);
    });
}

/**
 * Expose pipeline stats for the /developers/slm status endpoint.
 * Returns null if the pipeline is not yet initialised.
 */
export function getPipelineStats(): {
  corpusPath: string;
  threshold: number;
  ready: boolean;
} {
  return {
    corpusPath: CORPUS_PATH,
    threshold: MIN_PAIRS_THRESHOLD,
    ready: pipelineReady,
  };
}
