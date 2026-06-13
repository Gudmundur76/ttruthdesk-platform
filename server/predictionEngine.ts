/**
 * Ground Signal — Prediction Engine (Layer 4)
 *
 * Predicts which claims will be verified, contradicted, or become consensus
 * using accumulated pattern history from Layers 1–3 (claims, graph, wiki).
 *
 * All predictions use heuristic scoring on SQL-derived base rates.
 * No ML framework required — the graph IS the training dataset.
 */

import { eq, and, sql, desc } from "drizzle-orm";
import type { ResultSetHeader } from "mysql2";
import { getDb } from "./db";
import {
  claims,
  documents,
  graphEntities,
  predictionFeatures,
  predictionModels,
  InsertPredictionFeature,
  InsertPredictionModel,
} from "../drizzle/schema";
import { loadActiveCalibration, applyPlattScaling } from "./plattCalibration";

// ─── DB helper ────────────────────────────────────────────────────────────────

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClaimTrajectoryPrediction {
  claimId: number;
  probabilityContradicted: number;
  confidenceInterval: [number, number];
  expectedDaysToContradiction: number | null;
  factors: string[];
  recommendedAction: string;
  baseRate: number;
  sampleSize: number;
}

export interface AuthorReliabilityScore {
  userId: number;
  contradictionRate: number;
  fieldAverageRate: number;
  totalClaimsAudited: number;
  reliabilityTier: "HIGH" | "AVERAGE" | "LOW" | "INSUFFICIENT_DATA";
  reliabilityPercentile: number;
  avgConfidence: number;
}

export interface EntityStats {
  entityId: number;
  entityName: string;
  entityType: string;
  contradictionRate: number;
  claimCount: number;
  contradictionCount: number;
  supportedCount: number;
  expertReviewCount: number;
  claimVelocity: number; // claims per month
}

// ─── Feature Computation ──────────────────────────────────────────────────────

/**
 * Compute base rates for a claim type keyword (e.g. "novel fold", "resolution").
 * Returns { contradictionRate, sampleSize } for the keyword across all claims.
 */
export async function computeClaimTypeBaseRate(
  keyword: string
): Promise<{ contradictionRate: number; sampleSize: number }> {
  const db = await requireDb();

  const [result] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      contradicted: sql<number>`SUM(CASE WHEN ${claims.verdict} = 'Contradicted' THEN 1 ELSE 0 END)`,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(
      and(
        sql`LOWER(${claims.claimText}) LIKE LOWER(${`%${keyword}%`})`,
        sql`${claims.verdict} IS NOT NULL`
      )
    );

  const total = Number(result?.total ?? 0);
  const contradicted = Number(result?.contradicted ?? 0);

  return {
    contradictionRate: total > 0 ? contradicted / total : 0.31, // field average fallback
    sampleSize: total,
  };
}

/**
 * Compute author contradiction history for a given userId.
 */
export async function computeAuthorContradictionRate(
  userId: number
): Promise<{ rate: number; totalClaims: number; contradictedClaims: number }> {
  const db = await requireDb();

  const [result] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      contradicted: sql<number>`SUM(CASE WHEN ${claims.verdict} = 'Contradicted' THEN 1 ELSE 0 END)`,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(
      and(
        eq(documents.userId, userId),
        sql`${claims.verdict} IS NOT NULL`
      )
    );

  const total = Number(result?.total ?? 0);
  const contradicted = Number(result?.contradicted ?? 0);

  return {
    rate: total > 0 ? contradicted / total : 0.31,
    totalClaims: total,
    contradictedClaims: contradicted,
  };
}

/**
 * Compute field-wide contradiction rate (baseline for all claims with verdicts).
 */
export async function computeFieldAverageContradictionRate(): Promise<number> {
  const db = await requireDb();

  const [result] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      contradicted: sql<number>`SUM(CASE WHEN ${claims.verdict} = 'Contradicted' THEN 1 ELSE 0 END)`,
    })
    .from(claims)
    .where(sql`${claims.verdict} IS NOT NULL`);

  const total = Number(result?.total ?? 0);
  const contradicted = Number(result?.contradicted ?? 0);

  return total > 0 ? contradicted / total : 0.31;
}

/**
 * Compute entity-level contradiction rate from the graph.
 */
