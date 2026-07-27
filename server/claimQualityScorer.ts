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
import { eq, sql } from "drizzle-orm";
import { invokeLargeContextLLMJson } from "./_core/llmLargeContext.js";
import { logger } from "./logger";
const log = logger("claimQualityScorer");

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


// ─── FrictionEngine Gates ─────────────────────────────────────────────────────
//
// Three deterministic gates derived from FrictionEngine's cognitive architecture:
//
//   Intent Gate        — Does this claim address the paper's actual research question?
//   Assumption Gate    — Are the experimental assumptions named in the methods?
//   Falsification Gate — What evidence would prove this claim wrong?
//
// Each gate is a DEDUCTION from the composite score (not an additive component).
// This keeps the existing 0–1 scale intact while surfacing epistemic weaknesses.

/**
 * Intent Gate: Deduct 0.05 if the claim is off-topic relative to the document's
 * vertical domain. A structural biology document making a clinical efficacy claim
 * is out of scope — the claim may be technically accurate but epistemically misplaced.
 */
function applyIntentGate(
  claimType: string,
  verticalDomain: string
): { deduction: number; flags: string[] } {
  const flags: string[] = [];
  let deduction = 0;

  const outOfScopeMap: Record<string, string[]> = {
    structural_biology: ["clinical_efficacy", "regulatory_approval", "market_claim"],
    salmon_biotech:     ["human_clinical", "regulatory_approval"],
    sports_nutrition_rct: ["structural_property", "molecular_mechanism"],
  };

  const blocked = outOfScopeMap[verticalDomain] ?? [];
  if (blocked.includes(claimType)) {
    deduction = 0.05;
    flags.push("intent_gate_out_of_scope");
  }

  return { deduction, flags };
}

/**
 * Assumption Gate: Deduct 0.05 if the claim text contains assumption-smuggling
 * language patterns — phrases that assert a conclusion without citing evidence.
 */
function applyAssumptionGate(claimText: string): { deduction: number; flags: string[] } {
  const flags: string[] = [];
  let deduction = 0;

  const smugglingPatterns = [
    /\bis the primary driver\b/i,
    /\bclearly demonstrates?\b/i,
    /\bproves? that\b/i,
    /\bundeniably\b/i,
    /\bwithout doubt\b/i,
    /\bconclusive(?:ly)?\b/i,
    /\bestablishes? that\b/i,
    /\bconfirms? that\b/i,
    /\bshows? that .{0,30} is (?:the|a) (?:cause|driver|mechanism)\b/i,
  ];

  if (smugglingPatterns.some((p) => p.test(claimText))) {
    deduction = 0.05;
    flags.push("assumption_gate_smuggled_premise");
  }

  return { deduction, flags };
}

/**
 * Falsification Gate: Deduct 0.05 if the claim is not falsifiable — i.e., it
 * contains no measurable value, identifier, or testable assertion that could
 * be contradicted by database evidence.
 */
