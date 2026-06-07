/**
 * inversePromptEngine.ts
 *
 * Main orchestrator for the Inverse Prompt Architecture.
 *
 * Flow:
 *   1. generateQuestionsFromTopEntities() — scan verified graph
 *   2. filterClaimsBatch() — run all four verifiability gates
 *   3. persistBatch() — write to generated_claims + coord_queue
 *
 * Called from:
 *   - analysisPipeline.ts (after new Supported verdicts)
 *   - scheduled heartbeat (every 4 hours)
 *   - admin tRPC trigger
 */

import { generateQuestionsFromTopEntities, generateQuestionsFromVerifiedTruth } from "./graphQuestionGenerator";
import { filterClaimsBatch } from "./verifiabilityGate";
import { persistBatch } from "./claimQueueWriter";

export interface InversePromptRunResult {
  entitiesScanned: number;
  candidatesGenerated: number;
  passedGate: number;
  queued: number;
  rejected: number;
  deferred: number;
  duplicates: number;
  errors: number;
  durationMs: number;
}

/**
 * Run the full Inverse Prompt Engine across the top N entities.
 */
export async function runInversePromptEngine(
  topN = 20,
  vertical = "structural_biology"
): Promise<InversePromptRunResult> {
  const start = Date.now();

  // Step 1: Generate candidates from verified graph truth
  const candidates = await generateQuestionsFromTopEntities(topN);

  // Step 2: Run all four verifiability gates
  const passed = filterClaimsBatch(candidates);

  // Step 3: Persist and queue
  const pairs = passed.map((p) => ({ candidate: p, gateResult: p.gateResult }));
  const summary = await persistBatch(pairs, vertical);

  return {
    entitiesScanned: topN,
    candidatesGenerated: candidates.length,
    passedGate: passed.length,
    queued: summary.queued,
    rejected: summary.rejected,
    deferred: summary.deferred,
    duplicates: summary.duplicates,
    errors: summary.errors,
    durationMs: Date.now() - start,
  };
}

/**
 * Run the Inverse Prompt Engine for a single entity.
 * Used by analysisPipeline after a new Supported verdict.
 */
export async function runInversePromptForEntity(
  entityId: number,
  vertical = "structural_biology"
): Promise<InversePromptRunResult> {
  const start = Date.now();

  const candidates = await generateQuestionsFromVerifiedTruth(entityId);
  const passed = filterClaimsBatch(candidates);
  const pairs = passed.map((p) => ({ candidate: p, gateResult: p.gateResult }));
  const summary = await persistBatch(pairs, vertical);

  return {
    entitiesScanned: 1,
    candidatesGenerated: candidates.length,
    passedGate: passed.length,
    queued: summary.queued,
    rejected: summary.rejected,
    deferred: summary.deferred,
    duplicates: summary.duplicates,
    errors: summary.errors,
    durationMs: Date.now() - start,
  };
}