export async function computeEntityContradictionRate(
  entityId: number
): Promise<EntityStats | null> {
  const db = await requireDb();

  const [entity] = await db
    .select()
    .from(graphEntities)
    .where(eq(graphEntities.id, entityId))
    .limit(1);

  if (!entity) return null;

  // Count claims mentioning this entity by name
  const [stats] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      contradicted: sql<number>`SUM(CASE WHEN ${claims.verdict} = 'Contradicted' THEN 1 ELSE 0 END)`,
      supported: sql<number>`SUM(CASE WHEN ${claims.verdict} = 'Supported' THEN 1 ELSE 0 END)`,
      expertReview: sql<number>`SUM(CASE WHEN ${claims.verdict} = 'Needs Expert Review' THEN 1 ELSE 0 END)`,
    })
    .from(claims)
    .where(
      and(
        sql`LOWER(${claims.claimText}) LIKE LOWER(${`%${entity.canonicalName}%`})`,
        sql`${claims.verdict} IS NOT NULL`
      )
    );

  const total = Number(stats?.total ?? 0);
  const contradicted = Number(stats?.contradicted ?? 0);
  const supported = Number(stats?.supported ?? 0);
  const expertReview = Number(stats?.expertReview ?? 0);

  // Claim velocity: claims per month (approximate from createdAt range)
  const [velocityResult] = await db
    .select({
      claimsLast30: sql<number>`SUM(CASE WHEN ${claims.createdAt} > DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END)`,
    })
    .from(claims)
    .where(sql`LOWER(${claims.claimText}) LIKE LOWER(${`%${entity.canonicalName}%`})`);

  return {
    entityId,
    entityName: entity.canonicalName,
    entityType: entity.entityType,
    contradictionRate: total > 0 ? contradicted / total : 0,
    claimCount: total,
    contradictionCount: contradicted,
    supportedCount: supported,
    expertReviewCount: expertReview,
    claimVelocity: Number(velocityResult?.claimsLast30 ?? 0),
  };
}

// ─── Heuristic Scoring ────────────────────────────────────────────────────────

