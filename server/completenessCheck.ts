/**
 * completenessCheck.ts — Source Completeness Gate
 *
 * Evaluates whether a source lookup has returned sufficient data to support
 * a positive verdict. This is a hard gate: if the check fails, the verdict
 * MUST be "Insufficient Evidence" regardless of any confidence signal.
 *
 * Design principles:
 *   1. Completeness is binary at the gate level (passed / not passed).
 *   2. The score is recorded for audit purposes even when the gate passes.
 *   3. Each claim type has specific required fields.
 *   4. The gate never upgrades a verdict — it can only downgrade.
 */

import type { PdbEntry } from "./pdbAdapter";
import {
  checkSourceCompleteness,
  type CompletenessCheckInput,
  type CompletenessCheckResult,
} from "./verdictEngine";

// ─── PDB-specific completeness checks ─────────────────────────────────────────

export interface PdbCompletenessInput {
  pdbId: string;
  found: boolean;
  entry: PdbEntry | null;
  claimType: string;
  checkedAt?: Date;
}

/**
 * Evaluate completeness for a PDB-backed claim.
 * Each claim type requires different fields to be present.
 */
export function checkPdbCompleteness(input: PdbCompletenessInput): CompletenessCheckResult {
  const { found, entry, claimType } = input;

  if (!found || !entry) {
    return checkSourceCompleteness({
      sourceFound: false,
      fieldPresent: false,
      dataFresh: false,
    });
  }

  // Determine which field is required for this claim type
  let fieldPresent = true;
  switch (claimType) {
    case "resolution":
      fieldPresent = entry.resolution != null;
      break;
    case "experimental_method":
      fieldPresent = !!entry.experimentalMethod;
      break;
    case "organism":
      fieldPresent = entry.organisms.length > 0;
      break;
    case "ligand":
      fieldPresent = entry.ligands.length > 0;
      break;
    case "pdb_id":
      // Just existence is sufficient
      fieldPresent = true;
      break;
    case "protein_name":
      fieldPresent = !!entry.title;
      break;
    default:
      fieldPresent = true;
  }

  // Data freshness: consider stale if checked more than 30 days ago
  const dataFresh =
    !input.checkedAt ||
    Date.now() - input.checkedAt.getTime() < 30 * 24 * 60 * 60 * 1000;

  const checkInput: CompletenessCheckInput = {
    sourceFound: true,
    fieldPresent,
    dataFresh,
  };

  return checkSourceCompleteness(checkInput);
}

// ─── Vertical adapter completeness checks ─────────────────────────────────────

export interface AdapterCompletenessInput {
  found: boolean;
  confidenceScore: number;
  confidenceFlags: string[];
  sourceId: string | null;
  sourceUrl: string | null;
}

/**
 * Evaluate completeness for a vertical adapter result.
 * The adapter's own confidence flags are incorporated.
 */
export function checkAdapterCompleteness(
  input: AdapterCompletenessInput
): CompletenessCheckResult {
  const hasBlockingFlag = input.confidenceFlags.some((f) =>
    f.toLowerCase().includes("not found") ||
    f.toLowerCase().includes("no data") ||
    f.toLowerCase().includes("unavailable") ||
    f.toLowerCase().includes("timeout")
  );

  const checkInput: CompletenessCheckInput = {
    sourceFound: input.found && !hasBlockingFlag,
    fieldPresent: input.found && input.confidenceScore > 0,
    dataFresh: !hasBlockingFlag,
    sourceReachable: input.sourceUrl != null ? true : undefined,
  };

  const result = checkSourceCompleteness(checkInput);

  // Merge adapter flags into the completeness flags
  if (input.confidenceFlags.length > 0) {
    result.flags.push(...input.confidenceFlags.map((f) => `[adapter] ${f}`));
  }

  return result;
}

// ─── Completeness summary for a document ──────────────────────────────────────

export interface DocumentCompletenessSummary {
  totalClaims: number;
  gatedClaims: number;        // claims blocked by completeness gate
  passedClaims: number;       // claims that passed the gate
  averageScore: number;       // 0.0–1.0
  gateRate: number;           // fraction of claims blocked
}

export function buildCompletenessSummary(
  scores: number[],
  gated: boolean[]
): DocumentCompletenessSummary {
  const total = scores.length;
  const gatedCount = gated.filter(Boolean).length;
  const avgScore = total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;

  return {
    totalClaims: total,
    gatedClaims: gatedCount,
    passedClaims: total - gatedCount,
    averageScore: avgScore,
    gateRate: total > 0 ? gatedCount / total : 0,
  };
}
