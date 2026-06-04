/**
 * claimQualityScorer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Quality scoring pipeline for Truth Desk claims.
 *
 * Scores every claim on a composite 0.0–1.0 scale derived from:
 *   1. Evidence strength   (0–0.40) — verdict, evidence URL, raw evidence
 *   2. Recency             (0–0.25) — how recently the evidence was checked
 *   3. Claim specificity   (0–0.20) — how specific/measurable the claim is
 *   4. Vertical confidence (0–0.15) — adapter-specific boost for high-quality verticals
 *
 * Flags are attached to explain any deductions, making the score auditable.
 *
 * Entry points:
 *   scoreOneClaim(claimId)     — score a single claim and persist
 *   scoreBatch(documentId)     — score all claims for a document (parallel, cap 8)
 *   runQualityScorerJob()      — score all unscored claims across all documents
 *
 * The scorer is intentionally deterministic — given the same claim data it
 * always produces the same score. This makes it safe to re-run idempotently.
 */
import { getDb } from "./db";
import { claims, documents } from "../drizzle/schema";
import { eq, isNull, and, lt, sql } from "drizzle-orm";

// ─── Scoring constants ────────────────────────────────────────────────────────

const WEIGHT_EVIDENCE_STRENGTH = 0.40;
const WEIGHT_RECENCY           = 0.25;
const WEIGHT_SPECIFICITY       = 0.20;
const WEIGHT_VERTICAL          = 0.15;

// Recency decay: claims checked within 30 days score full recency points.
// After 365 days they score 0.
const RECENCY_FULL_DAYS  = 30;
const RECENCY_ZERO_DAYS  = 365;

// Vertical quality tiers — higher-quality evidence verticals get a boost
const VERTICAL_QUALITY_TIER: Record<string, number> = {
  sports_nutrition_rct:   1.0,   // RCTs = highest evidence tier
  creatine_ergogenics:    0.90,
  protein_supplement:     0.85,
  collagen_peptides:      0.80,
  plant_based_protein:    0.80,
  gut_microbiome:         0.75,
  structural_biology:     0.90,
  salmon_biotech:         0.75,
};

// ─── Evidence strength scoring ────────────────────────────────────────────────

type Verdict =
  | "Supported"
  | "Contradicted"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Out of Scope"
  | "Needs Expert Review"
  | null;

function scoreEvidenceStrength(
  verdict: Verdict,
  evidenceUrl: string | null,
  evidenceRaw: unknown
): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;

  // Verdict component (0–0.25)
  switch (verdict) {
    case "Supported":
      score += 0.25;
      break;
    case "Partially Supported":
      score += 0.18;
      break;
    case "Ambiguous":
      score += 0.10;
      flags.push("ambiguous_verdict");
      break;
    case "Contradicted":
      score += 0.05;
      flags.push("contradicted_claim");
      break;
    case "Needs Expert Review":
      score += 0.08;
      flags.push("needs_expert_review");
      break;
    case "Insufficient Evidence":
    case "Out of Scope":
    case null:
      score += 0.02;
      flags.push("insufficient_evidence");
      break;
  }

  // Evidence URL component (0–0.08)
  if (evidenceUrl && evidenceUrl.length > 10) {
    score += 0.08;
  } else {
    flags.push("no_evidence_url");
  }

  // Raw evidence component (0–0.07)
  if (evidenceRaw && typeof evidenceRaw === "object") {
    const raw = evidenceRaw as Record<string, unknown>;
    const hasSubstantiveData = Object.keys(raw).length >= 3;
    if (hasSubstantiveData) {
      score += 0.07;
    } else {
      score += 0.03;
      flags.push("sparse_evidence_data");
    }
  } else {
    flags.push("no_raw_evidence");
  }

  return { score: Math.min(score, WEIGHT_EVIDENCE_STRENGTH), flags };
}

// ─── Recency scoring ──────────────────────────────────────────────────────────

function scoreRecency(checkedAt: Date | null): { score: number; flags: string[] } {
  const flags: string[] = [];
  if (!checkedAt) {
    flags.push("evidence_never_checked");
    return { score: 0, flags };
  }

  const ageMs = Date.now() - checkedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays <= RECENCY_FULL_DAYS) {
    return { score: WEIGHT_RECENCY, flags };
  }

  if (ageDays >= RECENCY_ZERO_DAYS) {
    flags.push("stale_evidence");
    return { score: 0, flags };
  }

  // Linear decay between RECENCY_FULL_DAYS and RECENCY_ZERO_DAYS
  const decay = 1 - (ageDays - RECENCY_FULL_DAYS) / (RECENCY_ZERO_DAYS - RECENCY_FULL_DAYS);
  if (ageDays > 90) flags.push("aging_evidence");
  return { score: WEIGHT_RECENCY * decay, flags };
}