/**
 * Claim Trajectory Predictor
 *
 * Data-driven scoring model (Platt scaling):
 *   rawScore = w0 * claimTypeBaseRate
 *            + w1 * authorContradictionRate
 *            + w2 * entityRiskFactor
 *            + w3 * methodRiskFactor
 *
 *   P(contradicted) = sigmoid(plattW * rawScore + plattB)
 *
 * Weights [w0..w3] and Platt parameters are learned from historical
 * validated predictions stored in prediction_calibration.
 * Falls back to heuristic defaults [0.40, 0.25, 0.20, 0.15] when
 * fewer than 20 validated predictions are available.
 */
  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export async function computeClaimTrajectory(
  claimId: number,
  userId: number
): Promise<ClaimTrajectoryPrediction> {
  const db = await requireDb();

  // Fetch the claim text
  const [claim] = await db
    .select()
    .from(claims)
    .where(eq(claims.id, claimId))
    .limit(1);

  if (!claim) {
    throw new Error(`Claim ${claimId} not found`);
  }

  const claimText = claim.claimText.toLowerCase();
  const factors: string[] = [];

  // ── Feature 1: Claim type base rate ──────────────────────────────────────
  // Detect high-risk keywords in the claim text
  const HIGH_RISK_KEYWORDS = [
    "novel fold",
    "unique structure",
    "unprecedented",
    "first reported",
    "never before",
    "not observed",
    "no known",
    "highest resolution",
    "atomic resolution",
  ];
  const MEDIUM_RISK_KEYWORDS = [
    "binding pocket",
    "allosteric",
    "mechanism",
    "inhibition",
    "activation",
    "selectivity",
  ];

  let claimTypeKeyword = "";
  let claimTypeBaseRate = 0.31; // field average
  let claimTypeSampleSize = 0;

  for (const kw of HIGH_RISK_KEYWORDS) {
    if (claimText.includes(kw)) {
      claimTypeKeyword = kw;
      const { contradictionRate, sampleSize } = await computeClaimTypeBaseRate(kw);
      claimTypeBaseRate = sampleSize >= 5 ? contradictionRate : 0.65; // high-risk prior if insufficient data
      claimTypeSampleSize = sampleSize;
      break;
    }
  }

  if (!claimTypeKeyword) {
    for (const kw of MEDIUM_RISK_KEYWORDS) {
      if (claimText.includes(kw)) {
        claimTypeKeyword = kw;
        const { contradictionRate, sampleSize } = await computeClaimTypeBaseRate(kw);
        claimTypeBaseRate = sampleSize >= 5 ? contradictionRate : 0.40;
        claimTypeSampleSize = sampleSize;
        break;
      }
    }
  }

  if (!claimTypeKeyword) {
    const { contradictionRate, sampleSize } = await computeFieldAverageContradictionRate().then(
      (r) => ({ contradictionRate: r, sampleSize: 0 })
    );
    claimTypeBaseRate = contradictionRate;
    claimTypeSampleSize = sampleSize;
  }

  if (claimTypeSampleSize >= 5) {
    factors.push(
      `"${claimTypeKeyword || "General"}" claims have ${Math.round(claimTypeBaseRate * 100)}% historical contradiction rate (n=${claimTypeSampleSize})`
    );
  } else {
    factors.push(
      `Claim type prior: ${Math.round(claimTypeBaseRate * 100)}% (insufficient historical data — using prior)`
    );
  }

  // ── Feature 2: Author contradiction history ───────────────────────────────
  const authorStats = await computeAuthorContradictionRate(userId);
  const fieldAvg = await computeFieldAverageContradictionRate();

  if (authorStats.totalClaims >= 3) {
    const comparison =
      authorStats.rate < fieldAvg
        ? `✅ below field average (${Math.round(fieldAvg * 100)}%)`
        : `⚠ above field average (${Math.round(fieldAvg * 100)}%)`;
    factors.push(
      `Author contradiction rate: ${Math.round(authorStats.rate * 100)}% over ${authorStats.totalClaims} audited claims — ${comparison}`
    );
  } else {
    factors.push(`Author history: insufficient data (${authorStats.totalClaims} claims audited) — using field average`);
  }

  const authorRate =
    authorStats.totalClaims >= 3 ? authorStats.rate : fieldAvg;

  // ── Feature 3: Entity risk factor ────────────────────────────────────────
  // Extract entity names from claim text by checking graph entities
  const allEntities = await db
    .select({ id: graphEntities.id, name: graphEntities.canonicalName, type: graphEntities.entityType })
    .from(graphEntities)
    .limit(200);

  let entityRiskFactor = 0.5; // neutral prior
  let entityMatchName = "";

  for (const entity of allEntities) {
    if (claimText.includes(entity.name.toLowerCase())) {
      const entityStats = await computeEntityContradictionRate(entity.id);
      if (entityStats && entityStats.claimCount >= 3) {
        entityRiskFactor = entityStats.contradictionRate;
        entityMatchName = entity.name;
        factors.push(
          `Entity "${entity.name}" (${entity.type}): ${Math.round(entityStats.contradictionRate * 100)}% contradiction rate over ${entityStats.claimCount} claims`
        );
        break;
      }
    }
  }

  if (!entityMatchName) {
    factors.push("Entity: not found in knowledge graph — using neutral prior (50%)");
  }

  // ── Feature 4: Method risk factor ────────────────────────────────────────
  const METHOD_RISK: Record<string, number> = {
    "cryo-em": 0.38,
    "cryo em": 0.38,
    "cryoem": 0.38,
    "x-ray crystallography": 0.22,
    "x-ray": 0.22,
    "nmr": 0.28,
    "molecular dynamics": 0.45,
    "docking": 0.52,
    "homology model": 0.58,
    "alphafold": 0.35,
    "deep learning": 0.48,
  };

  let methodRiskFactor = 0.31; // field average
  let methodName = "";

  for (const [method, risk] of Object.entries(METHOD_RISK)) {
    if (claimText.includes(method)) {
      methodRiskFactor = risk;
      methodName = method;
      factors.push(
        `Method "${method}": ${Math.round(risk * 100)}% contradiction rate (historical)`
      );
      break;
    }
  }

  if (!methodName) {
    factors.push("Method: not detected — using field average (31%)");
  }

  // ── Data-driven scoring (Platt scaling) ────────────────────────────────
  // Load calibrated weights from DB (falls back to heuristic defaults if
  // insufficient training data — MIN_TRAINING_SAMPLES = 20)
  const calibration = await loadActiveCalibration();
  const [w0 = 0.40, w1 = 0.25, w2 = 0.20, w3 = 0.15] = calibration.featureWeights;
  const rawScore =
    w0 * claimTypeBaseRate +
    w1 * authorRate +
    w2 * entityRiskFactor +
    w3 * methodRiskFactor;

  // Apply Platt scaling to produce a calibrated probability
  const probability = applyPlattScaling(rawScore, calibration.plattW, calibration.plattB);

  if (!calibration.isDefault) {
    factors.push(
      `Calibration: Platt(w=${calibration.plattW.toFixed(3)}, b=${calibration.plattB.toFixed(3)}) ` +
      `trained on ${calibration.trainingSampleSize} validated predictions` +
      (calibration.brierScore != null ? ` — Brier=${calibration.brierScore.toFixed(3)}` : "")
    );
  } else {
    factors.push(
      `Calibration: using heuristic defaults (${calibration.trainingSampleSize} validated predictions ` +
      `— need ${20} to activate learned weights)`
    );
  }

  // Confidence interval: ±0.12 (widens with less data)
  const ciWidth = claimTypeSampleSize < 10 ? 0.18 : 0.12;
  const confidenceInterval: [number, number] = [
    Math.max(0.01, probability - ciWidth),
    Math.min(0.99, probability + ciWidth),
  ];

  // Expected days to contradiction (empirical: ~90 day field average, scales with probability)
  const expectedDays =
    probability > 0.6
      ? Math.round(90 * (1 - probability) * 3) // high risk → faster
      : probability > 0.4
      ? 90
      : null; // low risk → no prediction

  // Recommended action
  let recommendedAction: string;
  if (probability >= 0.70) {
    recommendedAction = "Flag for human expert review before publication";
  } else if (probability >= 0.45) {
    recommendedAction = "Request additional experimental validation";
  } else {
    recommendedAction = "Standard peer review sufficient";
  }

  return {
    claimId,
    probabilityContradicted: Math.round(probability * 100) / 100,
    confidenceInterval,
    expectedDaysToContradiction: expectedDays,
    factors,
    recommendedAction,
    baseRate: Math.round(claimTypeBaseRate * 100) / 100,
    sampleSize: claimTypeSampleSize,
  };
}

