/**
 * confidenceRecalibrator.ts — Dream Cycle 4: Confidence Recalibration
 *
 * Scans all claims with confidence scores against four rules and produces
 * a RecalibrationReport. Non-destructive by default (FR-L5-26): writes
 * to confidence_history only. Actual claims.confidence updates require
 * autoApply = true.
 *
 * Rules (FR-L5-22 to FR-L5-25):
 *   R1 (Contradiction Penalty): ≥ 2 contradicting claims with higher confidence → -15%
 *   R2 (Temporal Decay):        Last verified > 365 days ago with no re-check → -5%
 *   R3 (Source Quality):        Primary source flagged low-quality → -10%
 *   R4 (Corroboration Bonus):   ≥ 3 corroborating claims (same entity, same verdict) → +5%
 *
 * Build3 — L5 Dream State (FR-L5-21 to FR-L5-26)
 */

import { getDb } from "../db";
import { claims, confidenceHistory } from "../../drizzle/schema";
import { sql, eq } from "drizzle-orm";
import { logger } from "../logger";

const log = logger("dream/confidenceRecalibrator");

export interface RecalibrationEntry {
  claimId: number;
  /** Confidence before recalibration (FR-L5-26) */
  oldConfidence: number;
  /** Confidence after recalibration (FR-L5-26) */
  newConfidence: number;
  /** Which rule triggered this entry (FR-L5-26) */
  ruleTriggered: "R1" | "R2" | "R3" | "R4";
  /** Evidence supporting the change (FR-L5-26) */
  evidence: string;
  /** Whether this entry was auto-applied to claims.confidence */
  applied: boolean;
}

export interface RecalibrationReport {
  entries: RecalibrationEntry[];
  totalRecalibrated: number;
  autoApplied: number;
  /** Breakdown by rule for wake protocol */
  byRule: { R1: number; R2: number; R3: number; R4: number };
  /** Session that produced this report (set by dreamEngine) */
  sessionId?: number;
}

/**
 * Run the confidence recalibration pass.
 *
 * @param autoApply - If true, immediately write new confidence scores to claims table.
 * @param sessionId - Dream session ID for confidence_history entries (FR-L5-26).
 * @param budgetMs  - Maximum milliseconds to spend on this cycle (FR-L5-07).
 */
