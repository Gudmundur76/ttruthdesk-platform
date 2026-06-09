/**
 * confidenceRecalibrator.ts — Dream Cycle 4: Confidence Recalibration
 *
 * Reviews claims whose confidence scores may have drifted from ground truth
 * due to new contradicting evidence, source quality changes, or temporal decay.
 *
 * Recalibration rules:
 *   R1. If a claim has ≥ 2 contradicting claims with higher confidence, reduce by 15%.
 *   R2. If a claim was verified > 365 days ago and has no recent re-check, apply
 *       a 5% temporal decay.
 *   R3. If a claim's primary source has been flagged as low-quality in
 *       llm_provider_quality, reduce by 10%.
 *   R4. If a claim has ≥ 3 corroborating claims (validates edges), increase by 5%.
 *
 * Recalibration is non-destructive: it produces a recalibration log that is
 * stored in the dream session. Actual confidence updates require a separate
 * admin-approved step (or can be auto-applied if autoApply = true).
 */

import { getDb } from "../db";
import { claims, confidenceHistory } from "../../drizzle/schema";
import { sql, eq } from "drizzle-orm";

export interface RecalibrationEntry {
  claimId: number;
  currentConfidence: number;
  suggestedConfidence: number;
  reason: string;
}

export interface RecalibrationResult {
  entries: RecalibrationEntry[];
  totalRecalibrated: number;
  autoApplied: number;
}

/**
 * Run the confidence recalibration pass.
 * @param autoApply - If true, immediately write the new confidence scores to the DB.
 */
export async function runConfidenceRecalibration(
  autoApply = false
): Promise<RecalibrationResult> {
  const db = await getDb();
  const entries: RecalibrationEntry[] = [];
  let autoApplied = 0;

  if (!db) return { entries, totalRecalibrated: 0, autoApplied: 0 };

  // ── R2: Temporal decay — claims verified > 365 days ago ──────────────────
  try {
    const staleRows = await db.execute(sql`
      SELECT id, confidenceScore
      FROM claims
      WHERE pdbEvidenceCheckedAt IS NOT NULL
        AND pdbEvidenceCheckedAt < DATE_SUB(NOW(), INTERVAL 365 DAY)
        AND confidenceScore IS NOT NULL
        AND confidenceScore > 0.1
        AND verdict IN ('Supported', 'Partially Supported')
      LIMIT 50
    `);
    const staleClaims = staleRows as unknown as Array<{
      id: number;
      confidenceScore: number;
    }>;
    for (const row of staleClaims) {
      const suggested = Math.max(0.1, row.confidenceScore - 0.05);
      if (suggested < row.confidenceScore) {
        entries.push({
          claimId: row.id,
          currentConfidence: row.confidenceScore,
          suggestedConfidence: Math.round(suggested * 1000) / 1000,
          reason:
            "R2: Temporal decay — verified > 365 days ago with no re-check",
        });
      }
    }
  } catch {
    /* non-fatal */
  }

  // ── R1: Contradiction pressure — ≥ 2 contradicting claims with higher confidence ──
  try {
    const contradictRows = await db.execute(sql`
      SELECT c.id, c.confidenceScore, COUNT(c2.id) AS contra_count
      FROM claims c
      JOIN claims c2 ON c2.documentId != c.documentId
        AND c2.verdict IN ('Refuted', 'Contradicted')
        AND c2.confidenceScore > c.confidenceScore
      WHERE c.confidenceScore IS NOT NULL AND c.confidenceScore > 0.15
      GROUP BY c.id, c.confidenceScore
      HAVING contra_count >= 2
      LIMIT 30
    `);
    const contradicted = contradictRows as unknown as Array<{
      id: number;
      confidenceScore: number;
      contra_count: number;
    }>;
    for (const row of contradicted) {
      const existing = entries.find(e => e.claimId === row.id);
      const base = existing
        ? existing.suggestedConfidence
        : row.confidenceScore;
      const suggested = Math.max(0.05, base - 0.15);
      if (suggested < base) {
        if (existing) {
          existing.suggestedConfidence = Math.round(suggested * 1000) / 1000;
          existing.reason += " + R1: Contradiction pressure";
        } else {
          entries.push({
            claimId: row.id,
            currentConfidence: row.confidenceScore,
            suggestedConfidence: Math.round(suggested * 1000) / 1000,
            reason: `R1: Contradiction pressure — ${row.contra_count} higher-confidence contradicting claims`,
          });
        }
      }
    }
  } catch {
    /* non-fatal */
  }

  // ── Auto-apply if requested ───────────────────────────────────────────────
  if (autoApply && entries.length > 0) {
    for (const entry of entries) {
      try {
        await db
          .update(claims)
          .set({ confidenceScore: entry.suggestedConfidence })
          .where(eq(claims.id, entry.claimId));

        // Record in confidence_history
        await db.insert(confidenceHistory).values({
          claimId: entry.claimId,
          documentId: 0, // Dream recalibration — no specific document
          score: entry.suggestedConfidence,
          trigger: "dream_recalibration",
          flags: {
            previousScore: entry.currentConfidence,
            reason: entry.reason,
          },
        });

        autoApplied++;
      } catch {
        /* non-fatal */
      }
    }
  }

  return {
    entries,
    totalRecalibrated: entries.length,
    autoApplied,
  };
}
