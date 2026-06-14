/**
 * trainingCorpusListener.ts — Training flywheel connection.
 *
 * Called fire-and-forget by loopOrchestrator after every verdict_complete event.
 * Enriches the bare claimId+verdict payload with claimText, confidence,
 * contextSentence, entities, and provenance, then forwards to the
 * cognitive-loop-framework ClaimsCorpusGenerator.
 *
 * This is the single line that starts the flywheel:
 *   citation.is used widely
 *     → verdict_complete fires
 *       → notifyTrainingCorpus() enriches and forwards
 *         → ClaimsCorpusGenerator appends 5 training pairs
 *           → CorpusWatcher triggers IncrementalTrainer
 *             → model improves → better verification → more usage
 */

import { getDb } from "./db";
import { claims } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getChain } from "./claimProvenanceService";
import { logger } from "./logger";

const LOG = logger("trainingCorpusListener");

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TrainingVerdictPayload {
  claimId: number;
  claimText: string;
  verdict: string;
  confidence: number;
  contextSentence: string;
  entities: string[];
  provenance: string;
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Enriches a bare verdict result and forwards it to the training corpus.
 * Fire-and-forget — never throws, never blocks the loop.
 */
export async function notifyTrainingCorpus(
  claimId: number,
  verdict: string
): Promise<void> {
  try {
    const payload = await buildTrainingPayload(claimId, verdict);
    if (!payload) return;

    // Forward to cognitive-loop-framework ClaimsCorpusGenerator.
    // In production this is a local function call via the shared event bus.
    // In test environments TRAINING_CORPUS_ENABLED may be unset — skip silently.
    if (process.env["TRAINING_CORPUS_ENABLED"] !== "true") return;

    // Dynamic import so the module is optional in environments without the
    // cognitive-loop-framework installed alongside.
    // Variable path prevents TypeScript from statically resolving the optional peer.
    const corpusModulePath =
      "../../cognitive-loop-framework/src/training/claimsCorpusGenerator";
    type CorpusGeneratorCtor = new () => {
      processVerdictEvent(p: TrainingVerdictPayload): Promise<void>;
    };
    const corpusModule = await (
      import(corpusModulePath) as Promise<{
        ClaimsCorpusGenerator?: CorpusGeneratorCtor;
      }>
    ).catch(() => ({ ClaimsCorpusGenerator: undefined }));
    const ClaimsCorpusGenerator = corpusModule.ClaimsCorpusGenerator;

    if (ClaimsCorpusGenerator) {
      const generator = new ClaimsCorpusGenerator();
      await generator.processVerdictEvent(payload);
    }
  } catch (err) {
    // Non-fatal — log and continue
    LOG.warn("trainingCorpus notify failed (non-fatal)", { claimId, err });
  }
}

// ─── Payload builder ───────────────────────────────────────────────────────────

export async function buildTrainingPayload(
  claimId: number,
  verdict: string
): Promise<TrainingVerdictPayload | null> {
  const db = await getDb();
  if (!db) return null;

  // 1. Fetch the claim record
  const [claim] = await db
    .select()
    .from(claims)
    .where(eq(claims.id, claimId))
    .limit(1);

  if (!claim) return null;

  // 2. Extract entities from the claim's structured fields
  const entityNames: string[] = [
    claim.pdbId,
    claim.proteinName,
    claim.organism,
    claim.ligand,
    claim.experimentalMethod,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);

  // 3. Build provenance narrative (best-effort)
  let provenance = "";
  try {
    const chain = await getChain(claimId);
    if (chain && chain.length > 0) {
      provenance = chain
        .map(h => [h.step, h.actor].filter(Boolean).join(" → "))
        .join(" | ");
    }
  } catch {
    // provenance is optional — continue without it
  }

  // 4. Build context sentence from sourcePassage or claimText
  const contextSentence =
    claim.sourcePassage?.slice(0, 256) ?? claim.claimText.slice(0, 256);

  return {
    claimId,
    claimText: claim.claimText,
    verdict,
    confidence: claim.confidenceScore ?? 0.5,
    contextSentence,
    entities: entityNames,
    provenance,
  };
}
