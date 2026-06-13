/**
 * compositeTruthEngine.ts
 *
 * Phase 103 — Stage 7: Composite Truth Signal
 *
 * Combines three independent signals into a single authoritative truth label
 * and numeric score for each claim:
 *
 *   1. upstream_verdict   — primary source validation result (Stages 1–2)
 *   2. provenance_score   — determinism / traceability of evidence (Stage 4)
 *   3. chain_distortion   — downstream citation distortion (Stage 6)
 *
 * The scoring function is DETERMINISTIC and RULE-BASED. No LLM calls are made
 * here. The LLM is used upstream (claim extraction, misrepresentation
 * classification, distortion scoring). This stage only reads those results
 * and applies a documented lookup table.
 *
 * Composite Truth Labels (8 states):
 *
 *   verified_faithful      — Supported + low chain distortion (< 0.25)
 *   verified_distorted     — Supported + high chain distortion (>= 0.25)
 *   contradicted           — Contradicted, low downstream spread
 *   contradicted_amplified — Contradicted + high chain distortion (wrong & spreading)
 *   partially_supported    — Partially Supported, any chain state
 *   contested              — Ambiguous upstream OR conflicting signals
 *   insufficient_evidence  — Insufficient Evidence upstream
 *   out_of_scope           — Out of Scope or Needs Expert Review
 *
 * Composite Score (0.0–1.0):
 *   Represents the overall "truth confidence" of the claim as it exists in the
 *   literature. 1.0 = fully verified and faithfully propagated. 0.0 = actively
 *   contradicted and being amplified downstream.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type UpstreamVerdict =
  | "Supported"
  | "Contradicted"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Out of Scope"
  | "Needs Expert Review"
  | null
  | undefined;

export type CompositeTruthLabel =
  | "verified_faithful"
  | "verified_distorted"
  | "contradicted"
  | "contradicted_amplified"
  | "partially_supported"
  | "contested"
  | "insufficient_evidence"
  | "out_of_scope";

export interface CompositeTruthInput {
  /** Upstream verdict from primary source validation (Stage 2) */
  upstreamVerdict: UpstreamVerdict;
  /** Provenance score 0–1 from Stage 4. Null if not yet computed. */
  provenanceScore: number | null | undefined;
  /** Maximum chain distortion score 0–1 across all citing papers (Stage 6).
   *  Null means no chain data available (e.g., no PubMed ID on the document). */
  chainDistortionScore: number | null | undefined;
  /** Number of citing papers analysed in the chain. 0 or null = no chain data. */
  chainHopCount?: number | null;
  /**
   * Stage 3.5 — OpenCitations citation authority score [0, 1].
   * Derived from citation count, ORCID-verified authorship, and publication type.
   * Null when no DOI is present in the claim or the OC lookup failed.
   * Score ≥ 0.80 → +0.05 composite bonus (highly cited, ORCID-verified).
   * Score ≤ 0.30 → −0.15 composite penalty (retraction notice or very low authority).
   */
  citationAuthorityScore?: number | null;
  /**
   * True when the OpenCitations lookup returned a retraction-notice flag.
   * When true, applies a −0.15 penalty regardless of citationAuthorityScore.
   */
  isRetracted?: boolean | null;
}

