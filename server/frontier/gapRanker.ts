/**
 * gapRanker.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontier Engine — Layer 2: Gap Priority Scoring
 *
 * Implements the paper's priority formula:
 *   priority = contradictionSeverity × entityCentrality × recencyOfConflict × communityDemand
 *
 * Scores are normalized to [0, 100]. Higher = more urgent to close.
 *
 * Build3 additions (FR-L3-09 through FR-L3-14):
 *   - directiveBoost: L2 directive multiplier applied on top of base score
 *   - rank: integer rank assigned after sorting (1 = highest priority)
 *   - detectionCount: incremented each time a gap is re-detected
 *   - lastDetectedAt: updated each time a gap is re-detected
 *
 * The Frontier Engine ONLY updates knowledge_gaps columns.
 * It never touches graph_entities, graphRelations, claims, or verdicts.
 */

import { getDb } from "../db";
import { knowledgeGaps } from "../../drizzle/schema";
import { eq, sql, inArray } from "drizzle-orm";

// ─── DB helper ────────────────────────────────────────────────────────────────
async function getDbOrThrow() {
  const d = await getDb();
  if (!d) throw new Error("[FrontierEngine] Database not available");
  return d;
}

// ─── Scoring Components ───────────────────────────────────────────────────────

/**
 * contradictionSeverity: How many contradicting edges exist for this gap.
 * Normalized: 1 contradiction = 0.2, 5+ = 1.0
 */
function scoreContradictionSeverity(contradictionCount: number): number {
  return Math.min(contradictionCount / 5, 1.0);
}

/**
 * entityCentrality: How many relations the primary entity has in the graph.
 * More connected = more important to resolve.
 * Normalized: 1 relation = 0.1, 10+ = 1.0
 */
function scoreEntityCentrality(relationCount: number): number {
  return Math.min(relationCount / 10, 1.0);
}

/**
 * recencyOfConflict: How recently the gap was opened.
 * Gaps opened within 7 days score 1.0; older gaps decay exponentially.
 */
function scoreRecency(openedAt: Date): number {
  const ageMs = Date.now() - openedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Exponential decay: half-life of 30 days
  return Math.exp(-ageDays / 30);
}

/**
 * communityDemand: How many claims contributed to this gap.
 * More claims = more community interest in resolving it.
 * Normalized: 1 claim = 0.1, 10+ = 1.0
 */
function scoreCommunityDemand(contributingClaimCount: number): number {
  return Math.min(contributingClaimCount / 10, 1.0);
}

/**
 * gapTypeMultiplier: Different gap types have different base urgency.
 */
function gapTypeMultiplier(gapType: string): number {
  switch (gapType) {
    case "contradiction":
      return 1.0; // Highest — active disagreement
    case "evidence":
      return 0.8; // High — claims can't be verified
    case "temporal":
      return 0.6; // Medium — may be stale
    case "structural":
      return 0.4; // Lower — isolated but not wrong
    case "hypothesis":
      return 0.7; // Medium-high — testable prediction
    case "quantum_provenance":
      return 0.75; // Between QUANTUM_DUAL (0.9) and QUANTUM_SINGLE (0.6) — hardware-scored provenance
    default:
      return 0.5;
  }
}

// ─── Core: computePriorityScore ───────────────────────────────────────────────

export interface GapScoringInput {
  id: number;
  gapType: string;
  contributingClaimCount: number;
  openedAt: Date;
  entityAId?: number | null;
  entityBId?: number | null;
  /** Build3: directive boost from L2 (0.0–1.0, default 0) */
  directiveBoost?: number;
}

export interface GapScoringResult {
  gapId: number;
  priorityScore: number;
  components: {
    contradictionSeverity: number;
    entityCentrality: number;
    recencyOfConflict: number;
    communityDemand: number;
    gapTypeMultiplier: number;
    /** Build3: directive boost multiplier applied to base score */
    directiveBoost: number;
  };
}

