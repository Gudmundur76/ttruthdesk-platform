/**
 * mrAgentContradictionPersist.ts
 *
 * Gap A bridge: persists real-time MRAgent contradiction detections into the
 * same `contradiction_alerts` table that the weekly `contradictionDetector.ts`
 * batch scan writes to.
 *
 * Why this matters:
 *   - contradictionDetector.ts runs weekly over graph_claim_edges (structural)
 *   - mrAgentContradictionCheck runs per-claim in real-time (episodic memory)
 *   Both detect contradictions but previously wrote to different places.
 *   This module closes the gap so all contradiction signals are queryable
 *   from one table and visible in the same Telegram alerts / admin UI.
 *
 * Design:
 *   - Uses the same upsert pattern as contradictionDetector.ts (skip resolved/
 *     dismissed, update open/reviewed, insert new)
 *   - claimAId = the new claim being verified
 *   - claimBId = the stored episode's origin claim ID (parsed from episodeId)
 *   - edgeWeight = MRAgent similarity score
 *   - severity derived from similarity score (≥0.95 → high, ≥0.85 → medium, else low)
 *   - source tag stored in resolutionNotes to distinguish from batch-scan alerts
 *   - Non-blocking: never throws, all errors are logged
 */
import { getDb } from "./db";
import { contradictionAlerts } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { logger, errData } from "./logger";
import type { MrAgentContradictionResult } from "./mrAgentContradictionCheck";

const log = logger("mrAgentContradictionPersist");

// ── Severity mapping ──────────────────────────────────────────────────────────
function deriveSeverity(
  score: number
): "high" | "medium" | "low" {
  if (score >= 0.95) return "high";
  if (score >= 0.85) return "medium";
  return "low";
}

/**
 * Parse the origin claim ID from an MRAgent episode ID.
 * Episode IDs are formatted as: "claim-<claimId>-<timestamp>"
 * Returns null if the format does not match.
 */
function parseOriginClaimId(episodeId: string): number | null {
  const match = episodeId.match(/^claim-(\d+)-/);
  if (!match || !match[1]) return null;
  const id = parseInt(match[1], 10);
  return isNaN(id) ? null : id;
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Persist a real-time MRAgent contradiction detection into contradiction_alerts.
 *
 * Skips silently if:
 *   - detected is false
 *   - storedEpisodeId cannot be parsed to a claim ID
 *   - DB is unavailable
 *
 * Never throws.
 */
export async function persistMrAgentContradiction(
  result: MrAgentContradictionResult
): Promise<void> {
  if (!result.detected) return;
  if (!result.storedEpisodeId) return;

  const storedClaimId = parseOriginClaimId(result.storedEpisodeId);
  if (!storedClaimId) {
    log.warn(
      `[MRAgentPersist] Cannot parse origin claimId from episodeId "${result.storedEpisodeId}" — skipping DB write`,
      { episodeId: result.storedEpisodeId }
    );
    return;
  }

  const claimAId = result.claimId;
  const claimBId = storedClaimId;
  const score = result.similarityScore ?? 0.8;
  const severity = deriveSeverity(score);
  const sourceTag = `[mrAgent:realtime] detected=${result.detectedAt}`;

  try {
    const db = await getDb();
    if (!db) return;

    // Check for existing pair (either direction — A/B or B/A)
    const existing = await db
      .select({ id: contradictionAlerts.id, status: contradictionAlerts.status })
      .from(contradictionAlerts)
      .where(
        and(
          eq(contradictionAlerts.claimAId, claimAId),
          eq(contradictionAlerts.claimBId, claimBId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      // Respect human decisions — never overwrite resolved/dismissed
      if (row.status === "resolved" || row.status === "dismissed") {
        log.debug(
          `[MRAgentPersist] Alert for (${claimAId}, ${claimBId}) already ${row.status} — skipping`,
          { claimAId, claimBId }
        );
        return;
      }
      // Refresh signal data on open/reviewed rows
      await db
        .update(contradictionAlerts)
        .set({
          claimAVerdict: result.newVerdict,
          claimBVerdict: result.storedVerdict ?? null,
          edgeWeight: score,
          severity,
          resolutionNotes: sourceTag,
        })
        .where(eq(contradictionAlerts.id, row.id));
      log.info(
        `[MRAgentPersist] Updated contradiction alert id=${row.id} for (${claimAId}, ${claimBId})`,
        { claimAId, claimBId, severity, score }
      );
    } else {
      await db.insert(contradictionAlerts).values({
        claimAId,
        claimBId,
        claimAVerdict: result.newVerdict,
        claimBVerdict: result.storedVerdict ?? null,
        edgeWeight: score,
        severity,
        status: "open",
        resolutionNotes: sourceTag,
      });
      log.info(
        `[MRAgentPersist] Inserted new contradiction alert for (${claimAId}, ${claimBId})`,
        { claimAId, claimBId, severity, score }
      );
    }
  } catch (err) {
    // Duplicate key on race condition — safe to ignore
    const msg = String(err);
    if (msg.includes("Duplicate entry") || msg.includes("unique constraint")) {
      return;
    }
    log.warn(
      `[MRAgentPersist] DB write failed for (${claimAId}, ${claimBId}) (non-fatal)`,
      errData(err)
    );
  }
}
