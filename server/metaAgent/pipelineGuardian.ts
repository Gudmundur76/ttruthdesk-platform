/**
 * pipelineGuardian.ts — Layer 3: Pipeline Invariant Checks
 *
 * Enforces five invariants that must hold for the analysis pipeline to be
 * considered healthy. Each invariant is a named predicate with a threshold.
 *
 * Invariants:
 *   1. stuckDocuments       — no document stuck in non-terminal status > 30 min
 *   2. claimOrphans         — no claim with documentId referencing a deleted document
 *   3. zeroClaimCompletions — no "complete" document with claimCount = 0
 *   4. modelValidationRate  — prediction_models validated within 30 days >= 60%
 *   5. wikiStaleness        — no wiki page unupdated for > 90 days
 */

import { getDb } from "../db";
import {
  documents,
  claims,
  predictionModels,
  wikiPages,
} from "../../drizzle/schema";
import { lt, lte, eq, sql, and, count, isNotNull } from "drizzle-orm";

export type InvariantStatus = "pass" | "warn" | "fail" | "unavailable";

export interface InvariantResult {
  name: string;
  status: InvariantStatus;
  threshold: string;
  actual: string;
  details: Record<string, unknown>;
  severity: "info" | "warning" | "critical";
}

export interface PipelineGuardianReport {
  invariants: InvariantResult[];
  overallStatus: InvariantStatus;
  failCount: number;
  warnCount: number;
  checkedAt: string;
  durationMs: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const _NON_TERMINAL_STATUSES = [
  "pending",
  "extracting",
  "validating",
  "generating_report",
] as const;
const STUCK_THRESHOLD_MINUTES = 30;
const WIKI_STALE_DAYS = 90;
const MODEL_VALIDATION_WINDOW_DAYS = 30;
const MODEL_VALIDATION_RATE_THRESHOLD = 0.6;
const PDB_STALE_DAYS = 180; // Claims with PDB evidence older than this are stale
const LOW_CONFIDENCE_THRESHOLD = 0.4; // Claims below this score need recalibration
const LOW_CONFIDENCE_MAX_RATIO = 0.2; // Warn if >20% of scored claims are low-confidence

// ─── Invariant 1: Stuck Documents ────────────────────────────────────────────

async function checkStuckDocuments(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<InvariantResult> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000);

  // Count documents in non-terminal status that haven't been updated recently
  // We use createdAt as a proxy since there's no updatedAt on documents
  let stuckCount = 0;
  let dbError: string | null = null;

  try {
    const stuck = await db
      .select({ id: documents.id, status: documents.status })
      .from(documents)
      .where(
        and(
          lt(documents.createdAt, cutoff),
          sql`${documents.status} IN ('pending','extracting','validating','generating_report')`
        )
      );
    stuckCount = stuck.length;
  } catch (err) {
    dbError = String(err);
  }

  return {
    name: "stuckDocuments",
    status: dbError ? "warn" : stuckCount > 0 ? "fail" : "pass",
    threshold: `0 documents stuck > ${STUCK_THRESHOLD_MINUTES}min`,
    actual: dbError
      ? `DB error: ${dbError}`
      : `${stuckCount} stuck document(s)`,
    details: { stuckCount, cutoffMinutes: STUCK_THRESHOLD_MINUTES, dbError },
    severity: stuckCount > 5 ? "critical" : stuckCount > 0 ? "warning" : "info",
  };
}

// ─── Invariant 2: Claim Orphans ───────────────────────────────────────────────