function applyFalsificationGate(
  extractedValue: string | null,
  claimType: string
): { deduction: number; flags: string[] } {
  const flags: string[] = [];
  let deduction = 0;

  const unfalsifiableTypes = ["opinion", "narrative", "general_statement", "market_claim"];

  if (unfalsifiableTypes.includes(claimType)) {
    deduction = 0.05;
    flags.push("falsification_gate_unfalsifiable_type");
  } else if (!extractedValue || extractedValue.trim().length === 0) {
    deduction = 0.03;
    flags.push("falsification_gate_no_measurable_value");
  }

  return { deduction, flags };
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

  // ── FrictionEngine gates (deductions) ────────────────────────────────────
  const { deduction: intentDeduction, flags: intentFlags } = applyIntentGate(
    claim.claimType,
    claim.verticalDomain
  );
  const { deduction: assumptionDeduction, flags: assumptionFlags } = applyAssumptionGate(
    claim.claimText
  );
  const { deduction: falsificationDeduction, flags: falsificationFlags } = applyFalsificationGate(
    claim.extractedValue,
    claim.claimType
  );

  const totalDeduction = intentDeduction + assumptionDeduction + falsificationDeduction;

  const compositeScore = Math.min(
    1.0,
    Math.max(0, evidenceScore + recencyScore + specificityScore + verticalScore - totalDeduction)
  );

  return {
    claimId: claim.id,
    compositeScore: Math.round(compositeScore * 1000) / 1000,
    evidenceScore: Math.round(evidenceScore * 1000) / 1000,
    recencyScore: Math.round(recencyScore * 1000) / 1000,
    specificityScore: Math.round(specificityScore * 1000) / 1000,
    verticalScore: Math.round(verticalScore * 1000) / 1000,
    flags: [
      ...evidenceFlags, ...recencyFlags, ...specificityFlags, ...verticalFlags,
      ...intentFlags, ...assumptionFlags, ...falsificationFlags,
    ],
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
  log.info(`[QualityScorer] Scored ${scored} claims in ${durationMs}ms (${errors} errors)`);
  return { scored, errors, durationMs };
}

// ─── LLM-enhanced scoring (Kimi large-context) ───────────────────────────────

/**
 * LLM-enhanced quality score for a single claim.
 *
 * Uses Kimi's large-context model to evaluate three semantic dimensions:
 *   - methodologyRigor   (0–1): Is the underlying study design sound?
 *   - claimPrecision     (0–1): Is the claim specific and falsifiable?
 *   - evidenceAlignment  (0–1): Does the evidence actually support the claim?
 *
 * The LLM score is blended with the deterministic score (70 % deterministic,
 * 30 % LLM) so that the result is still grounded in structured evidence data.
 *
 * Falls back to the deterministic score when Kimi is unavailable.
 */
export async function scoreClaimWithLLM(claim: {
  id: number;
  claimText: string;
  verdict: string | null;
  claimType: string;
  verticalDomain: string;
  pdbEvidenceUrl: string | null;
  extractedValue: string | null;
  pdbEvidenceCheckedAt: Date | null;
  pdbEvidenceRaw: unknown;
}): Promise<ClaimQualityScore & { llmEnhanced: boolean }> {
  // Always compute the deterministic base score first
  const base = computeClaimScore({
    id: claim.id,
    verdict: claim.verdict as Verdict,
    pdbEvidenceUrl: claim.pdbEvidenceUrl,
    pdbEvidenceRaw: claim.pdbEvidenceRaw,
    pdbEvidenceCheckedAt: claim.pdbEvidenceCheckedAt,
    claimType: claim.claimType,
    claimText: claim.claimText,
    extractedValue: claim.extractedValue,
    verticalDomain: claim.verticalDomain,
  });

  try {
    const { data } = await invokeLargeContextLLMJson<{
      methodologyRigor: number;
      claimPrecision: number;
      evidenceAlignment: number;
      reasoning: string;
    }>(
      [
        {
          role: "system",
          content:
            "You are a biomedical research quality assessor specialising in protein science, " +
            "nutrition research, and structural biology. Evaluate the claim below on three " +
            "dimensions and return a JSON object with numeric scores 0–1 and a brief reasoning string.",
        },
        {
          role: "user",
          content:
            `Claim: "${claim.claimText}"\n` +
            `Claim type: ${claim.claimType}\n` +
            `Vertical domain: ${claim.verticalDomain}\n` +
            `Current verdict: ${claim.verdict ?? "unverified"}\n` +
            `Evidence URL: ${claim.pdbEvidenceUrl ?? "none"}\n` +
            `Extracted value: ${claim.extractedValue ?? "none"}\n\n` +
            "Return JSON: { methodologyRigor: 0-1, claimPrecision: 0-1, evidenceAlignment: 0-1, reasoning: string }",
        },
      ],
      {
        name: "claim_quality_assessment",
        strict: true,
        schema: {
          type: "object",
          properties: {
            methodologyRigor: { type: "number" },
            claimPrecision: { type: "number" },
            evidenceAlignment: { type: "number" },
            reasoning: { type: "string" },
          },
          required: ["methodologyRigor", "claimPrecision", "evidenceAlignment", "reasoning"],
          additionalProperties: false,
        },
      }
    );

    // Clamp LLM scores to [0, 1]
    const llmScore =
      (Math.min(1, Math.max(0, data.methodologyRigor)) +
        Math.min(1, Math.max(0, data.claimPrecision)) +
        Math.min(1, Math.max(0, data.evidenceAlignment))) /
      3;

    // Blend: 70% deterministic + 30% LLM
    const blended = Math.round((base.compositeScore * 0.7 + llmScore * 0.3) * 1000) / 1000;

    return {
      ...base,
      compositeScore: blended,
      flags: [
        ...base.flags,
        `llm_reasoning:${data.reasoning.slice(0, 120)}`,
      ],
      llmEnhanced: true,
    };
  } catch {
    // Kimi unavailable or returned bad data — return deterministic score unchanged
    return { ...base, llmEnhanced: false };
  }
}
