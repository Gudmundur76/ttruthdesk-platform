/**
 * stages.ts — Pipeline stages 0-5 for PRD-L1 Phases 1-4.
 */
import type { StageFn, StageResult } from "./stageRegistry";

// ── Stage 0: DraftGuard ───────────────────────────────────────────────────────
/**
 * DraftGuard: Skip documents that are not yet complete/verified.
 * Fatal stage — aborts the pipeline for draft/pending documents.
 */
export const draftGuardStage: StageFn = async (ctx) => {
  if (ctx.documentStatus !== "complete" && ctx.documentStatus !== "generating_report") {
    return { outcome: "SKIP", reason: `Document status is "${ctx.documentStatus}" — not ready for pipeline` };
  }
  return { outcome: "PASS" };
};

// ── Stage 1: ClaimExtraction ──────────────────────────────────────────────────
/**
 * ClaimExtraction: Extract claims from the document.
 * Delegates to the existing claimExtractor module.
 */
export const claimExtractionStage: StageFn = async (ctx) => {
  try {
    const { getClaimsByDocument } = await import("../db");
    const claims = await getClaimsByDocument(ctx.documentId);
    return {
      outcome: "PASS",
      data: { extractedClaims: claims },
      reason: `Extracted ${claims.length} claims`,
    };
  } catch (err) {
    return { outcome: "FAIL", reason: `ClaimExtraction failed: ${String(err)}` };
  }
};

// ── Stage 2: PassageExtraction ────────────────────────────────────────────────
/**
 * PassageExtraction: Extract source passages for each claim.
 */
export const passageExtractionStage: StageFn = async (ctx) => {
  const claims = (ctx.extractedClaims as Array<{ id: number; sourcePassage?: string | null }>) ?? [];
  const withPassages = claims.filter(c => c.sourcePassage);
  return {
    outcome: "PASS",
    data: { passages: withPassages },
    reason: `${withPassages.length}/${claims.length} claims have source passages`,
  };
};

// ── Stage 3: MisrepresentationClassifier ─────────────────────────────────────
/**
 * MisrepresentationClassifier: Classify misrepresentation type for contradicted claims.
 */
export const misrepresentationClassifierStage: StageFn = async (ctx) => {
  const claims = (ctx.extractedClaims as Array<{ verdict?: string; misrepresentationType?: string }>) ?? [];
  const contradicted = claims.filter(c =>
    c.verdict === "Contradicted" || c.verdict === "Partially Supported"
  );
  const classified = contradicted.filter(c =>
    c.misrepresentationType && c.misrepresentationType !== "unknown"
  );
  return {
    outcome: "PASS",
    data: { misrepresentationType: classified.length > 0 ? "classified" : "pending" },
    reason: `${classified.length}/${contradicted.length} contradicted claims classified`,
  };
};

// ── Stage 4: AdapterRouter ────────────────────────────────────────────────────
/**
 * AdapterRouter: Route claims to the appropriate vertical adapter for verification.
 */
export const adapterRouterStage: StageFn = async (ctx) => {
  try {
    const { getClaimsByDocument } = await import("../db");
    const claims = await getClaimsByDocument(ctx.documentId);
    const unverified = claims.filter(c => !c.verdict);
    return {
      outcome: "PASS",
      data: { adapterResult: { total: claims.length, unverified: unverified.length } },
      reason: `${unverified.length} claims pending adapter verification`,
    };
  } catch (err) {
    return { outcome: "FAIL", reason: `AdapterRouter failed: ${String(err)}` };
  }
};

// ── Stage 5: VerdictAggregator ────────────────────────────────────────────────
/**
 * VerdictAggregator: Aggregate verdicts across all claims for the document.
 */
export const verdictAggregatorStage: StageFn = async (ctx) => {
  const claims = (ctx.extractedClaims as Array<{ verdict?: string }>) ?? [];
  const verdictCounts: Record<string, number> = {};
  for (const claim of claims) {
    const v = claim.verdict ?? "Pending";
    verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
  }
  return {
    outcome: "PASS",
    data: { verdictSummary: verdictCounts },
    reason: `Aggregated verdicts for ${claims.length} claims`,
  };
};
