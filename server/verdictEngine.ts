/**
 * verdictEngine.ts — Deterministic Verdict Engine
 *
 * This module contains ALL verdict classification logic as pure, testable
 * functions with no side effects. It is the single source of truth for how
 * a verdict is assigned.
 *
 * Design principles:
 *   1. Every verdict must be traceable to a specific evidence comparison.
 *   2. No LLM calls — verdicts are computed from structured source data.
 *   3. "Insufficient Evidence" is the honest default when data is absent.
 *   4. Thresholds are named constants, not magic numbers.
 *
 * The pipeline (analysisPipeline.ts) calls these functions and records
 * the verdict method in claim_provenance_events for full auditability.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type VerdictType =
  | "Supported"
  | "Contradicted"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Out of Scope"
  | "Needs Expert Review";

/**
 * How the verdict was determined.
 * - "deterministic_source": exact comparison against authoritative source data
 * - "confidence_threshold": mapped from a numeric confidence score
 * - "completeness_gate": blocked by the source completeness check
 * - "override": human override applied
 * - "fallback": no matching rule — Out of Scope
 */
export type VerdictMethod =
  | "deterministic_source"
  | "confidence_threshold"
  | "completeness_gate"
  | "override"
  | "fallback";

export interface VerdictDecision {
  verdict: VerdictType;
  rationale: string;
  method: VerdictMethod;
  /** 0.0–1.0 confidence in this verdict decision itself */
  decisionConfidence: number;
  /** Source completeness score (0.0–1.0) at the time of verdict */
  sourceCompletenessScore: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

export const VALID_VERDICTS: VerdictType[] = [
  "Supported",
  "Contradicted",
  "Partially Supported",
  "Ambiguous",
  "Insufficient Evidence",
  "Out of Scope",
  "Needs Expert Review",
];

/** Resolution tolerance thresholds (Ångström) */
export const RESOLUTION_THRESHOLDS = {
  EXACT: 0.05,       // ≤ 0.05 Å → Supported
  CLOSE: 0.20,       // ≤ 0.20 Å → Partially Supported
  AMBIGUOUS: 0.50,   // ≤ 0.50 Å → Ambiguous
  // > 0.50 Å → Contradicted
} as const;

/** Confidence score thresholds for non-PDB vertical adapters */
export const CONFIDENCE_THRESHOLDS = {
  SUPPORTED: 0.85,          // ≥ 0.85 → Supported
  PARTIALLY_SUPPORTED: 0.60, // ≥ 0.60 → Partially Supported
  AMBIGUOUS: 0.30,           // ≥ 0.30 → Ambiguous
  // < 0.30 → Needs Expert Review
} as const;

/**
 * Minimum source completeness score required to issue a positive verdict
 * (Supported or Partially Supported). Below this threshold, the verdict
 * is downgraded to "Insufficient Evidence" regardless of confidence.
 */
export const COMPLETENESS_GATE_THRESHOLD = 0.40;

// ─── Guard ─────────────────────────────────────────────────────────────────────

export function isValidVerdict(v: string): v is VerdictType {
  return VALID_VERDICTS.includes(v as VerdictType);
}

// ─── Source Completeness Check ─────────────────────────────────────────────────

export interface CompletenessCheckInput {
  /** Whether the primary source was found at all */
  sourceFound: boolean;
  /** Whether the specific field being verified was present in the source */
  fieldPresent: boolean;
  /** Whether the source data is fresh (not stale) */
  dataFresh: boolean;
  /** Whether the source URL is reachable (optional — defaults to true if not checked) */
  sourceReachable?: boolean;
}

export interface CompletenessCheckResult {
  score: number;          // 0.0–1.0
  passed: boolean;        // score >= COMPLETENESS_GATE_THRESHOLD
  flags: string[];        // human-readable reasons for deductions
}

/**
 * Compute a source completeness score for a claim verification attempt.
 * This is a hard gate: if passed === false, the verdict MUST be
 * "Insufficient Evidence" regardless of any other signals.
 */
export function checkSourceCompleteness(
  input: CompletenessCheckInput
): CompletenessCheckResult {
  const flags: string[] = [];
  let score = 1.0;

  if (!input.sourceFound) {
    flags.push("Primary source not found");
    score -= 0.60;
  }
  if (!input.fieldPresent) {
    flags.push("Required field absent in source record");
    score -= 0.30;
  }
  if (!input.dataFresh) {
    flags.push("Source data may be stale");
    score -= 0.10;
  }
  if (input.sourceReachable === false) {
    flags.push("Source URL unreachable");
    score -= 0.20;
  }

  const finalScore = Math.max(0, Math.min(1, score));
  return {
    score: finalScore,
    passed: finalScore >= COMPLETENESS_GATE_THRESHOLD,
    flags,
  };
}

// ─── Deterministic Verdict Classifiers ────────────────────────────────────────

/**
 * Classify a resolution claim against a PDB-sourced resolution value.
 * Uses named thresholds — no LLM involved.
 */
export function classifyResolutionClaim(
  claimedResolution: number,
  actualResolution: number | null
): VerdictType {
  if (actualResolution === null) return "Insufficient Evidence";
  const diff = Math.abs(actualResolution - claimedResolution);
  if (diff <= RESOLUTION_THRESHOLDS.EXACT) return "Supported";
  if (diff <= RESOLUTION_THRESHOLDS.CLOSE) return "Partially Supported";
  if (diff <= RESOLUTION_THRESHOLDS.AMBIGUOUS) return "Ambiguous";
  return "Contradicted";
}

/**
 * Classify a resolution claim and return a full VerdictDecision.
 */
export function verdictForResolution(
  claimedResolution: number,
  actualResolution: number | null,
  pdbId: string,
  completeness: CompletenessCheckResult
): VerdictDecision {
  if (!completeness.passed) {
    return {
      verdict: "Insufficient Evidence",
      rationale: `Source completeness gate failed for PDB ${pdbId}: ${completeness.flags.join("; ")}`,
      method: "completeness_gate",
      decisionConfidence: 1.0,
      sourceCompletenessScore: completeness.score,
    };
  }
  if (actualResolution === null) {
    return {
      verdict: "Ambiguous",
      rationale: `PDB ${pdbId} found but resolution not recorded (may be NMR or EM).`,
      method: "deterministic_source",
      decisionConfidence: 0.9,
      sourceCompletenessScore: completeness.score,
    };
  }
  const verdict = classifyResolutionClaim(claimedResolution, actualResolution);
  const diff = Math.abs(actualResolution - claimedResolution);
  const rationale = buildResolutionRationale(verdict, claimedResolution, actualResolution, diff, pdbId);
  return {
    verdict,
    rationale,
    method: "deterministic_source",
    decisionConfidence: verdict === "Supported" ? 1.0 : verdict === "Partially Supported" ? 0.85 : 0.75,
    sourceCompletenessScore: completeness.score,
  };
}

function buildResolutionRationale(
  verdict: VerdictType,
  claimed: number,
  actual: number,
  diff: number,
  pdbId: string
): string {
  const diffStr = diff.toFixed(2);
  switch (verdict) {
    case "Supported":
      return `Claimed resolution ${claimed} Å matches PDB ${pdbId} record ${actual} Å (Δ=${diffStr} Å ≤ ${RESOLUTION_THRESHOLDS.EXACT} Å).`;
    case "Partially Supported":
      return `Claimed resolution ${claimed} Å is close to PDB ${pdbId} record ${actual} Å (Δ=${diffStr} Å, within ${RESOLUTION_THRESHOLDS.CLOSE} Å tolerance).`;
    case "Ambiguous":
      return `Claimed resolution ${claimed} Å differs from PDB ${pdbId} record ${actual} Å (Δ=${diffStr} Å, within ${RESOLUTION_THRESHOLDS.AMBIGUOUS} Å ambiguity range).`;
    case "Contradicted":
      return `Claimed resolution ${claimed} Å contradicts PDB ${pdbId} record ${actual} Å (Δ=${diffStr} Å > ${RESOLUTION_THRESHOLDS.AMBIGUOUS} Å threshold).`;
    default:
      return `Resolution comparison inconclusive for PDB ${pdbId}.`;
  }
}

/**
 * Classify a verdict from a vertical adapter's confidence score.
 * This is the one legitimate heuristic — used only when no deterministic
 * source comparison is possible.
 */
export function classifyByConfidence(
  confidenceScore: number,
  completeness: CompletenessCheckResult,
  sourceId: string | null,
  flags: string[]
): VerdictDecision {
  if (!completeness.passed) {
    return {
      verdict: "Insufficient Evidence",
      rationale: `Source completeness gate failed: ${completeness.flags.join("; ")}`,
      method: "completeness_gate",
      decisionConfidence: 1.0,
      sourceCompletenessScore: completeness.score,
    };
  }

  let verdict: VerdictType;
  let decisionConfidence: number;

  if (confidenceScore >= CONFIDENCE_THRESHOLDS.SUPPORTED) {
    verdict = "Supported";
    decisionConfidence = confidenceScore;
  } else if (confidenceScore >= CONFIDENCE_THRESHOLDS.PARTIALLY_SUPPORTED) {
    verdict = "Partially Supported";
    decisionConfidence = confidenceScore;
  } else if (confidenceScore >= CONFIDENCE_THRESHOLDS.AMBIGUOUS) {
    verdict = "Ambiguous";
    decisionConfidence = confidenceScore;
  } else {
    verdict = "Needs Expert Review";
    decisionConfidence = confidenceScore;
  }

  const flagStr = flags.length > 0 ? ` Flags: ${flags.join("; ")}` : "";
  return {
    verdict,
    rationale: `Source: ${sourceId ?? "unknown"} (confidence ${(confidenceScore * 100).toFixed(0)}%).${flagStr}`,
    method: "confidence_threshold",
    decisionConfidence,
    sourceCompletenessScore: completeness.score,
  };
}

// ─── Final Verdict Resolution ──────────────────────────────────────────────────

/**
 * Compute the final displayed verdict, respecting human overrides.
 * If both verdict and overriddenVerdict are null, returns "Insufficient Evidence".
 */
export function computeFinalVerdict(
  verdict: VerdictType | null | undefined,
  overriddenVerdict: VerdictType | null | undefined
): VerdictType {
  if (overriddenVerdict && isValidVerdict(overriddenVerdict)) return overriddenVerdict;
  if (verdict && isValidVerdict(verdict)) return verdict;
  return "Insufficient Evidence";
}

// ─── Verdict Summary ───────────────────────────────────────────────────────────

export function buildVerdictSummaryFromDecisions(
  claims: Array<{
    verdict: VerdictType | null;
    overriddenVerdict: VerdictType | null;
  }>
): Record<VerdictType, number> {
  const summary: Record<VerdictType, number> = {
    Supported: 0,
    Contradicted: 0,
    "Partially Supported": 0,
    Ambiguous: 0,
    "Insufficient Evidence": 0,
    "Out of Scope": 0,
    "Needs Expert Review": 0,
  };
  for (const claim of claims) {
    const v = computeFinalVerdict(claim.verdict, claim.overriddenVerdict);
    summary[v]++;
  }
  return summary;
}

// ─── Determinism Metrics ───────────────────────────────────────────────────────

export interface DeterminismMetrics {
  total: number;
  deterministic: number;
  heuristic: number;
  gated: number;
  overridden: number;
  determinismRate: number; // 0.0–1.0
}

export function computeDeterminismMetrics(
  methods: Array<VerdictMethod | null | undefined>
): DeterminismMetrics {
  const total = methods.length;
  let deterministic = 0;
  let heuristic = 0;
  let gated = 0;
  let overridden = 0;

  for (const m of methods) {
    if (m === "deterministic_source") deterministic++;
    else if (m === "confidence_threshold" || m === "fallback") heuristic++;
    else if (m === "completeness_gate") gated++;
    else if (m === "override") overridden++;
  }

  return {
    total,
    deterministic,
    heuristic,
    gated,
    overridden,
    determinismRate: total > 0 ? deterministic / total : 0,
  };
}