// ─── Claim specificity scoring ────────────────────────────────────────────────

function scoreSpecificity(
  claimText: string,
  claimType: string,
  extractedValue: string | null
): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;

  // Specific claim types score higher
  const highSpecificityTypes = new Set(["pdb_id", "resolution", "experimental_method"]);
  const mediumSpecificityTypes = new Set(["protein_name", "organism", "ligand"]);

  if (highSpecificityTypes.has(claimType)) {
    score += 0.12;
  } else if (mediumSpecificityTypes.has(claimType)) {
    score += 0.08;
  } else {
    score += 0.04;
    flags.push("general_claim_type");
  }

  // Extracted value present = more specific
  if (extractedValue && extractedValue.length >= 2) {
    score += 0.05;
  } else {
    flags.push("no_extracted_value");
  }

  // Claim text length heuristic — very short claims are vague
  if (claimText.length < 30) {
    score -= 0.03;
    flags.push("very_short_claim");
  } else if (claimText.length >= 80) {
    score += 0.03;
  }

  // Numeric values in claim text = higher specificity
  if (/\d+(\.\d+)?\s*(Å|kDa|mg|g|%|nm|mM|µM|nM|Hz|Da|kcal)/.test(claimText)) {
    score += 0.02;
  }

  return { score: Math.min(Math.max(score, 0), WEIGHT_SPECIFICITY), flags };
}

// ─── Vertical quality scoring ─────────────────────────────────────────────────

function scoreVertical(verticalDomain: string): { score: number; flags: string[] } {
  const tier = VERTICAL_QUALITY_TIER[verticalDomain] ?? 0.70;
  const score = WEIGHT_VERTICAL * tier;
  const flags: string[] = [];
  if (tier < 0.75) flags.push("lower_evidence_vertical");
  return { score, flags };
}

// ─── Composite scorer ─────────────────────────────────────────────────────────

export interface ClaimQualityScore {
  claimId: number;
  compositeScore: number;  // 0.0–1.0
  evidenceScore: number;
  recencyScore: number;
  specificityScore: number;
  verticalScore: number;
  flags: string[];
}

export function computeClaimScore(claim: {
  id: number;
  verdict: Verdict;
  pdbEvidenceUrl: string | null;
  pdbEvidenceRaw: unknown;
  pdbEvidenceCheckedAt: Date | null;
  claimType: string;
  claimText: string;
  extractedValue: string | null;
  verticalDomain: string;
}): ClaimQualityScore {
  const { score: evidenceScore, flags: evidenceFlags } = scoreEvidenceStrength(
    claim.verdict,
    claim.pdbEvidenceUrl,
    claim.pdbEvidenceRaw
  );
  const { score: recencyScore, flags: recencyFlags } = scoreRecency(claim.pdbEvidenceCheckedAt);
  const { score: specificityScore, flags: specificityFlags } = scoreSpecificity(
    claim.claimText,
    claim.claimType,
    claim.extractedValue
  );
  const { score: verticalScore, flags: verticalFlags } = scoreVertical(claim.verticalDomain);

  const compositeScore = Math.min(
    1.0,
    evidenceScore + recencyScore + specificityScore + verticalScore
  );

  return {
    claimId: claim.id,
    compositeScore: Math.round(compositeScore * 1000) / 1000,
    evidenceScore: Math.round(evidenceScore * 1000) / 1000,
    recencyScore: Math.round(recencyScore * 1000) / 1000,
    specificityScore: Math.round(specificityScore * 1000) / 1000,
    verticalScore: Math.round(verticalScore * 1000) / 1000,
    flags: [...evidenceFlags, ...recencyFlags, ...specificityFlags, ...verticalFlags],
  };
}

// ─── Persist score to DB ──────────────────────────────────────────────────────

async function persistScore(score: ClaimQualityScore): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(claims)
    .set({
      confidenceScore: score.compositeScore,
      confidenceFlags: score.flags,
    })
    .where(eq(claims.id, score.claimId));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Score a single claim by ID. Fetches the claim + its document's vertical,
 * computes the score, and persists it.
 */
