/**
 * Platt Scaling Calibration Engine
 *
 * Replaces hand-tuned heuristic weights in predictionEngine.ts with
 * data-driven parameters learned from historical validated predictions.
 *
 * Algorithm:
 *   1. Collect (raw_score, actual_outcome) pairs from prediction_models
 *      where validationResult = 'correct' | 'incorrect'
 *   2. Fit logistic regression: P_calibrated = sigmoid(w * raw_score + b)
 *      using gradient descent on binary cross-entropy loss
 *   3. Also fit feature weights [w_claimType, w_author, w_entity, w_method]
 *      by minimising Brier score on the training set
 *   4. Store results in prediction_calibration (isActive = true)
 *   5. predictionEngine reads active calibration at startup (cached 1h)
 *
 * Minimum training set: 20 validated predictions before switching from priors.
 * Falls back to heuristic defaults if insufficient data.
 */

import { eq, and, isNotNull, desc } from "drizzle-orm";
import { getDb } from "./db";
import { predictionCalibration, predictionModels } from "../drizzle/schema";

// ─── Default heuristic weights (used when insufficient training data) ─────────
export const DEFAULT_FEATURE_WEIGHTS = [0.40, 0.25, 0.20, 0.15]; // [claimType, author, entity, method]
export const DEFAULT_PLATT_W = 1.0;
export const DEFAULT_PLATT_B = 0.0;
export const MIN_TRAINING_SAMPLES = 20;

// ─── In-memory cache (refreshed every hour) ──────────────────────────────────
interface CalibratedWeights {
  featureWeights: number[];
  plattW: number;
  plattB: number;
  trainingSampleSize: number;
  brierScore: number | null;
  logLoss: number | null;
  isDefault: boolean;
}

let calibrationCache: CalibratedWeights | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Sigmoid ──────────────────────────────────────────────────────────────────
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ─── Apply Platt scaling to a raw heuristic score ────────────────────────────
export function applyPlattScaling(rawScore: number, w: number, b: number): number {
  const calibrated = sigmoid(w * rawScore + b);
  return Math.min(0.95, Math.max(0.05, calibrated));
}

// ─── Brier score (mean squared error for probability predictions) ─────────────
export function computeBrierScore(predictions: number[], actuals: number[]): number {
  if (predictions.length === 0) return 1.0;
  const sum = predictions.reduce((acc, p, i) => acc + Math.pow(p - actuals[i]!, 2), 0);
  return sum / predictions.length;
}

// ─── Binary cross-entropy (log-loss) ─────────────────────────────────────────
export function computeLogLoss(predictions: number[], actuals: number[]): number {
  if (predictions.length === 0) return Infinity;
  const eps = 1e-7;
  const sum = predictions.reduce((acc, p, i) => {
    const y = actuals[i]!;
    return acc - (y * Math.log(p + eps) + (1 - y) * Math.log(1 - p + eps));
  }, 0);
  return sum / predictions.length;
}

// ─── Gradient descent for Platt scaling parameters ───────────────────────────
export function fitPlattScaling(
  rawScores: number[],
  actuals: number[],
  learningRate = 0.1,
  iterations = 1000
): { w: number; b: number } {
  let w = 1.0;
  let b = 0.0;
  const n = rawScores.length;

  for (let iter = 0; iter < iterations; iter++) {
    let dw = 0;
    let db = 0;

    for (let i = 0; i < n; i++) {
      const p = sigmoid(w * rawScores[i]! + b);
      const err = p - actuals[i]!;
      dw += err * rawScores[i]!;
      db += err;
    }

    w -= (learningRate / n) * dw;
    b -= (learningRate / n) * db;
  }

  return { w, b };
}

// ─── Fit feature weights via gradient descent on Brier score ─────────────────
export function fitFeatureWeights(
  featureMatrix: number[][],  // shape: [n_samples, 4]
  actuals: number[],
  learningRate = 0.05,
  iterations = 500
): number[] {
  // Start from default weights
  let weights = [...DEFAULT_FEATURE_WEIGHTS];
  const n = featureMatrix.length;

  for (let iter = 0; iter < iterations; iter++) {
    const gradients = [0, 0, 0, 0];

    for (let i = 0; i < n; i++) {
      const features = featureMatrix[i]!;
      // Raw score = dot product of weights and features
      const rawScore = weights.reduce((sum, w, j) => sum + w * features[j]!, 0);
      const p = Math.min(0.95, Math.max(0.05, rawScore));
      const err = p - actuals[i]!;

      for (let j = 0; j < 4; j++) {
        gradients[j]! += err * features[j]!;
      }
    }

    for (let j = 0; j < 4; j++) {
      weights[j]! -= (learningRate / n) * gradients[j]!;
      weights[j]! = Math.max(0.05, Math.min(0.60, weights[j]!)); // clip to [0.05, 0.60]
    }

    // Normalise weights to sum to 1.0
    const total = weights.reduce((s, w) => s + w, 0);
    weights = weights.map((w) => w / total);
  }

  return weights;
}

