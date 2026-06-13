/**
 * contradictionDetector.ts — Phase 107
 *
 * Contradiction Detection Engine
 *
 * Traverses semantic_similar edges in the knowledge graph (graph_claim_edges)
 * and flags claim pairs where one claim has a "positive" composite truth label
 * and its neighbour has a "negative" label.
 *
 * Positive labels: verified_faithful, partially_supported
 * Negative labels: contradicted, contradicted_amplified
 *
 * Severity classification:
 *   high   — verified_faithful vs contradicted / contradicted_amplified
 *   medium — partially_supported vs contradicted / contradicted_amplified
 *   low    — any other opposing signal combination
 *
 * Persistence is idempotent: the unique index on (claimAId, claimBId) prevents
 * duplicate rows. Pairs are always stored with claimAId < claimBId for canonical
 * ordering. Existing open/reviewed rows are updated in-place; resolved/dismissed
 * rows are left untouched.
 *
 * Called by:
 *   - POST /api/scheduled/contradiction-scan (weekly heartbeat)
 *   - Admin "Run Now" button in AdminCrons dashboard
 */

import { getDb } from "./db";
import { graphClaimEdges, claims, contradictionAlerts } from "../drizzle/schema";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import { logCronRun } from "./cronRunLogger";
import { logger, errData } from "./logger";
const log = logger("contradictionDetector");


// ─── Types ────────────────────────────────────────────────────────────────────

export type ContradictionSeverity = "high" | "medium" | "low";

export interface ContradictionPair {
  claimAId: number;
  claimBId: number;
  claimAVerdict: string | null;
  claimBVerdict: string | null;
  claimALabel: string | null;
  claimBLabel: string | null;
  claimAScore: number | null;
  claimBScore: number | null;
  edgeWeight: number;
  severity: ContradictionSeverity;
}

export interface ContradictionScanResult {
  pairsScanned: number;
  newAlerts: number;
  updatedAlerts: number;
  skippedResolved: number;
  errors: number;
  durationMs: number;
}

// ─── Label classification helpers ────────────────────────────────────────────

const POSITIVE_LABELS = new Set([
  "verified_faithful",
  "partially_supported",
]);

const NEGATIVE_LABELS = new Set([
  "contradicted",
  "contradicted_amplified",
]);

function isPositive(label: string | null): boolean {
  return label !== null && POSITIVE_LABELS.has(label);
}

function isNegative(label: string | null): boolean {
  return label !== null && NEGATIVE_LABELS.has(label);
}

/**
 * Classify the severity of a contradiction pair.
 *
 * high   — one side is verified_faithful, other is contradicted/contradicted_amplified
 * medium — one side is partially_supported, other is contradicted/contradicted_amplified
 * low    — opposing signals but neither side is strongly classified
 */
export function classifySeverity(
  labelA: string | null,
  labelB: string | null
): ContradictionSeverity {
  const aPos = isPositive(labelA);
  const bPos = isPositive(labelB);
  const aNeg = isNegative(labelA);
  const bNeg = isNegative(labelB);

  // Must be opposing to be a contradiction
  if (!(aPos && bNeg) && !(aNeg && bPos)) return "low";

  const posLabel = aPos ? labelA : labelB;
  const negLabel = aNeg ? labelA : labelB;

  if (
    posLabel === "verified_faithful" &&
    (negLabel === "contradicted" || negLabel === "contradicted_amplified")
  ) {
    return "high";
  }

  if (
    posLabel === "partially_supported" &&
    (negLabel === "contradicted" || negLabel === "contradicted_amplified")
  ) {
    return "medium";
  }

  return "low";
}

/**
 * Returns true if the two labels form a detectable contradiction.
 * Requires one positive and one negative label.
 */
export function isContradiction(
  labelA: string | null,
  labelB: string | null
): boolean {
  return (isPositive(labelA) && isNegative(labelB)) ||
    (isNegative(labelA) && isPositive(labelB));
}

// ─── Core scan function ───────────────────────────────────────────────────────