export async function computePriorityScore(
  gap: GapScoringInput
): Promise<GapScoringResult> {
  const db = await getDbOrThrow();

  // Get entity centrality (relation count for primary entity)
  let relationCount = 0;
  if (gap.entityAId) {
    try {
      const result = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM graph_relations
        WHERE sourceEntityId = ${gap.entityAId} OR targetEntityId = ${gap.entityAId}
      `);
      const rows = result[0] as unknown as Array<{ cnt: number }>;
      relationCount = rows[0]?.cnt ?? 0;
    } catch {
      relationCount = 0;
    }
  }

  // Get contradiction count for contradiction gaps
  let contradictionCount = 0;
  if (gap.gapType === "contradiction" && gap.entityAId && gap.entityBId) {
    try {
      const result = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM graph_relations
        WHERE relationType = 'contradicts'
          AND sourceEntityId = ${gap.entityAId}
          AND targetEntityId = ${gap.entityBId}
      `);
      const rows = result[0] as unknown as Array<{ cnt: number }>;
      contradictionCount = rows[0]?.cnt ?? 0;
    } catch {
      contradictionCount = 0;
    }
  }

  const directiveBoost = Math.min(Math.max(gap.directiveBoost ?? 0, 0), 1.0);

  const components = {
    contradictionSeverity: scoreContradictionSeverity(contradictionCount),
    entityCentrality: scoreEntityCentrality(relationCount),
    recencyOfConflict: scoreRecency(gap.openedAt),
    communityDemand: scoreCommunityDemand(gap.contributingClaimCount),
    gapTypeMultiplier: gapTypeMultiplier(gap.gapType),
    directiveBoost,
  };

  // Composite score: geometric mean of the four factors × type multiplier × 100
  const geometricMean = Math.pow(
    components.contradictionSeverity *
      components.entityCentrality *
      components.recencyOfConflict *
      components.communityDemand,
    0.25
  );

  // For gaps with no entity (evidence/temporal), use arithmetic components
  const baseScore = gap.entityAId
    ? geometricMean
    : components.recencyOfConflict * 0.4 + components.communityDemand * 0.6;

  // Build3: Apply directive boost as a multiplier (1.0 + directiveBoost)
  // A directiveBoost of 1.0 doubles the base score.
  const boostedScore = baseScore * (1.0 + directiveBoost);

  const priorityScore =
    Math.round(boostedScore * components.gapTypeMultiplier * 100 * 100) / 100;

  return { gapId: gap.id, priorityScore, components };
}

// ─── Public: rankAllOpenGaps ──────────────────────────────────────────────────

/**
 * Scores all open/pursued gaps and updates their priorityScore, rank,
 * detectionCount, and lastDetectedAt in the DB.
 * Returns the number of gaps scored.
 *
 * Build3: Also writes the integer rank (1 = highest) after sorting.
 */
export async function rankAllOpenGaps(
  focusGapIds: string[] = []
): Promise<number> {
  const db = await getDbOrThrow();

  const openGaps = await db
    .select({
      id: knowledgeGaps.id,
      gapType: knowledgeGaps.gapType,
      contributingClaimCount: knowledgeGaps.contributingClaimCount,
      openedAt: knowledgeGaps.openedAt,
      entityAId: knowledgeGaps.entityAId,
      entityBId: knowledgeGaps.entityBId,
      directiveBoost: knowledgeGaps.directiveBoost,
    })
    .from(knowledgeGaps)
    .where(inArray(knowledgeGaps.status, ["open", "pursued", "narrowing"]));

  // Build3: Apply focus boost to gaps targeted by directives
  const focusGapIdSet = new Set(focusGapIds.map(Number));

  const scored: Array<{ id: number; priorityScore: number }> = [];

  for (const gap of openGaps) {
    try {
      // Build3: If this gap is in focusGapIds, apply max directive boost
      const directiveBoost = focusGapIdSet.has(gap.id)
        ? 1.0
        : (gap.directiveBoost ?? 0);

      const result = await computePriorityScore({
        ...gap,
        openedAt:
          gap.openedAt instanceof Date ? gap.openedAt : new Date(gap.openedAt),
        directiveBoost,
      });

      scored.push({ id: gap.id, priorityScore: result.priorityScore });

      // Update priorityScore, directiveBoost, detectionCount, lastDetectedAt
      await db
        .update(knowledgeGaps)
        .set({
          priorityScore: result.priorityScore,
          directiveBoost,
          detectionCount: sql`detectionCount + 1`,
          lastDetectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(knowledgeGaps.id, gap.id));
    } catch {
      // Non-fatal — continue with other gaps
    }
  }

  // Build3: Assign integer ranks after sorting by priorityScore DESC
  scored.sort((a, b) => b.priorityScore - a.priorityScore);
  for (let i = 0; i < scored.length; i++) {
    await db
      .update(knowledgeGaps)
      .set({ rank: i + 1 })
      .where(eq(knowledgeGaps.id, scored[i].id));
  }

  return scored.length;
}

/**
 * Returns the top N highest-priority open gaps.
 */
export async function getTopGaps(
  limit = 10
): Promise<(typeof knowledgeGaps.$inferSelect)[]> {
  const db = await getDbOrThrow();
  return db
    .select()
    .from(knowledgeGaps)
    .where(inArray(knowledgeGaps.status, ["open", "pursued", "narrowing"]))
    .orderBy(sql`priorityScore DESC`)
    .limit(limit);
}
