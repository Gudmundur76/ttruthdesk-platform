/**
 * reEvaluationEngine.ts — Phase 105
 *
 * Autonomous Re-evaluation Loop
 *
 * This module is the heart of the self-compounding knowledge graph. It is
 * triggered by the heartbeat scheduler whenever:
 *
 *   1. New citation edges have been discovered for a tracked source paper
 *      (Stage 6 — citationChainAnalyzer.ts has written new rows to citation_edges)
 *   2. A source paper's citation chain stats have changed (new citing papers found)
 *
 * For each affected claim, the loop:
 *   a. Fetches the claim's current upstream verdict and provenance score
 *   b. Fetches the latest citation chain stats for the claim's document
 *   c. Re-runs computeCompositeTruth() (pure, deterministic, no LLM)
 *   d. Writes the updated composite score + label back via updateClaimVerdict()
 *      ONLY if the result has changed (idempotent — same inputs → same output,
 *      no unnecessary DB writes)
 *
 * Design principles:
 *   - Idempotent: running twice produces the same result as running once
 *   - Non-fatal: individual claim errors are caught and logged; the loop continues
 *   - Bounded: processes at most `batchSize` claims per run to avoid timeouts
 *   - Auditable: returns a structured result with per-claim outcomes
 *
 * Trigger conditions (checked by the heartbeat endpoint):
 *   - citation_edges rows updated in the last `lookbackHours` hours
 *   - documents with status = 'complete' that have at least one citation edge
 */

import { getDb, updateClaimVerdict } from "./db";
import { claimScoreHistory } from "../drizzle/schema";
import { computeCompositeTruth } from "./compositeTruthEngine";
import { getCitationChainStats } from "./citationChainAnalyzer";
import { sql } from "drizzle-orm";
import { logger, errData } from "./logger";
const log = logger("reEvaluationEngine");


// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReEvalClaimInput {
  claimId: number;
  documentId: number;
  upstreamVerdict: string | null;
  provenanceScore: number | null;
  compositeTruthScore: number | null;
  compositeTruthLabel: string | null;
}

export interface ReEvalClaimOutcome {
  claimId: number;
  documentId: number;
  status: "updated" | "unchanged" | "skipped" | "error";
  previousLabel: string | null;
  newLabel: string | null;
  previousScore: number | null;
  newScore: number | null;
  errorMessage?: string;
}

export interface ReEvalRunResult {
  affectedDocuments: number;
  claimsExamined: number;
  claimsUpdated: number;
  claimsUnchanged: number;
  claimsSkipped: number;
  claimsErrored: number;
  outcomes: ReEvalClaimOutcome[];
  durationMs: number;
}

// ─── Affected document discovery ─────────────────────────────────────────────

/**
 * Returns document IDs that have had new citation edges written in the last
 * `lookbackHours` hours. These are the documents whose claims need re-scoring.
 *
 * A document is "affected" if:
 *   - It has at least one citation_edges row (i.e., a PMID was found)
 *   - At least one of those edges was created or updated within the lookback window
 */
export async function getAffectedDocumentIds(
  lookbackHours: number = 24
): Promise<number[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const rows = await db.execute(sql`
      SELECT DISTINCT sourceDocId
      FROM citation_edges
      WHERE createdAt >= ${cutoff}
      ORDER BY sourceDocId
    `);

    const result = (rows as unknown) as Array<Record<string, unknown>>;
    return result.map(r => Number(r.sourceDocId)).filter(id => !isNaN(id));
  } catch (err) {
    log.error("[ReEval] getAffectedDocumentIds failed:", errData(err));
    return [];
  }
}

// ─── Claim fetching ───────────────────────────────────────────────────────────

/**
 * Returns all claims for a given document that are eligible for re-evaluation:
 *   - Have an upstream verdict (pipeline has run at least through Stage 2)
 *   - Document status is 'complete'
 */