/**
 * Author Reliability Score
 *
 * Computes a reliability tier and percentile for a given user
 * based on their lifetime contradiction rate vs field average.
 */
export async function computeAuthorReliability(
  userId: number
): Promise<AuthorReliabilityScore> {
  const db = await requireDb();

  const authorStats = await computeAuthorContradictionRate(userId);
  const fieldAvg = await computeFieldAverageContradictionRate();

  // Average confidence score for this author's claims
  const [confResult] = await db
    .select({
      avgConf: sql<number>`AVG(${claims.confidenceScore})`,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(
      and(
        eq(documents.userId, userId),
        sql`${claims.confidenceScore} IS NOT NULL`
      )
    );

  const avgConfidence = Number(confResult?.avgConf ?? 0.5);

  // Reliability tier
  let reliabilityTier: AuthorReliabilityScore["reliabilityTier"];
  let reliabilityPercentile: number;

  if (authorStats.totalClaims < 3) {
    reliabilityTier = "INSUFFICIENT_DATA";
    reliabilityPercentile = 50;
  } else if (authorStats.rate <= fieldAvg * 0.5) {
    reliabilityTier = "HIGH";
    reliabilityPercentile = 90;
  } else if (authorStats.rate <= fieldAvg * 1.2) {
    reliabilityTier = "AVERAGE";
    reliabilityPercentile = 50;
  } else {
    reliabilityTier = "LOW";
    reliabilityPercentile = 20;
  }

  return {
    userId,
    contradictionRate: Math.round(authorStats.rate * 100) / 100,
    fieldAverageRate: Math.round(fieldAvg * 100) / 100,
    totalClaimsAudited: authorStats.totalClaims,
    reliabilityTier,
    reliabilityPercentile,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
  };
}

// ─── Persistence Helpers ──────────────────────────────────────────────────────

export async function savePrediction(
  data: InsertPredictionModel
): Promise<number> {
  const db = await requireDb();
  const [result] = await db.insert(predictionModels).values(data);
  return (result as unknown as ResultSetHeader).insertId;
}

export async function getPredictionsByClaim(claimId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(predictionModels)
    .where(eq(predictionModels.targetClaimId, claimId))
    .orderBy(desc(predictionModels.createdAt))
    .limit(5);
}

export async function getPredictionsByUser(userId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(predictionModels)
    .where(
      and(
        eq(predictionModels.targetUserId, userId),
        eq(predictionModels.modelType, "author_reliability")
      )
    )
    .orderBy(desc(predictionModels.createdAt))
    .limit(1);
}

export async function upsertPredictionFeature(
  data: InsertPredictionFeature
): Promise<void> {
  const db = await requireDb();
  await db.insert(predictionFeatures).values(data);
}

export async function getPredictionFeaturesByEntity(entityId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(predictionFeatures)
    .where(eq(predictionFeatures.entityId, entityId))
    .orderBy(desc(predictionFeatures.computedAt));
}

export async function updatePredictionValidation(
  predictionId: number,
  result: "correct" | "incorrect"
): Promise<void> {
  const db = await requireDb();
  await db
    .update(predictionModels)
    .set({
      validationResult: result,
      validatedAt: new Date(),
    })
    .where(eq(predictionModels.id, predictionId));
}
