/**
 * verifiabilityGate.ts
 *
 * The FrictionEngine applied inward — four gates that every generated claim
 * must pass before entering the coord_queue:
 *
 *   1. Assumption Gate   — marks hypothesis claims, not facts
 *   2. Evidence Gate     — rejects claims with no whitelisted source
 *   3. Convergence Gate  — defers low-priority claims below threshold
 *   4. Determinism Gate  — rejects claims with non-deterministic generation logic
 */

import type { GeneratedClaimCandidate } from "./graphQuestionGenerator";

// ─── Whitelisted source databases ─────────────────────────────────────────────

const WHITELISTED_SOURCES = new Set([
  "rcsb_pdb",
  "uniprot",
  "pubmed",
  "chembl",
  "emdb",
  "pmc",
  "biorxiv",
]);

// ─── Gate result ──────────────────────────────────────────────────────────────

export type GateVerdict = "pass" | "reject" | "defer";

export interface GateResult {
  verdict: GateVerdict;
  rejectionReason?: string;
  priority: number;
  /** Homology projections are hypotheses, not facts — flag them */
  isHypothesis: boolean;
}

// ─── Gate 1: Assumption Gate ──────────────────────────────────────────────────
// Homology projections assume structural similarity implies functional similarity.
// They are hypotheses, not facts. Mark them but do not reject.

function assumptionGate(claim: GeneratedClaimCandidate): { isHypothesis: boolean } {
  return {
    isHypothesis: claim.inferenceType === "homology_projection",
  };
}

// ─── Gate 2: Evidence Gate ────────────────────────────────────────────────────
// Reject if no required source is in the whitelist.

function evidenceGate(claim: GeneratedClaimCandidate): { pass: boolean; reason?: string } {
  if (!claim.requiredSources || claim.requiredSources.length === 0) {
    return { pass: false, reason: "No required sources specified" };
  }

  const hasWhitelisted = claim.requiredSources.some((s) => WHITELISTED_SOURCES.has(s));
  if (!hasWhitelisted) {
    return {
      pass: false,
      reason: `No whitelisted source in [${claim.requiredSources.join(", ")}]. Allowed: ${Array.from(WHITELISTED_SOURCES).join(", ")}`,
    };
  }

  if (!claim.sourceQuery || claim.sourceQuery.trim().length < 5) {
    return { pass: false, reason: "sourceQuery is missing or too short to be queryable" };
  }

  return { pass: true };
}

// ─── Gate 3: Convergence Gate ─────────────────────────────────────────────────
// Defer low-priority claims. Priority is computed from:
//   - inference type (contradiction_chase = highest, gap_fill = medium, homology = lower)
//   - number of parent verifications (more parents = higher confidence)
//   - claim type specificity (pdb_id > general_molecular)

const PRIORITY_FLOOR = 20; // below this → defer

const INFERENCE_TYPE_PRIORITY: Record<string, number> = {
  contradiction_chase: 70,
  gap_fill:            55,
  homology_projection: 40,
};

const CLAIM_TYPE_BONUS: Record<string, number> = {
  pdb_id:              15,
  resolution:          12,
  experimental_method: 10,
  protein_name:         8,
  organism:             5,
  ligand:               5,
  general_molecular:    0,
};

function convergenceGate(claim: GeneratedClaimCandidate): { verdict: GateVerdict; priority: number } {
  const base = INFERENCE_TYPE_PRIORITY[claim.inferenceType] ?? 40;
  const typeBonus = CLAIM_TYPE_BONUS[claim.claimType] ?? 0;
  const parentBonus = Math.min(claim.parentVerifications.length * 3, 15);
  const priority = Math.min(base + typeBonus + parentBonus, 100);

  if (priority < PRIORITY_FLOOR) {
    return { verdict: "defer", priority };
  }
  return { verdict: "pass", priority };
}

// ─── Gate 4: Determinism Gate ─────────────────────────────────────────────────
// Reject claims that would generate different questions from the same verified
// pattern. Heuristic: if claimText contains non-deterministic language, reject.

const NON_DETERMINISTIC_PATTERNS = [
  /might\s+be/i,
  /could\s+possibly/i,
  /perhaps\s+there/i,
  /it\s+is\s+possible\s+that/i,
  /unclear\s+whether/i,
];

function determinismGate(claim: GeneratedClaimCandidate): { pass: boolean; reason?: string } {
  for (const pattern of NON_DETERMINISTIC_PATTERNS) {
    if (pattern.test(claim.claimText)) {
      return {
        pass: false,
        reason: `Non-deterministic language detected in claimText: "${claim.claimText.slice(0, 80)}..."`,
      };
    }
  }
  return { pass: true };
}

// ─── Main gate function ───────────────────────────────────────────────────────

export function runVerifiabilityGate(claim: GeneratedClaimCandidate): GateResult {
  // Gate 2: Evidence (hard reject)
  const evidence = evidenceGate(claim);
  if (!evidence.pass) {
    return { verdict: "reject", rejectionReason: evidence.reason, priority: 0, isHypothesis: false };
  }

  // Gate 4: Determinism (hard reject)
  const determinism = determinismGate(claim);
  if (!determinism.pass) {
    return { verdict: "reject", rejectionReason: determinism.reason, priority: 0, isHypothesis: false };
  }

  // Gate 3: Convergence (may defer)
  const convergence = convergenceGate(claim);
  if (convergence.verdict === "defer") {
    return { verdict: "defer", rejectionReason: `Priority ${convergence.priority} below threshold ${PRIORITY_FLOOR}`, priority: convergence.priority, isHypothesis: false };
  }

  // Gate 1: Assumption (mark hypothesis, never reject)
  const assumption = assumptionGate(claim);

  return {
    verdict: "pass",
    priority: convergence.priority,
    isHypothesis: assumption.isHypothesis,
  };
}

/**
 * Filter a batch of generated claims through all four gates.
 * Returns only claims that pass, with their computed priority.
 */
export function filterClaimsBatch(
  claims: GeneratedClaimCandidate[]
): Array<GeneratedClaimCandidate & { priority: number; isHypothesis: boolean; gateResult: GateResult }> {
  return claims
    .map((claim) => {
      const gateResult = runVerifiabilityGate(claim);
      return { ...claim, priority: gateResult.priority, isHypothesis: gateResult.isHypothesis, gateResult };
    })
    .filter((c) => c.gateResult.verdict === "pass");
}