export async function getEligibleClaimsForDocument(
  documentId: number
): Promise<ReEvalClaimInput[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    const rows = await db.execute(sql`
      SELECT
        c.id AS claimId,
        c.documentId,
        c.verdict AS upstreamVerdict,
        c.provenanceScore,
        c.compositeTruthScore,
        c.compositeTruthLabel
      FROM audit_claims c
      JOIN documents d ON d.id = c.documentId
      WHERE
        c.documentId = ${documentId}
        AND c.verdict IS NOT NULL
        AND d.status = 'complete'
      ORDER BY c.id
    `);

    const result = (rows as unknown) as Array<Record<string, unknown>>;
    return result.map(r => ({
      claimId: Number(r.claimId),
      documentId: Number(r.documentId),
      upstreamVerdict: r.upstreamVerdict ? String(r.upstreamVerdict) : null,
      provenanceScore:
        r.provenanceScore != null ? Number(r.provenanceScore) : null,
      compositeTruthScore:
        r.compositeTruthScore != null ? Number(r.compositeTruthScore) : null,
      compositeTruthLabel: r.compositeTruthLabel
        ? String(r.compositeTruthLabel)
        : null,
    }));
  } catch (err) {
    log.error(
      `[ReEval] getEligibleClaimsForDocument(${documentId}) failed:`,
      errData(err)
    );
    return [];
  }
}

// ─── Per-claim re-scoring ─────────────────────────────────────────────────────

/**
 * Re-scores a single claim using the latest citation chain stats for its document.
 *
 * Idempotency guarantee: if the computed label and score are identical to the
 * stored values (within floating-point tolerance), no DB write is performed and
 * the outcome is marked "unchanged".
 */