export async function scoreOneClaim(claimId: number): Promise<ClaimQualityScore | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select({
      id: claims.id,
      verdict: claims.verdict,
      pdbEvidenceUrl: claims.pdbEvidenceUrl,
      pdbEvidenceRaw: claims.pdbEvidenceRaw,
      pdbEvidenceCheckedAt: claims.pdbEvidenceCheckedAt,
      claimType: claims.claimType,
      claimText: claims.claimText,
      extractedValue: claims.extractedValue,
      verticalDomain: documents.verticalDomain,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(eq(claims.id, claimId))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];

  const score = computeClaimScore({
    id: row.id,
    verdict: row.verdict as Verdict,
    pdbEvidenceUrl: row.pdbEvidenceUrl ?? null,
    pdbEvidenceRaw: row.pdbEvidenceRaw,
    pdbEvidenceCheckedAt: row.pdbEvidenceCheckedAt ?? null,
    claimType: row.claimType,
    claimText: row.claimText,
    extractedValue: row.extractedValue ?? null,
    verticalDomain: row.verticalDomain,
  });

  await persistScore(score);
  return score;
}

/**
 * Score all claims for a given document. Runs in parallel with concurrency cap.
 */
export async function scoreBatch(documentId: number): Promise<ClaimQualityScore[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: claims.id,
      verdict: claims.verdict,
      pdbEvidenceUrl: claims.pdbEvidenceUrl,
      pdbEvidenceRaw: claims.pdbEvidenceRaw,
      pdbEvidenceCheckedAt: claims.pdbEvidenceCheckedAt,
      claimType: claims.claimType,
      claimText: claims.claimText,
      extractedValue: claims.extractedValue,
      verticalDomain: documents.verticalDomain,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(eq(claims.documentId, documentId));

  const CONCURRENCY = 8;
  const results: ClaimQualityScore[] = [];

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (row) => {
        const score = computeClaimScore({
          id: row.id,
          verdict: row.verdict as Verdict,
          pdbEvidenceUrl: row.pdbEvidenceUrl ?? null,
          pdbEvidenceRaw: row.pdbEvidenceRaw,
          pdbEvidenceCheckedAt: row.pdbEvidenceCheckedAt ?? null,
          claimType: row.claimType,
          claimText: row.claimText,
          extractedValue: row.extractedValue ?? null,
          verticalDomain: row.verticalDomain,
        });
        await persistScore(score);
        return score;
      })
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }

  return results;
}

/**
 * Background job: score all claims that have no confidenceScore yet,
 * or whose evidence was checked more than 7 days ago (stale re-score).
 *
 * Processes up to 500 claims per run to avoid long-running jobs.
 */
export async function runQualityScorerJob(): Promise<{
  scored: number;
  errors: number;
  durationMs: number;
}> {
  const startMs = Date.now();
  const db = await getDb();
  if (!db) return { scored: 0, errors: 0, durationMs: 0 };

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Find claims that need scoring: unscored OR evidence checked > 7 days ago
  const claimsToScore = await db
    .select({
      id: claims.id,
      verdict: claims.verdict,
      pdbEvidenceUrl: claims.pdbEvidenceUrl,
      pdbEvidenceRaw: claims.pdbEvidenceRaw,
      pdbEvidenceCheckedAt: claims.pdbEvidenceCheckedAt,
      claimType: claims.claimType,
      claimText: claims.claimText,
      extractedValue: claims.extractedValue,
      verticalDomain: documents.verticalDomain,
    })
    .from(claims)
    .innerJoin(documents, eq(claims.documentId, documents.id))
    .where(
      sql`(${claims.confidenceScore} IS NULL OR ${claims.pdbEvidenceCheckedAt} < ${sevenDaysAgo})`
    )
    .limit(500);

  let scored = 0;
  let errors = 0;
  const CONCURRENCY = 8;

  for (let i = 0; i < claimsToScore.length; i += CONCURRENCY) {
    const batch = claimsToScore.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (row) => {
        const score = computeClaimScore({
          id: row.id,
          verdict: row.verdict as Verdict,
          pdbEvidenceUrl: row.pdbEvidenceUrl ?? null,
          pdbEvidenceRaw: row.pdbEvidenceRaw,
          pdbEvidenceCheckedAt: row.pdbEvidenceCheckedAt ?? null,
          claimType: row.claimType,
          claimText: row.claimText,
          extractedValue: row.extractedValue ?? null,
          verticalDomain: row.verticalDomain,
        });
        await persistScore(score);
      })
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") scored++;
      else errors++;
    }
  }

  const durationMs = Date.now() - startMs;
  console.log(`[QualityScorer] Scored ${scored} claims in ${durationMs}ms (${errors} errors)`);
  return { scored, errors, durationMs };
}