/**
 * Scan all semantic_similar edges and detect contradiction pairs.
 *
 * Strategy:
 * 1. Fetch all semantic_similar edges from graph_claim_edges.
 * 2. Collect the unique set of claim IDs referenced.
 * 3. Batch-fetch composite truth labels for those claims.
 * 4. For each edge, check if the pair forms a contradiction.
 * 5. Upsert into contradiction_alerts (skip resolved/dismissed).
 *
 * @param batchSize  Max edges to process in one run (default 500)
 */
  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export async function runContradictionScan(
  batchSize = 500
): Promise<ContradictionScanResult> {
  const startMs = Date.now();
  let pairsScanned = 0;
  let newAlerts = 0;
  let updatedAlerts = 0;
  let skippedResolved = 0;
  let errors = 0;

  try {
    const db = await getDb();
    if (!db) {
      await logCronRun("contradiction-scan", "error", Date.now() - startMs, "DB unavailable");
      return { pairsScanned, newAlerts, updatedAlerts, skippedResolved, errors: 1, durationMs: Date.now() - startMs };
    }

    // ── Step 1: Fetch semantic_similar edges ──────────────────────────────────
    const edges = await db
      .select({
        sourceClaimId: graphClaimEdges.sourceClaimId,
        targetClaimId: graphClaimEdges.targetClaimId,
        weight: graphClaimEdges.weight,
      })
      .from(graphClaimEdges)
      .where(eq(graphClaimEdges.relationType, "semantic_similar"))
      .limit(batchSize);

    if (edges.length === 0) {
      await logCronRun("contradiction-scan", "skipped", Date.now() - startMs, "No semantic_similar edges found — graph not yet populated");
      return { pairsScanned: 0, newAlerts: 0, updatedAlerts: 0, skippedResolved: 0, errors: 0, durationMs: Date.now() - startMs };
    }

    // ── Step 2: Collect unique claim IDs ──────────────────────────────────────
    const claimIdSet = new Set<number>();
    for (const e of edges) {
      claimIdSet.add(e.sourceClaimId);
      claimIdSet.add(e.targetClaimId);
    }
    const claimIds = Array.from(claimIdSet);

    // ── Step 3: Batch-fetch claim labels ──────────────────────────────────────
    const claimRows = await db
      .select({
        id: claims.id,
        verdict: claims.verdict,
        compositeTruthLabel: claims.compositeTruthLabel,
        compositeTruthScore: claims.compositeTruthScore,
      })
      .from(claims)
      .where(inArray(claims.id, claimIds));

    // Build a lookup map: claimId → { verdict, label, score }
    const claimMap = new Map<
      number,
      { verdict: string | null; label: string | null; score: number | null }
    >();
    for (const row of claimRows) {
      claimMap.set(row.id, {
        verdict: row.verdict ?? null,
        label: row.compositeTruthLabel ?? null,
        score: row.compositeTruthScore ?? null,
      });
    }

    // ── Step 4: Detect contradiction pairs ────────────────────────────────────
    const contradictions: ContradictionPair[] = [];

    for (const edge of edges) {
      pairsScanned++;
      const a = claimMap.get(edge.sourceClaimId);
      const b = claimMap.get(edge.targetClaimId);
      if (!a || !b) continue;

      if (!isContradiction(a.label, b.label)) continue;

      // Canonical ordering: smaller ID first
      const [idA, idB, dataA, dataB] =
        edge.sourceClaimId < edge.targetClaimId
          ? [edge.sourceClaimId, edge.targetClaimId, a, b]
          : [edge.targetClaimId, edge.sourceClaimId, b, a];

      contradictions.push({
        claimAId: idA,
        claimBId: idB,
        claimAVerdict: dataA.verdict,
        claimBVerdict: dataB.verdict,
        claimALabel: dataA.label,
        claimBLabel: dataB.label,
        claimAScore: dataA.score,
        claimBScore: dataB.score,
        edgeWeight: edge.weight,
        severity: classifySeverity(dataA.label, dataB.label),
      });
    }

    // ── Step 5: Upsert into contradiction_alerts ──────────────────────────────
    for (const pair of contradictions) {
      try {
        // Check if this pair already exists
        const existing = await db
          .select({ id: contradictionAlerts.id, status: contradictionAlerts.status })
          .from(contradictionAlerts)
          .where(
            and(
              eq(contradictionAlerts.claimAId, pair.claimAId),
              eq(contradictionAlerts.claimBId, pair.claimBId)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          const row = existing[0];
          // Skip resolved/dismissed — human decision should not be overwritten
          if (row.status === "resolved" || row.status === "dismissed") {
            skippedResolved++;
            continue;
          }
          // Update open/reviewed rows with fresh signal data
          await db
            .update(contradictionAlerts)
            .set({
              claimAVerdict: pair.claimAVerdict,
              claimBVerdict: pair.claimBVerdict,
              claimALabel: pair.claimALabel,
              claimBLabel: pair.claimBLabel,
              claimAScore: pair.claimAScore,
              claimBScore: pair.claimBScore,
              edgeWeight: pair.edgeWeight,
              severity: pair.severity,
            })
            .where(eq(contradictionAlerts.id, row.id));
          updatedAlerts++;
        } else {
          // Insert new alert
          await db.insert(contradictionAlerts).values({
            claimAId: pair.claimAId,
            claimBId: pair.claimBId,
            claimAVerdict: pair.claimAVerdict,
            claimBVerdict: pair.claimBVerdict,
            claimALabel: pair.claimALabel,
            claimBLabel: pair.claimBLabel,
            claimAScore: pair.claimAScore,
            claimBScore: pair.claimBScore,
            edgeWeight: pair.edgeWeight,
            severity: pair.severity,
            status: "open",
          });
          newAlerts++;
        }
      } catch (pairErr) {
        // Duplicate key on race condition — safe to ignore
        const msg = String(pairErr);
        if (!msg.includes("Duplicate entry") && !msg.includes("unique constraint")) {
          log.warn("[ContradictionDetector] Pair upsert error:", errData(pairErr));
          errors++;
        }
      }
    }

    const durationMs = Date.now() - startMs;
    const summary =
      `Scanned ${pairsScanned} edges → ${contradictions.length} contradiction pairs: ` +
      `${newAlerts} new, ${updatedAlerts} updated, ${skippedResolved} skipped (resolved/dismissed), ${errors} errors`;

    await logCronRun("contradiction-scan", errors > 0 ? "error" : "ok", durationMs, summary);

    log.info(`[ContradictionDetector] ${summary}`);
    return { pairsScanned, newAlerts, updatedAlerts, skippedResolved, errors, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errMsg = String(err).substring(0, 300);
    log.error("[ContradictionDetector] Fatal error:", errData(err));
    await logCronRun("contradiction-scan", "error", durationMs, `Fatal: ${errMsg}`);
    return { pairsScanned, newAlerts, updatedAlerts, skippedResolved, errors: errors + 1, durationMs };
  }
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/**
 * Fetch open contradiction alerts for display in the admin UI.
 * Returns the most severe / most recent first.
 */
export async function getOpenContradictionAlerts(limit = 50) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(contradictionAlerts)
    .where(
      or(
        eq(contradictionAlerts.status, "open"),
        eq(contradictionAlerts.status, "reviewed")
      )
    )
    .orderBy(
      sql`FIELD(${contradictionAlerts.severity}, 'high', 'medium', 'low')`,
      sql`${contradictionAlerts.detectedAt} DESC`
    )
    .limit(limit);
}

/**
 * Count open contradiction alerts grouped by severity.
 */
export async function getContradictionAlertCounts(): Promise<{
  high: number;
  medium: number;
  low: number;
  total: number;
}> {
  const db = await getDb();
  if (!db) return { high: 0, medium: 0, low: 0, total: 0 };

  const rows = await db
    .select({
      severity: contradictionAlerts.severity,
      count: sql<number>`COUNT(*)`,
    })
    .from(contradictionAlerts)
    .where(
      or(
        eq(contradictionAlerts.status, "open"),
        eq(contradictionAlerts.status, "reviewed")
      )
    )
    .groupBy(contradictionAlerts.severity);

  const counts = { high: 0, medium: 0, low: 0, total: 0 };
  for (const row of rows) {
    const n = Number(row.count);
    if (row.severity === "high") counts.high = n;
    else if (row.severity === "medium") counts.medium = n;
    else if (row.severity === "low") counts.low = n;
    counts.total += n;
  }
  return counts;
}

/**
 * Update the status of a contradiction alert.
 * Used by the admin UI to mark alerts as reviewed/resolved/dismissed.
 */
export async function updateContradictionAlertStatus(
  alertId: number,
  status: "open" | "reviewed" | "resolved" | "dismissed",
  resolutionNotes?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(contradictionAlerts)
    .set({
      status,
      resolutionNotes: resolutionNotes ?? null,
    })
    .where(eq(contradictionAlerts.id, alertId));
}