export async function reScoreClaim(
  claim: ReEvalClaimInput,
  chainStats: { totalCitingPapers: number; maxDistortionScore: number }
): Promise<ReEvalClaimOutcome> {
  try {
    const result = computeCompositeTruth({
      upstreamVerdict: claim.upstreamVerdict as Parameters<
        typeof computeCompositeTruth
      >[0]["upstreamVerdict"],
      provenanceScore: claim.provenanceScore,
      chainDistortionScore:
        chainStats.totalCitingPapers > 0
          ? chainStats.maxDistortionScore
          : null,
      chainHopCount: chainStats.totalCitingPapers,
    });

    // Idempotency check: skip write if nothing has changed
    const scoreUnchanged =
      claim.compositeTruthScore !== null &&
      Math.abs((claim.compositeTruthScore ?? 0) - result.score) < 0.001;
    const labelUnchanged = claim.compositeTruthLabel === result.label;

    if (scoreUnchanged && labelUnchanged) {
      return {
        claimId: claim.claimId,
        documentId: claim.documentId,
        status: "unchanged",
        previousLabel: claim.compositeTruthLabel,
        newLabel: result.label,
        previousScore: claim.compositeTruthScore,
        newScore: result.score,
      };
    }

    // Write updated composite signal
    await updateClaimVerdict(claim.claimId, {
      compositeTruthScore: result.score,
      compositeTruthLabel: result.label,
    });

    // Persist score snapshot for the Claim Confidence Timeline (non-fatal)
    try {
      const db = await getDb();
      if (db) {
        await db
          .insert(claimScoreHistory)
          .values({
            claimId: claim.claimId,
            compositeTruthScore: result.score,
            compositeTruthLabel: result.label ?? null,
            triggerSource: "re-evaluation",
          })
          .onDuplicateKeyUpdate({
            set: {
              compositeTruthScore: result.score,
              compositeTruthLabel: result.label ?? null,
            },
          });
      }
    } catch (snapErr) {
      // Non-fatal — snapshot failure must not block the re-evaluation write
      log.warn(
        `[ReEval] Snapshot write failed for claim ${claim.claimId}:`,
        errData(snapErr)
      );
    }

    return {
      claimId: claim.claimId,
      documentId: claim.documentId,
      status: "updated",
      previousLabel: claim.compositeTruthLabel,
      newLabel: result.label,
      previousScore: claim.compositeTruthScore,
      newScore: result.score,
    };
  } catch (err) {
    return {
      claimId: claim.claimId,
      documentId: claim.documentId,
      status: "error",
      previousLabel: claim.compositeTruthLabel,
      newLabel: null,
      previousScore: claim.compositeTruthScore,
      newScore: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Main re-evaluation loop ──────────────────────────────────────────────────

/**
 * Run the autonomous re-evaluation loop for all documents affected by new
 * citation edges in the last `lookbackHours` hours.
 *
 * @param opts.lookbackHours  How far back to look for new citation edges (default 24)
 * @param opts.batchSize      Max claims to process per run (default 500)
 * @param opts.documentIds    Optional explicit list of document IDs to re-evaluate
 *                            (overrides the lookback-based discovery)
 */
export async function runReEvaluationLoop(opts: {
  lookbackHours?: number;
  batchSize?: number;
  documentIds?: number[];
} = {}): Promise<ReEvalRunResult> {
  const t0 = Date.now();
  const lookbackHours = opts.lookbackHours ?? 24;
  const batchSize = Math.min(opts.batchSize ?? 500, 2000);

  const outcomes: ReEvalClaimOutcome[] = [];
  let claimsExamined = 0;
  let claimsUpdated = 0;
  let claimsUnchanged = 0;
  let claimsSkipped = 0;
  let claimsErrored = 0;

  // Step 1: Discover affected documents
  const documentIds =
    opts.documentIds && opts.documentIds.length > 0
      ? opts.documentIds
      : await getAffectedDocumentIds(lookbackHours);

  if (documentIds.length === 0) {
    return {
      affectedDocuments: 0,
      claimsExamined: 0,
      claimsUpdated: 0,
      claimsUnchanged: 0,
      claimsSkipped: 0,
      claimsErrored: 0,
      outcomes: [],
      durationMs: Date.now() - t0,
    };
  }

  log.info(
    `[ReEval] Starting re-evaluation loop: ${documentIds.length} affected document(s), lookback=${lookbackHours}h, batchSize=${batchSize}`
  );

  // Step 2: For each affected document, fetch citation chain stats and re-score claims
  for (const documentId of documentIds) {
    if (claimsExamined >= batchSize) {
      log.info(
        `[ReEval] Batch size limit (${batchSize}) reached — stopping early`
      );
      break;
    }

    // Fetch citation chain stats for this document (non-fatal)
    let chainStats: { totalCitingPapers: number; maxDistortionScore: number };
    try {
      const stats = await getCitationChainStats(documentId);
      chainStats = {
        totalCitingPapers: stats.totalCitingPapers,
        maxDistortionScore: stats.maxDistortionScore,
      };
    } catch (err) {
      log.warn(
        `[ReEval] getCitationChainStats(${documentId}) failed (non-fatal):`,
        errData(err)
      );
      chainStats = { totalCitingPapers: 0, maxDistortionScore: 0 };
    }

    // Fetch eligible claims for this document
    const claims = await getEligibleClaimsForDocument(documentId);
    if (claims.length === 0) continue;

    // Re-score each claim
    for (const claim of claims) {
      if (claimsExamined >= batchSize) break;
      claimsExamined++;

      const outcome = await reScoreClaim(claim, chainStats);
      outcomes.push(outcome);

      switch (outcome.status) {
        case "updated":
          claimsUpdated++;
          break;
        case "unchanged":
          claimsUnchanged++;
          break;
        case "skipped":
          claimsSkipped++;
          break;
        case "error":
          claimsErrored++;
          log.warn(
            `[ReEval] Claim ${claim.claimId} re-score error: ${outcome.errorMessage}`
          );
          break;
      }
    }
  }

  const durationMs = Date.now() - t0;

  log.info(
    `[ReEval] Loop complete: ${claimsExamined} examined, ${claimsUpdated} updated, ` +
      `${claimsUnchanged} unchanged, ${claimsErrored} errors — ${durationMs}ms`
  );

  return {
    affectedDocuments: documentIds.length,
    claimsExamined,
    claimsUpdated,
    claimsUnchanged,
    claimsSkipped,
    claimsErrored,
    outcomes,
    durationMs,
  };
}
