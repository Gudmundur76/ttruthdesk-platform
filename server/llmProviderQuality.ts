/**
 * llmProviderQuality.ts
 *
 * Tension 7: LLM Provider Quality Scoring
 *
 * Tracks per-model accuracy using the llm_provider_quality table.
 * Bans free models from high-stakes verdicts when their accuracy drops
 * below the configured threshold (default: 0.70).
 *
 * Key functions:
 *   - recordModelUsage()       — log a claim processed by a model
 *   - recordModelOutcome()     — record whether model verdict matched validated verdict
 *   - isModelAllowedForHighStakes() — check if a model can process high-stakes claims
 *   - banModel()               — ban a model from high-stakes verdicts
 *   - recomputeAccuracy()      — recalculate accuracy rates for all models
 *   - getProviderQualityStats() — fetch all model quality stats for admin panel
 *   - upsertModelRecord()      — ensure a model record exists in the DB
 */

import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import { llmProviderQuality } from "../drizzle/schema";

// Minimum accuracy threshold for high-stakes verdicts
export const HIGH_STAKES_ACCURACY_THRESHOLD = 0.70;
// Minimum number of claims before accuracy is considered reliable
export const MIN_CLAIMS_FOR_ACCURACY = 10;

// High-stakes verdicts: definitive claims that affect scientific credibility
export const HIGH_STAKES_VERDICTS = new Set([
  "Supported",
  "Contradicted",
  "Partially Supported",
]);

/**
 * Ensure a model record exists in the DB.
 * Called when a model first processes a claim.
 */
export async function upsertModelRecord(
  modelId: string,
  modelName: string,
  provider: string,
  isFree: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(llmProviderQuality)
    .values({
      modelId,
      modelName,
      provider,
      isFree,
      allowedForHighStakes: true,
      totalClaims: 0,
      correctPredictions: 0,
      isBanned: false,
    })
    .onDuplicateKeyUpdate({
      set: {
        modelName,
        provider,
        lastUpdatedAt: new Date(),
      },
    });
}

/**
 * Increment the total claim count for a model.
 * Called after a model processes a claim.
 */
export async function recordModelUsage(
  modelId: string,
  modelName: string,
  provider: string,
  isFree: boolean,
  confidenceScore?: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Ensure record exists
  await upsertModelRecord(modelId, modelName, provider, isFree);
  // Update usage stats
  const updateSet: Record<string, unknown> = {
    totalClaims: sql`total_claims + 1`,
    lastUpdatedAt: new Date(),
  };
  if (confidenceScore !== undefined) {
    // Incremental average: new_avg = (old_avg * (n-1) + new_val) / n
    updateSet.avgConfidence = sql`COALESCE(avg_confidence, 0) * (total_claims / (total_claims + 1)) + ${confidenceScore} / (total_claims + 1)`;
  }
  await db
    .update(llmProviderQuality)
    .set(updateSet as never)
    .where(eq(llmProviderQuality.modelId, modelId));
}

/**
 * Record whether a model's verdict was correct (matched validated verdict).
 * Called after human review or calibration pass.
 */
export async function recordModelOutcome(
  modelId: string,
  wasCorrect: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (wasCorrect) {
    await db
      .update(llmProviderQuality)
      .set({
        correctPredictions: sql`correct_predictions + 1`,
        lastUpdatedAt: new Date(),
      } as never)
      .where(eq(llmProviderQuality.modelId, modelId));
  }
  // Recompute accuracy rate
  await db
    .update(llmProviderQuality)
    .set({
      accuracyRate: sql`CASE WHEN total_claims > 0 THEN correct_predictions / total_claims ELSE NULL END`,
      lastUpdatedAt: new Date(),
    } as never)
    .where(eq(llmProviderQuality.modelId, modelId));
  // Auto-ban if accuracy falls below threshold (only after MIN_CLAIMS_FOR_ACCURACY)
  await autoEnforceBan(modelId);
}

/**
 * Check if a model is allowed to process high-stakes verdicts.
 * Returns true if:
 *   - model is not banned
 *   - model has allowedForHighStakes = true
 *   - model has not yet accumulated enough claims to be evaluated (< MIN_CLAIMS_FOR_ACCURACY)
 *   - model accuracy is above HIGH_STAKES_ACCURACY_THRESHOLD
 */
export async function isModelAllowedForHighStakes(modelId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true; // fail open if DB unavailable
  const rows = await db
    .select()
    .from(llmProviderQuality)
    .where(eq(llmProviderQuality.modelId, modelId))
    .limit(1);
  if (rows.length === 0) return true; // unknown model — allow (will be tracked going forward)
  const record = rows[0];
  if (record.isBanned) return false;
  if (!record.allowedForHighStakes) return false;
  // If we have enough data and accuracy is below threshold, disallow
  if (
    record.totalClaims >= MIN_CLAIMS_FOR_ACCURACY &&
    record.accuracyRate !== null &&
    record.accuracyRate !== undefined &&
    record.accuracyRate < HIGH_STAKES_ACCURACY_THRESHOLD
  ) {
    return false;
  }
  return true;
}