async function checkClaimOrphans(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<InvariantResult> {
  let orphanCount = 0;
  let dbError: string | null = null;

  try {
    // Claims whose documentId doesn't exist in documents table
    const orphans = await db.execute(
      sql`SELECT COUNT(*) as cnt FROM claims c
          LEFT JOIN documents d ON c.documentId = d.id
          WHERE d.id IS NULL`
    );
    const rows = orphans as unknown as Array<{ cnt: number }>;
    orphanCount = Number(rows[0]?.cnt ?? 0);
  } catch (err) {
    dbError = String(err);
  }

  return {
    name: "claimOrphans",
    status: dbError ? "warn" : orphanCount > 0 ? "fail" : "pass",
    threshold: "0 orphaned claims",
    actual: dbError
      ? `DB error: ${dbError}`
      : `${orphanCount} orphaned claim(s)`,
    details: { orphanCount, dbError },
    severity: orphanCount > 0 ? "warning" : "info",
  };
}

// ─── Invariant 3: Zero-Claim Completions ─────────────────────────────────────

async function checkZeroClaimCompletions(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<InvariantResult> {
  let zeroClaimCount = 0;
  let dbError: string | null = null;

  try {
    const zeroClaim = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(eq(documents.status, "complete"), eq(documents.claimCount, 0))
      );
    zeroClaimCount = zeroClaim.length;
  } catch (err) {
    dbError = String(err);
  }

  return {
    name: "zeroClaimCompletions",
    status: dbError ? "warn" : zeroClaimCount > 0 ? "fail" : "pass",
    threshold: "0 complete documents with 0 claims",
    actual: dbError
      ? `DB error: ${dbError}`
      : `${zeroClaimCount} zero-claim completion(s)`,
    details: { zeroClaimCount, dbError },
    severity:
      zeroClaimCount > 10
        ? "critical"
        : zeroClaimCount > 0
          ? "warning"
          : "info",
  };
}

// ─── Invariant 4: Model Validation Rate ──────────────────────────────────────

async function checkModelValidationRate(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<InvariantResult> {
  const cutoff = new Date(
    Date.now() - MODEL_VALIDATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  let rate = 1.0;
  let totalModels = 0;
  let validatedModels = 0;
  let dbError: string | null = null;

  try {
    const allModels = await db
      .select({
        id: predictionModels.id,
        validationResult: predictionModels.validationResult,
      })
      .from(predictionModels)
      .where(lt(predictionModels.createdAt, cutoff));

    totalModels = allModels.length;
    validatedModels = allModels.filter(
      m =>
        m.validationResult === "correct" || m.validationResult === "incorrect"
    ).length;
    rate = totalModels > 0 ? validatedModels / totalModels : 1.0;
  } catch (err) {
    dbError = String(err);
  }

  const status: InvariantStatus = dbError
    ? "warn"
    : rate < MODEL_VALIDATION_RATE_THRESHOLD
      ? "fail"
      : "pass";

  return {
    name: "modelValidationRate",
    status,
    threshold: `>= ${Math.round(MODEL_VALIDATION_RATE_THRESHOLD * 100)}% validated within ${MODEL_VALIDATION_WINDOW_DAYS}d`,
    actual: dbError
      ? `DB error: ${dbError}`
      : `${Math.round(rate * 100)}% (${validatedModels}/${totalModels})`,
    details: {
      totalModels,
      validatedModels,
      rate: Math.round(rate * 100) / 100,
      windowDays: MODEL_VALIDATION_WINDOW_DAYS,
      dbError,
    },
    severity:
      rate < 0.3
        ? "critical"
        : rate < MODEL_VALIDATION_RATE_THRESHOLD
          ? "warning"
          : "info",
  };
}

// ─── Invariant 5: Wiki Staleness ─────────────────────────────────────────────

async function checkWikiStaleness(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<InvariantResult> {
  const cutoff = new Date(Date.now() - WIKI_STALE_DAYS * 24 * 60 * 60 * 1000);
  let staleCount = 0;
  let totalPages = 0;
  let dbError: string | null = null;

  try {
    const allPages = await db
      .select({ id: wikiPages.id, updatedAt: wikiPages.updatedAt })
      .from(wikiPages);

    totalPages = allPages.length;
    staleCount = allPages.filter(
      p => p.updatedAt && new Date(p.updatedAt) < cutoff
    ).length;
  } catch (err) {
    dbError = String(err);
  }

  return {
    name: "wikiStaleness",
    status: dbError ? "warn" : staleCount > 0 ? "warn" : "pass",
    threshold: `0 wiki pages unupdated > ${WIKI_STALE_DAYS} days`,
    actual: dbError
      ? `DB error: ${dbError}`
      : `${staleCount}/${totalPages} stale page(s)`,
    details: {
      staleCount,
      totalPages,
      staleDays: WIKI_STALE_DAYS,
      dbError,
    },
    severity: staleCount > 20 ? "warning" : "info",
  };
}

// ─── Aggregate ───────────────────────────────────────────────────────────────

// ─── Invariant 6: Stale PDB Evidence ────────────────────────────────────────

async function checkStalePdbEvidence(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<InvariantResult> {
  const cutoff = new Date(Date.now() - PDB_STALE_DAYS * 24 * 60 * 60 * 1000);

  const [staleResult, totalResult] = await Promise.all([
    db
      .select({ cnt: count() })
      .from(claims)
      .where(
        and(
          isNotNull(claims.pdbEvidenceCheckedAt),
          lt(claims.pdbEvidenceCheckedAt, cutoff)
        )
      ),
    db
      .select({ cnt: count() })
      .from(claims)
      .where(isNotNull(claims.pdbEvidenceCheckedAt)),
  ]);

  const staleCount = Number(staleResult[0]?.cnt ?? 0);
  const totalChecked = Number(totalResult[0]?.cnt ?? 0);
  const staleRatio = totalChecked > 0 ? staleCount / totalChecked : 0;

  const status: InvariantStatus =
    staleCount > 50 ? "fail" : staleCount > 10 ? "warn" : "pass";

  return {
    name: "stalePdbEvidence",
    status,
    threshold: `<= 10 claims with PDB evidence older than ${PDB_STALE_DAYS} days`,
    actual: `${staleCount} stale claims (${(staleRatio * 100).toFixed(1)}% of ${totalChecked} checked)`,
    details: {
      staleCount,
      totalChecked,
      staleRatio,
      cutoffDate: cutoff.toISOString(),
    },
    severity:
      status === "fail" ? "critical" : status === "warn" ? "warning" : "info",
  };
}

// ─── Invariant 7: Low-Confidence Claims ──────────────────────────────────────

async function checkLowConfidenceClaims(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<InvariantResult> {
  const [lowResult, totalResult] = await Promise.all([
    db
      .select({ cnt: count() })
      .from(claims)
      .where(
        and(
          isNotNull(claims.confidenceScore),
          lte(claims.confidenceScore, LOW_CONFIDENCE_THRESHOLD)
        )
      ),
    db
      .select({ cnt: count() })
      .from(claims)
      .where(isNotNull(claims.confidenceScore)),
  ]);

  const lowCount = Number(lowResult[0]?.cnt ?? 0);
  const totalScored = Number(totalResult[0]?.cnt ?? 0);
  const lowRatio = totalScored > 0 ? lowCount / totalScored : 0;

  const status: InvariantStatus =
    lowRatio > LOW_CONFIDENCE_MAX_RATIO
      ? "warn"
      : lowCount > 100
        ? "warn"
        : "pass";

  return {
    name: "lowConfidenceClaims",
    status,
    threshold: `<= ${(LOW_CONFIDENCE_MAX_RATIO * 100).toFixed(0)}% of scored claims below ${LOW_CONFIDENCE_THRESHOLD} confidence`,
    actual: `${lowCount} low-confidence claims (${(lowRatio * 100).toFixed(1)}% of ${totalScored} scored)`,
    details: {
      lowCount,
      totalScored,
      lowRatio,
      threshold: LOW_CONFIDENCE_THRESHOLD,
    },
    severity: status === "warn" ? "warning" : "info",
  };
}

// ─── Main Guardian ────────────────────────────────────────────────────────────

const GUARDIAN_TIMEOUT_MS = 15_000;

export async function runPipelineGuardian(): Promise<PipelineGuardianReport> {
  const startMs = Date.now();

  // 15-second overall timeout — returns unavailable state if exceeded
  const timeoutPromise = new Promise<PipelineGuardianReport>(resolve =>
    setTimeout(
      () =>
        resolve({
          invariants: [],
          overallStatus: "unavailable",
          failCount: 0,
          warnCount: 0,
          checkedAt: new Date().toISOString(),
          durationMs: GUARDIAN_TIMEOUT_MS,
        }),
      GUARDIAN_TIMEOUT_MS
    )
  );

  const runPromise = (async (): Promise<PipelineGuardianReport> => {
    const db = await getDb();
    if (!db) {
      // DB unavailable is treated as a hard failure — the pipeline cannot be
      // verified without database access. PRD-L4: overallStatus must be "fail".
      const errorResult: InvariantResult = {
        name: "dbConnection",
        status: "fail",
        threshold: "DB must be available",
        actual: "DB connection failed",
        details: {},
        severity: "critical",
      };
      return {
        invariants: [errorResult],
        overallStatus: "fail",
        failCount: 1,
        warnCount: 0,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
      };
    }

    const [
      stuck,
      orphans,
      zeroClaim,
      modelRate,
      wikiStale,
      stalePdb,
      lowConfidence,
    ] = await Promise.all([
      checkStuckDocuments(db),
      checkClaimOrphans(db),
      checkZeroClaimCompletions(db),
      checkModelValidationRate(db),
      checkWikiStaleness(db),
      checkStalePdbEvidence(db),
      checkLowConfidenceClaims(db),
    ]);

    const invariants = [
      stuck,
      orphans,
      zeroClaim,
      modelRate,
      wikiStale,
      stalePdb,
      lowConfidence,
    ];
    const failCount = invariants.filter(i => i.status === "fail").length;
    const warnCount = invariants.filter(i => i.status === "warn").length;
    const overallStatus: InvariantStatus =
      failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass";

    return {
      invariants,
      overallStatus,
      failCount,
      warnCount,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    };
  })();

  return Promise.race([runPromise, timeoutPromise]);
}
