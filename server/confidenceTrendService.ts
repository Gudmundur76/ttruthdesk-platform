/**
 * confidenceTrendService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Records and queries confidence score history for claims.
 *
 * API:
 *   recordConfidence(opts)          — insert a new confidence history row
 *   getConfidenceTrend(claimId)     — fetch all history rows for a claim
 *   getLatestConfidence(claimId)    — fetch the most recent row
 *   backfillFromClaims(documentId)  — seed history from existing claims.confidenceScore
 */

import type { ResultSetHeader } from "mysql2";
import { getDb } from "./db";
import { confidenceHistory, claims } from "../drizzle/schema";
import { eq, desc, asc } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordConfidenceOpts {
  claimId: number;
  documentId: number;
  score: number;
  trigger?: string;
  flags?: string[];
}

export interface ConfidenceTrendPoint {
  id: number;
  claimId: number;
  documentId: number;
  score: number;
  trigger: string;
  flags: string[] | null;
  recordedAt: Date;
}

// ─── Record a new confidence score ───────────────────────────────────────────

export async function recordConfidence(opts: RecordConfidenceOpts): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const { claimId, documentId, score, trigger = "initial", flags } = opts;

  // Clamp score to [0, 1]
  const clampedScore = Math.max(0, Math.min(1, score));

  const result = await db.insert(confidenceHistory).values({
    claimId,
    documentId,
    score: clampedScore,
    trigger,
    flags: flags ?? null,
  });

  return (result as unknown as ResultSetHeader).insertId ?? 0;
}

// ─── Get full confidence trend for a claim ────────────────────────────────────

export async function getConfidenceTrend(claimId: number): Promise<ConfidenceTrendPoint[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(confidenceHistory)
    .where(eq(confidenceHistory.claimId, claimId))
    .orderBy(asc(confidenceHistory.recordedAt));

  return rows.map((r) => ({
    id: r.id,
    claimId: r.claimId,
    documentId: r.documentId,
    score: r.score,
    trigger: r.trigger,
    flags: Array.isArray(r.flags) ? (r.flags as string[]) : null,
    recordedAt: r.recordedAt,
  }));
}

// ─── Get the most recent confidence score for a claim ─────────────────────────

export async function getLatestConfidence(claimId: number): Promise<ConfidenceTrendPoint | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(confidenceHistory)
    .where(eq(confidenceHistory.claimId, claimId))
    .orderBy(desc(confidenceHistory.recordedAt))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    claimId: r.claimId,
    documentId: r.documentId,
    score: r.score,
    trigger: r.trigger,
    flags: Array.isArray(r.flags) ? (r.flags as string[]) : null,
    recordedAt: r.recordedAt,
  };
}

// ─── Backfill history from existing claims.confidenceScore ────────────────────

/**
 * Seeds confidence_history from the current confidenceScore values on claims
 * for a given document. Useful for documents processed before this feature
 * was added.
 *
 * Skips claims with null confidenceScore.
 * Does NOT check for duplicates — call only once per document.
 */
export async function backfillFromClaims(documentId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const claimRows = await db
    .select({
      id: claims.id,
      documentId: claims.documentId,
      confidenceScore: claims.confidenceScore,
      confidenceFlags: claims.confidenceFlags,
    })
    .from(claims)
    .where(eq(claims.documentId, documentId));

  let inserted = 0;
  for (const claim of claimRows) {
    if (claim.confidenceScore === null || claim.confidenceScore === undefined) continue;
    await db.insert(confidenceHistory).values({
      claimId: claim.id,
      documentId: claim.documentId,
      score: claim.confidenceScore,
      trigger: "backfill",
      flags: Array.isArray(claim.confidenceFlags) ? claim.confidenceFlags : null,
    });
    inserted++;
  }

  return inserted;
}