// ─── Load active calibration from DB (with cache) ────────────────────────────
export async function loadActiveCalibration(): Promise<CalibratedWeights> {
  const now = Date.now();
  if (calibrationCache && now - cacheLoadedAt < CACHE_TTL_MS) {
    return calibrationCache;
  }

  try {
    const db = await getDb();
    if (!db) throw new Error('DB unavailable');
    const [row] = await db
      .select()
      .from(predictionCalibration)
      .where(
        and(
          eq(predictionCalibration.modelType, "claim_trajectory"),
          eq(predictionCalibration.isActive, true)
        )
      )
      .orderBy(desc(predictionCalibration.createdAt))
      .limit(1);

    if (row && row.trainingSampleSize >= MIN_TRAINING_SAMPLES) {
      calibrationCache = {
        featureWeights: (row.featureWeights as number[]) ?? DEFAULT_FEATURE_WEIGHTS,
        plattW: row.plattW,
        plattB: row.plattB,
        trainingSampleSize: row.trainingSampleSize,
        brierScore: row.brierScore ?? null,
        logLoss: row.logLoss ?? null,
        isDefault: false,
      };
    } else {
      calibrationCache = {
        featureWeights: DEFAULT_FEATURE_WEIGHTS,
        plattW: DEFAULT_PLATT_W,
        plattB: DEFAULT_PLATT_B,
        trainingSampleSize: row?.trainingSampleSize ?? 0,
        brierScore: null,
        logLoss: null,
        isDefault: true,
      };
    }
  } catch {
    calibrationCache = {
      featureWeights: DEFAULT_FEATURE_WEIGHTS,
      plattW: DEFAULT_PLATT_W,
      plattB: DEFAULT_PLATT_B,
      trainingSampleSize: 0,
      brierScore: null,
      logLoss: null,
      isDefault: true,
    };
  }

  cacheLoadedAt = now;
  return calibrationCache;
}

// ─── Invalidate cache (called after calibration job runs) ────────────────────
export function invalidateCalibrationCache(): void {
  calibrationCache = null;
  cacheLoadedAt = 0;
}

// ─── Run calibration job: collect validated predictions and fit new weights ───
export async function runCalibrationJob(): Promise<{
  trainingSampleSize: number;
  brierScore: number;
  logLoss: number;
  featureWeights: number[];
  plattW: number;
  plattB: number;
  skipped: boolean;
  reason?: string;
}> {
  const db = await getDb();
  if (!db) throw new Error('DB unavailable');

  // Collect validated claim_trajectory predictions
  const validated = await db
    .select()
    .from(predictionModels)
    .where(
      and(
        eq(predictionModels.modelType, "claim_trajectory"),
        isNotNull(predictionModels.validationResult)
      )
    )
    .orderBy(desc(predictionModels.createdAt))
    .limit(500); // Use last 500 validated predictions

  const trainingData = validated.filter(
    (r) => r.validationResult === "correct" || r.validationResult === "incorrect"
  );

  if (trainingData.length < MIN_TRAINING_SAMPLES) {
    return {
      trainingSampleSize: trainingData.length,
      brierScore: 1.0,
      logLoss: Infinity,
      featureWeights: DEFAULT_FEATURE_WEIGHTS,
      plattW: DEFAULT_PLATT_W,
      plattB: DEFAULT_PLATT_B,
      skipped: true,
      reason: `Insufficient training data: ${trainingData.length} < ${MIN_TRAINING_SAMPLES} required`,
    };
  }

  // Extract raw scores and actuals
  const rawScores: number[] = [];
  const actuals: number[] = [];
  const featureMatrix: number[][] = [];

  for (const row of trainingData) {
    const pred = row.prediction as { probability?: number; features?: number[] };
    const rawScore = pred?.probability ?? 0.5;
    const actual = row.validationResult === "correct" ? 1 : 0;

    rawScores.push(rawScore);
    actuals.push(actual);

    // Extract feature vector if stored, otherwise use uniform features
    const features = (row.featuresUsed as number[] | null) ?? [rawScore, rawScore, rawScore, rawScore];
    featureMatrix.push(features.slice(0, 4));
  }

  // Fit Platt scaling
  const { w: plattW, b: plattB } = fitPlattScaling(rawScores, actuals);

  // Fit feature weights
  const featureWeights = fitFeatureWeights(featureMatrix, actuals);

  // Compute calibrated predictions for evaluation
  const calibratedPredictions = rawScores.map((s) => applyPlattScaling(s, plattW, plattB));
  const brierScore = computeBrierScore(calibratedPredictions, actuals);
  const logLoss = computeLogLoss(calibratedPredictions, actuals);

  // Deactivate old calibration rows for this model type
  await db
    .update(predictionCalibration)
    .set({ isActive: false })
    .where(eq(predictionCalibration.modelType, "claim_trajectory"));

  // Insert new active calibration
  await db.insert(predictionCalibration).values({
    modelType: "claim_trajectory",
    plattW,
    plattB,
    featureWeights,
    trainingSampleSize: trainingData.length,
    brierScore,
    logLoss,
    isActive: true,
  });

  // Invalidate cache so next prediction uses new weights
  invalidateCalibrationCache();

  return {
    trainingSampleSize: trainingData.length,
    brierScore,
    logLoss,
    featureWeights,
    plattW,
    plattB,
    skipped: false,
  };
}