/**
 * Manually ban a model from high-stakes verdicts.
 */
export async function banModel(modelId: string, reason: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(llmProviderQuality)
    .set({
      isBanned: true,
      allowedForHighStakes: false,
      banReason: reason,
      lastUpdatedAt: new Date(),
    })
    .where(eq(llmProviderQuality.modelId, modelId));
}

/**
 * Unban a model (admin action).
 */
export async function unbanModel(modelId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(llmProviderQuality)
    .set({
      isBanned: false,
      allowedForHighStakes: true,
      banReason: null,
      lastUpdatedAt: new Date(),
    })
    .where(eq(llmProviderQuality.modelId, modelId));
}

/**
 * Auto-enforce ban based on accuracy threshold.
 * Called after each outcome is recorded.
 */
async function autoEnforceBan(modelId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const rows = await db
    .select()
    .from(llmProviderQuality)
    .where(eq(llmProviderQuality.modelId, modelId))
    .limit(1);
  if (rows.length === 0) return;
  const record = rows[0];
  if (record.isBanned) return; // already banned, don't overwrite manual ban reason
  if (
    record.isFree &&
    record.totalClaims >= MIN_CLAIMS_FOR_ACCURACY &&
    record.accuracyRate !== null &&
    record.accuracyRate !== undefined &&
    record.accuracyRate < HIGH_STAKES_ACCURACY_THRESHOLD
  ) {
    await db
      .update(llmProviderQuality)
      .set({
        allowedForHighStakes: false,
        banReason: `Auto-banned: accuracy ${(record.accuracyRate * 100).toFixed(1)}% < threshold ${(HIGH_STAKES_ACCURACY_THRESHOLD * 100).toFixed(0)}% after ${record.totalClaims} claims`,
        lastUpdatedAt: new Date(),
      })
      .where(eq(llmProviderQuality.modelId, modelId));
  }
}

/**
 * Recompute accuracy rates for all models.
 * Called by the calibration job or admin action.
 */
export async function recomputeAllAccuracyRates(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(llmProviderQuality)
    .set({
      accuracyRate: sql`CASE WHEN total_claims > 0 THEN correct_predictions / total_claims ELSE NULL END`,
      lastUpdatedAt: new Date(),
    } as never);
  // Auto-enforce bans for all free models below threshold
  const freeModels = await db
    .select({ modelId: llmProviderQuality.modelId })
    .from(llmProviderQuality)
    .where(eq(llmProviderQuality.isFree, true));
  for (const { modelId } of freeModels) {
    await autoEnforceBan(modelId);
  }
}

/**
 * Fetch all model quality stats for the admin panel.
 * Returns models ordered by accuracy rate descending.
 */
export async function getProviderQualityStats() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(llmProviderQuality)
    .orderBy(desc(llmProviderQuality.accuracyRate));
}

/**
 * Seed known models into the DB on startup.
 * This ensures the admin panel shows all models even before they've processed claims.
 */
export async function seedKnownModels(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const knownModels = [
    { modelId: "manus_builtin", modelName: "Manus Built-in LLM", provider: "manus_builtin", isFree: false },
    { modelId: "moonshot-v1-128k", modelName: "Kimi K2 (Moonshot)", provider: "kimi", isFree: false },
    { modelId: "openrouter/free", modelName: "OpenRouter Free Meta-Router", provider: "openrouter", isFree: true },
    { modelId: "moonshotai/kimi-k2.6:free", modelName: "Kimi K2.6 (Free)", provider: "openrouter", isFree: true },
    { modelId: "google/gemma-4-31b-it:free", modelName: "Gemma 4 31B (Free)", provider: "openrouter", isFree: true },
    { modelId: "meta-llama/llama-3.3-70b-instruct:free", modelName: "Llama 3.3 70B (Free)", provider: "openrouter", isFree: true },
    { modelId: "nvidia/nemotron-3-super-120b-a12b:free", modelName: "NVIDIA Nemotron 120B (Free)", provider: "openrouter", isFree: true },
    { modelId: "baidu/ernie-4.5-21b-a3b:free", modelName: "ERNIE 4.5 21B (Free)", provider: "openrouter", isFree: true },
    { modelId: "z-ai/glm-4.5-air:free", modelName: "GLM 4.5 Air (Free)", provider: "openrouter", isFree: true },
    { modelId: "openai/gpt-oss-20b:free", modelName: "GPT OSS 20B (Free)", provider: "openrouter", isFree: true },
  ];
  for (const m of knownModels) {
    await upsertModelRecord(m.modelId, m.modelName, m.provider, m.isFree);
  }
}