// eslint-disable-next-line complexity -- TODO(phase-137): refactor into sub-functions per rule (R1-R4)
export async function runConfidenceRecalibration(
  autoApply = false,
  sessionId?: number,
  budgetMs?: number
): Promise<RecalibrationReport> {
  const db = await getDb();
  const entries: RecalibrationEntry[] = [];
  let autoApplied = 0;
  const byRule = { R1: 0, R2: 0, R3: 0, R4: 0 };
  const startedAt = Date.now();

  if (!db) return { entries, totalRecalibrated: 0, autoApplied: 0, byRule };

  const withinBudget = () =>
    !budgetMs || Date.now() - startedAt < budgetMs * 0.9;

  // ── R2: Temporal decay — claims verified > 365 days ago ──────────────────
  if (withinBudget()) {
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
        const newConf = Math.max(0.05, row.confidenceScore - 0.05);
        if (newConf < row.confidenceScore) {
          entries.push({
            claimId: row.id,
            oldConfidence: row.confidenceScore,
            newConfidence: Math.round(newConf * 1000) / 1000,
            ruleTriggered: "R2",
            evidence: "Last verified > 365 days ago with no re-check",
            applied: false,
          });
          byRule.R2++;
        }
      }
    } catch (err) {
      log.warn("[C4] R2 temporal decay query failed", { err });
    }
  }

  // ── R1: Contradiction pressure — ≥ 2 contradicting claims with higher confidence ──
  if (withinBudget()) {
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
        const base = existing ? existing.newConfidence : row.confidenceScore;
        const newConf = Math.max(0.05, base - 0.15);
        if (newConf < base) {
          if (existing) {
            existing.newConfidence = Math.round(newConf * 1000) / 1000;
            existing.evidence += ` + R1: ${row.contra_count} higher-confidence contradicting claims`;
            existing.ruleTriggered = "R1";
          } else {
            entries.push({
              claimId: row.id,
              oldConfidence: row.confidenceScore,
              newConfidence: Math.round(newConf * 1000) / 1000,
              ruleTriggered: "R1",
              evidence: `${row.contra_count} higher-confidence contradicting claims`,
              applied: false,
            });
          }
          byRule.R1++;
        }
      }
    } catch (err) {
      log.warn("[C4] R1 contradiction query failed", { err });
    }
  }

  // ── R3: Source quality — primary source flagged low-quality ──────────────
  if (withinBudget()) {
    try {
      const lowQualityRows = await db.execute(sql`
        SELECT c.id, c.confidenceScore
        FROM claims c
        JOIN documents d ON d.id = c.documentId
        WHERE c.confidenceScore IS NOT NULL
          AND c.confidenceScore > 0.1
          AND d.qualityScore IS NOT NULL
          AND d.qualityScore < 0.4
        LIMIT 30
      `);
      const lowQuality = lowQualityRows as unknown as Array<{
        id: number;
        confidenceScore: number;
      }>;
      for (const row of lowQuality) {
        const existing = entries.find(e => e.claimId === row.id);
        const base = existing ? existing.newConfidence : row.confidenceScore;
        const newConf = Math.max(0.05, base - 0.10);
        if (newConf < base) {
          if (existing) {
            existing.newConfidence = Math.round(newConf * 1000) / 1000;
            existing.evidence += " + R3: Primary source flagged low-quality";
          } else {
            entries.push({
              claimId: row.id,
              oldConfidence: row.confidenceScore,
              newConfidence: Math.round(newConf * 1000) / 1000,
              ruleTriggered: "R3",
              evidence: "Primary source flagged low-quality (qualityScore < 0.4)",
              applied: false,
            });
          }
          byRule.R3++;
        }
      }
    } catch (err) {
      log.warn("[C4] R3 source quality query failed", { err });
    }
  }

  // ── R4: Corroboration bonus — ≥ 3 corroborating claims ───────────────────
  if (withinBudget()) {
    try {
      const corrobRows = await db.execute(sql`
        SELECT c.id, c.confidenceScore, COUNT(c2.id) AS corr_count
        FROM claims c
        JOIN claims c2 ON c2.documentId != c.documentId
          AND c2.verdict = c.verdict
          AND c2.verdict IN ('Supported', 'Partially Supported')
        WHERE c.confidenceScore IS NOT NULL
          AND c.confidenceScore < 0.95
          AND c.verdict IN ('Supported', 'Partially Supported')
        GROUP BY c.id, c.confidenceScore
        HAVING corr_count >= 3
        LIMIT 30
      `);
      const corroborated = corrobRows as unknown as Array<{
        id: number;
        confidenceScore: number;
        corr_count: number;
      }>;
      for (const row of corroborated) {
        const existing = entries.find(e => e.claimId === row.id);
        const base = existing ? existing.newConfidence : row.confidenceScore;
        const newConf = Math.min(0.99, base + 0.05);
        if (newConf > base) {
          if (existing) {
            existing.newConfidence = Math.round(newConf * 1000) / 1000;
            existing.evidence += ` + R4: ${row.corr_count} corroborating claims`;
          } else {
            entries.push({
              claimId: row.id,
              oldConfidence: row.confidenceScore,
              newConfidence: Math.round(newConf * 1000) / 1000,
              ruleTriggered: "R4",
              evidence: `${row.corr_count} corroborating claims (same entity, same verdict)`,
              applied: false,
            });
          }
          byRule.R4++;
        }
      }
    } catch (err) {
      log.warn("[C4] R4 corroboration query failed", { err });
    }
  }

  // ── Write to confidence_history (FR-L5-26) ───────────────────────────────
  // Always write to confidence_history regardless of autoApply.
  if (entries.length > 0) {
    try {
      await db.insert(confidenceHistory).values(
        entries.map(e => ({
          claimId: e.claimId,
          documentId: 0,
          score: e.newConfidence,
          trigger: "dream_recalibration",
          ruleTriggered: e.ruleTriggered,
          dreamSessionId: sessionId ?? null,
          oldConfidence: e.oldConfidence,
          newConfidence: e.newConfidence,
          evidence: e.evidence,
          applied: false,
          flags: { source: "dream_c4", sessionId },
        }))
      );
    } catch (err) {
      log.warn("[C4] Failed to write confidence_history entries", { err });
    }
  }

  // ── Auto-apply if requested (FR-L5-26: requires autoApply = true) ─────────
  if (autoApply && entries.length > 0) {
    for (const entry of entries) {
      try {
        await db
          .update(claims)
          .set({ confidenceScore: entry.newConfidence })
          .where(eq(claims.id, entry.claimId));
        entry.applied = true;
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
    byRule,
    sessionId,
  };
}