export interface CompositeTruthResult {
  label: CompositeTruthLabel;
  score: number;
  /** Human-readable rationale explaining the label assignment. */
  rationale: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Chain distortion threshold above which downstream propagation is considered
 *  significant enough to affect the composite label. */
const CHAIN_DISTORTION_THRESHOLD = 0.25;

/** Provenance score below which we apply a confidence penalty to the composite
 *  score even if the upstream verdict is positive. */
const PROVENANCE_LOW_THRESHOLD = 0.4;

/** Base scores for each upstream verdict before chain and provenance adjustments. */
const VERDICT_BASE_SCORE: Record<string, number> = {
  Supported: 0.9,
  "Partially Supported": 0.6,
  Ambiguous: 0.45,
  "Insufficient Evidence": 0.25,
  "Out of Scope": 0.2,
  "Needs Expert Review": 0.3,
  Contradicted: 0.05,
};

// ─── Label descriptions (used in rationale strings) ──────────────────────────

const LABEL_DESCRIPTIONS: Record<CompositeTruthLabel, string> = {
  verified_faithful:
    "Claim is supported by primary source data and has been faithfully propagated in the citing literature.",
  verified_distorted:
    "Claim is supported by primary source data but has been distorted in downstream citations — the original finding is sound but is being misrepresented.",
  contradicted:
    "Claim is contradicted by primary source data. Downstream citation spread is limited.",
  contradicted_amplified:
    "Claim is contradicted by primary source data and is being actively amplified in downstream citations — a false claim is spreading.",
  partially_supported:
    "Claim is partially supported by primary source data. The evidence is real but incomplete or qualified.",
  contested:
    "Claim has ambiguous or conflicting evidence signals across primary sources and/or the citation chain.",
  insufficient_evidence:
    "Insufficient primary source data exists to validate this claim at this time.",
  out_of_scope:
    "Claim falls outside the scope of available primary source databases or requires specialist review.",
};

// ─── Core scoring function ────────────────────────────────────────────────────

/**
 * Compute the composite truth label and score for a single claim.
 *
 * This function is pure — it has no side effects and makes no I/O calls.
 * It can be called from the pipeline, from the autonomous re-evaluation loop,
 * and from tests without any mocking required.
 */
// eslint-disable-next-line complexity
export function computeCompositeTruth(
  input: CompositeTruthInput
): CompositeTruthResult {
  const {
    upstreamVerdict,
    provenanceScore,
    chainDistortionScore,
    chainHopCount,
    citationAuthorityScore,
    isRetracted,
  } = input;

  // Normalise nullish values
  const provenance = provenanceScore ?? null;
  const chainScore = chainDistortionScore ?? null;
  const hasChainData =
    chainScore !== null && chainHopCount !== null && (chainHopCount ?? 0) > 0;
  const chainIsHigh =
    hasChainData &&
    chainScore !== null &&
    chainScore >= CHAIN_DISTORTION_THRESHOLD;

  // ── Step 1: Determine label from upstream verdict × chain distortion ─────

  let label: CompositeTruthLabel;

  switch (upstreamVerdict) {
    case "Supported":
      label = chainIsHigh ? "verified_distorted" : "verified_faithful";
      break;

    case "Contradicted":
      label = chainIsHigh ? "contradicted_amplified" : "contradicted";
      break;

    case "Partially Supported":
      label = "partially_supported";
      break;

    case "Ambiguous":
      label = "contested";
      break;

    case "Insufficient Evidence":
      label = "insufficient_evidence";
      break;

    case "Out of Scope":
    case "Needs Expert Review":
    case null:
    case undefined:
      label = "out_of_scope";
      break;

    default:
      label = "contested";
  }

  // ── Step 2: Compute numeric score ────────────────────────────────────────

  const baseScore = VERDICT_BASE_SCORE[upstreamVerdict ?? ""] ?? 0.2;

  // Chain distortion penalty: applied only when chain data is present.
  // A distortion score of 1.0 applies a maximum 0.20 penalty.
  // No chain data = no penalty (we don't punish claims for lacking PMID).
  const chainPenalty =
    hasChainData && chainScore !== null ? chainScore * 0.2 : 0;

  // Provenance penalty: applied when provenance score is below threshold.
  // Low provenance means the evidence is hard to trace — reduces confidence.
  const provenancePenalty =
    provenance !== null && provenance < PROVENANCE_LOW_THRESHOLD
      ? (PROVENANCE_LOW_THRESHOLD - provenance) * 0.15
      : 0;

  // Provenance bonus: high provenance (>= 0.8) adds a small confidence boost.
  const provenanceBonus =
    provenance !== null && provenance >= 0.8 ? (provenance - 0.8) * 0.1 : 0;

  // ── Stage 3.5: OpenCitations citation authority adjustment ─────────────
  // High citation authority (≥ 0.80) adds a small confidence boost.
  // Low authority (≤ 0.30) or a retraction flag applies a penalty.
  const ocAuthority = citationAuthorityScore ?? null;
  const ocBonus =
    ocAuthority !== null && ocAuthority >= 0.80 ? 0.05 : 0;
  const ocPenalty =
    isRetracted === true
      ? 0.15
      : ocAuthority !== null && ocAuthority <= 0.30
        ? 0.10
        : 0;

  const rawScore =
    baseScore - chainPenalty - provenancePenalty + provenanceBonus + ocBonus - ocPenalty;
  const score = Math.max(0, Math.min(1, rawScore));

  // ── Step 3: Build rationale ───────────────────────────────────────────────

  const parts: string[] = [LABEL_DESCRIPTIONS[label]];

  if (hasChainData && chainScore !== null) {
    parts.push(
      `Chain analysis: ${chainHopCount} citing paper${(chainHopCount ?? 0) !== 1 ? "s" : ""} analysed, ` +
        `max distortion score ${Math.round(chainScore * 100)}%.`
    );
  } else {
    parts.push(
      "No citation chain data available (document lacks a PubMed ID or chain analysis is pending)."
    );
  }

  if (provenance !== null) {
    parts.push(`Provenance score: ${Math.round(provenance * 100)}%.`);
  }

  if (isRetracted === true) {
    parts.push(
      "⚠ OpenCitations: this work has a retraction notice — composite score penalised (−0.15)."
    );
  } else if (ocAuthority !== null) {
    if (ocAuthority >= 0.80) {
      parts.push(
        `OpenCitations: high citation authority (${Math.round(ocAuthority * 100)}%) — composite score boosted (+0.05).`
      );
    } else if (ocAuthority <= 0.30) {
      parts.push(
        `OpenCitations: low citation authority (${Math.round(ocAuthority * 100)}%) — composite score penalised (−0.10).`
      );
    } else {
      parts.push(
        `OpenCitations: citation authority ${Math.round(ocAuthority * 100)}% (no adjustment).`
      );
    }
  }

  const rationale = parts.join(" ");

  return { label, score: Math.round(score * 10000) / 10000, rationale };
}

// ─── Label metadata (for UI rendering) ───────────────────────────────────────

export interface CompositeLabelMeta {
  label: CompositeTruthLabel;
  displayName: string;
  shortName: string;
  /** Tailwind colour classes: bg, text, border */
  colors: { bg: string; text: string; border: string };
  /** Icon character or emoji for compact display */
  icon: string;
  /** Severity: 0 = best, 4 = worst */
  severity: 0 | 1 | 2 | 3 | 4;
}

export const COMPOSITE_LABEL_META: Record<
  CompositeTruthLabel,
  CompositeLabelMeta
> = {
  verified_faithful: {
    label: "verified_faithful",
    displayName: "Verified & Faithful",
    shortName: "Verified",
    colors: {
      bg: "bg-emerald-50",
      text: "text-emerald-800",
      border: "border-emerald-300",
    },
    icon: "✓",
    severity: 0,
  },
  verified_distorted: {
    label: "verified_distorted",
    displayName: "Verified — Distorted Downstream",
    shortName: "Distorted",
    colors: {
      bg: "bg-amber-50",
      text: "text-amber-800",
      border: "border-amber-300",
    },
    icon: "⚠",
    severity: 1,
  },
  partially_supported: {
    label: "partially_supported",
    displayName: "Partially Supported",
    shortName: "Partial",
    colors: {
      bg: "bg-blue-50",
      text: "text-blue-800",
      border: "border-blue-300",
    },
    icon: "◑",
    severity: 2,
  },
  contested: {
    label: "contested",
    displayName: "Contested",
    shortName: "Contested",
    colors: {
      bg: "bg-orange-50",
      text: "text-orange-800",
      border: "border-orange-300",
    },
    icon: "?",
    severity: 2,
  },
  insufficient_evidence: {
    label: "insufficient_evidence",
    displayName: "Insufficient Evidence",
    shortName: "No Evidence",
    colors: {
      bg: "bg-slate-50",
      text: "text-slate-600",
      border: "border-slate-300",
    },
    icon: "–",
    severity: 2,
  },
  out_of_scope: {
    label: "out_of_scope",
    displayName: "Out of Scope",
    shortName: "OOS",
    colors: {
      bg: "bg-slate-50",
      text: "text-slate-500",
      border: "border-slate-200",
    },
    icon: "○",
    severity: 2,
  },
  contradicted: {
    label: "contradicted",
    displayName: "Contradicted",
    shortName: "Contradicted",
    colors: { bg: "bg-red-50", text: "text-red-800", border: "border-red-300" },
    icon: "✗",
    severity: 3,
  },
  contradicted_amplified: {
    label: "contradicted_amplified",
    displayName: "Contradicted & Amplified",
    shortName: "Amplified Error",
    colors: {
      bg: "bg-rose-50",
      text: "text-rose-900",
      border: "border-rose-400",
    },
    icon: "✗✗",
    severity: 4,
  },
};
