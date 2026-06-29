/**
 * mrAgentContradictionCheck.ts
 *
 * Lightweight real-time contradiction check using the evolva-mragent
 * memory server.  This is a COMPLEMENT to the existing graph-based
 * contradictionDetector.ts (Phase 107 weekly scan), NOT a replacement.
 *
 * Difference from contradictionDetector.ts:
 *   - contradictionDetector.ts  → weekly batch scan over graph_claim_edges
 *                                  (semantic_similar edges, full knowledge graph)
 *   - mrAgentContradictionCheck → real-time per-claim check via MRAgent /query
 *                                  (episodic memory, fires immediately after verdict)
 *
 * Verdict polarity:
 *   POSITIVE  → Supported, Partially Supported
 *   NEGATIVE  → Contradicted
 *   NEUTRAL   → Ambiguous, Insufficient Evidence, Needs Expert Review
 *
 * NEUTRAL verdicts are never flagged — they are inconclusive by definition.
 *
 * All failures are silently swallowed so that a downed memory server never
 * interrupts claim verification.
 */

import { querySimilarVerdicts, type MemoryEpisode } from "./mrAgentClient";
import { logger, errData } from "./logger";

const log = logger("mrAgentContradictionCheck");

// Minimum cosine similarity from MRAgent for a stored episode to be
// considered "similar enough" to trigger a contradiction check.
const SIMILARITY_THRESHOLD = 0.8;

// ── Verdict polarity ──────────────────────────────────────────────────────────

type VerdictPolarity = "positive" | "negative" | "neutral";

function polarity(verdict: string): VerdictPolarity {
  const v = verdict.trim().toLowerCase();
  if (v === "supported" || v === "partially supported") return "positive";
  if (v === "contradicted") return "negative";
  return "neutral";
}

// ── Result type ───────────────────────────────────────────────────────────────

export interface MrAgentContradictionResult {
  detected: boolean;
  claimId: number;
  newVerdict: string;
  storedEpisodeId?: string;
  storedVerdict?: string;
  storedCitation?: string;
  similarityScore?: number;
  detectedAt: string;
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Check whether the new verdict for a claim contradicts any similar claim
 * stored in the MRAgent episodic memory.
 *
 * Returns a result object (detected=false when no contradiction found or
 * when the memory server is unavailable).
 *
 * Non-blocking: all errors are caught and logged; never throws.
 */
export async function checkMrAgentContradiction(
  claimId: number,
  claimText: string,
  newVerdict: string
): Promise<MrAgentContradictionResult> {
  const base: MrAgentContradictionResult = {
    detected: false,
    claimId,
    newVerdict,
    detectedAt: new Date().toISOString(),
  };

  const newPolarity = polarity(newVerdict);
  // NEUTRAL verdicts cannot contradict anything
  if (newPolarity === "neutral") return base;

  try {
    const similar = await querySimilarVerdicts(claimText, 5);
    if (!similar || similar.length === 0) return base;

    // Each stored episode text is formatted as:
    //   "VERDICT: <verdict>\nCLAIM: <claimText>"
    // (written by trainingExporter.ts)
    const contradiction = findContradictingEpisode(similar, newPolarity);
    if (!contradiction) return base;

    const storedVerdict = extractVerdict(contradiction.text);
    if (!storedVerdict) return base;

    log.warn(
      `[MRAgentContradiction] Claim ${claimId}: new="${newVerdict}" contradicts stored="${storedVerdict}" (score=${contradiction.score.toFixed(3)})`,
      { claimId, newVerdict, storedVerdict, score: contradiction.score }
    );

    return {
      detected: true,
      claimId,
      newVerdict,
      storedEpisodeId: contradiction.episode_id,
      storedVerdict,
      storedCitation: contradiction.citation ?? undefined,
      similarityScore: contradiction.score,
      detectedAt: new Date().toISOString(),
    };
  } catch (err) {
    log.warn(
      `[MRAgentContradiction] Claim ${claimId} check failed (non-fatal)`,
      errData(err)
    );
    return base;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findContradictingEpisode(
  episodes: MemoryEpisode[],
  newPolarity: VerdictPolarity
): MemoryEpisode | undefined {
  return episodes.find(ep => {
    if (ep.score < SIMILARITY_THRESHOLD) return false;
    const storedVerdict = extractVerdict(ep.text);
    if (!storedVerdict) return false;
    const storedPolarity = polarity(storedVerdict);
    if (storedPolarity === "neutral") return false;
    return storedPolarity !== newPolarity;
  });
}

function extractVerdict(episodeText: string): string | null {
  const match = episodeText.match(/^VERDICT:\s*(.+?)(?:\n|$)/);
  return match ? match[1].trim() : null;
}
