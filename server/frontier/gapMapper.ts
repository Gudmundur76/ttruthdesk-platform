/**
 * gapMapper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontier Engine — Layer 1: Knowledge Gap Detection
 *
 * Scans the knowledge graph and claim corpus to detect four gap types:
 *
 *   structural   — graph entities with zero relations (isolated nodes)
 *   evidence     — claims with "Insufficient Evidence" verdict
 *   contradiction — entity pairs with multiple contradicts edges
 *   temporal     — claims verified with data older than 180 days
 *
 * The Frontier Engine has WRITE access to knowledge_gaps and frontier_log ONLY.
 * It NEVER writes to graph_entities, graphRelations, claims, or verdicts.
 */

import { getDb } from "../db";
import { knowledgeGaps, frontierLog } from "../../drizzle/schema";
import { eq, and, lt, sql, inArray } from "drizzle-orm";

// ─── DB helper ───────────────────────────────────────────────────────────────
async function getDbOrThrow() {
  const d = await getDb();
  if (!d) throw new Error("[FrontierEngine] Database not available");
  return d;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetectedGap {
  gapType: "structural" | "evidence" | "contradiction" | "temporal" | "hypothesis";
  description: string;
  entityAId?: number;
  entityBId?: number;
  contributingClaimCount: number;
  detectionSource: string;
}

export interface GapMapResult {
  structural: number;
  evidence: number;
  contradiction: number;
  temporal: number;
  total: number;
  newGapsCreated: number;
}

// ─── Core: detectStructuralGaps ───────────────────────────────────────────────

/**
 * Finds graph entities with no outgoing or incoming relations.
 * These are isolated nodes — they exist in the graph but contribute nothing.
 */
async function detectStructuralGaps(): Promise<DetectedGap[]> {
  try {
    // Find entities that have no relations (neither as source nor target)
    const isolated = await (await getDbOrThrow()).execute(sql`
      SELECT ge.id, ge.name, ge.entityType
      FROM graph_entities ge
      WHERE ge.id NOT IN (
        SELECT DISTINCT sourceEntityId FROM graph_relations
        UNION
        SELECT DISTINCT targetEntityId FROM graph_relations
      )
      LIMIT 50
    `);

    const rows = isolated[0] as unknown as Array<{ id: number; name: string; entityType: string }>;
    return rows.map((row) => ({
      gapType: "structural" as const,
      description: `Entity "${row.name}" (${row.entityType}, id=${row.id}) has no graph relations — isolated node with no verified connections.`,
      entityAId: row.id,
      contributingClaimCount: 0,
      detectionSource: "frontier_scan",
    }));
  } catch {
    return [];
  }
}

// ─── Core: detectEvidenceGaps ─────────────────────────────────────────────────

/**
 * Finds clusters of claims that returned "Insufficient Evidence".
 * Groups by claimText similarity is expensive; we group by documentId instead
 * and surface documents with many unresolved claims.
 */
async function detectEvidenceGaps(): Promise<DetectedGap[]> {
  try {
    const result = await (await getDbOrThrow()).execute(sql`
      SELECT 
        c.documentId,
        COUNT(*) as insufficientCount,
        GROUP_CONCAT(c.id ORDER BY c.id SEPARATOR ',') as claimIds
      FROM claims c
      WHERE c.verdict = 'Insufficient Evidence'
        AND c.documentId IS NOT NULL
      GROUP BY c.documentId
      HAVING insufficientCount >= 2
      ORDER BY insufficientCount DESC
      LIMIT 30
    `);

    const rows = result[0] as unknown as Array<{
      documentId: number;
      insufficientCount: number;
      claimIds: string;
    }>;

    return rows.map((row) => ({
      gapType: "evidence" as const,
      description: `Document #${row.documentId} has ${row.insufficientCount} claims with "Insufficient Evidence" verdict — no authoritative source could verify these claims. Evidence pursuit recommended.`,
      contributingClaimCount: row.insufficientCount,
      detectionSource: "frontier_scan",
    }));
  } catch {
    return [];
  }
}

// ─── Core: detectContradictionGaps ───────────────────────────────────────────

/**
 * Finds entity pairs with multiple "contradicts" edges — signals foundational
 * disagreement in the literature.
 */
async function detectContradictionGaps(): Promise<DetectedGap[]> {
  try {
    const result = await (await getDbOrThrow()).execute(sql`
      SELECT 
        gr.sourceEntityId,
        gr.targetEntityId,
        COUNT(*) as contradictionCount,
        se.name as sourceEntityName,
        te.name as targetEntityName
      FROM graph_relations gr
      JOIN graph_entities se ON se.id = gr.sourceEntityId
      JOIN graph_entities te ON te.id = gr.targetEntityId
      WHERE gr.relationType = 'contradicts'
      GROUP BY gr.sourceEntityId, gr.targetEntityId
      HAVING contradictionCount >= 2
      ORDER BY contradictionCount DESC
      LIMIT 20
    `);

    const rows = result[0] as unknown as Array<{
      sourceEntityId: number;
      targetEntityId: number;
      contradictionCount: number;
      sourceEntityName: string;
      targetEntityName: string;
    }>;

    return rows.map((row) => ({
      gapType: "contradiction" as const,
      description: `${row.contradictionCount} contradicting claims between "${row.sourceEntityName}" and "${row.targetEntityName}" — foundational disagreement in the literature. Contradiction resolution required.`,
      entityAId: row.sourceEntityId,
      entityBId: row.targetEntityId,
      contributingClaimCount: row.contradictionCount,
      detectionSource: "frontier_scan",
    }));
  } catch {
    return [];
  }
}

// ─── Core: detectTemporalGaps ─────────────────────────────────────────────────

/**
 * Finds claims verified with data older than 180 days.
 * These may be stale — newer evidence may have superseded the original verdict.
 */
async function detectTemporalGaps(): Promise<DetectedGap[]> {
  try {
    const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const result = await (await getDbOrThrow()).execute(sql`
      SELECT 
        c.documentId,
        COUNT(*) as staleCount
      FROM claims c
      WHERE c.pdbEvidenceCheckedAt IS NOT NULL
        AND c.pdbEvidenceCheckedAt < ${cutoff.toISOString()}
        AND c.verdict IN ('Supported', 'Partially Supported')
        AND c.documentId IS NOT NULL
      GROUP BY c.documentId
      HAVING staleCount >= 3
      ORDER BY staleCount DESC
      LIMIT 20
    `);

    const rows = result[0] as unknown as Array<{ documentId: number; staleCount: number }>;

    return rows.map((row) => ({
      gapType: "temporal" as const,
      description: `Document #${row.documentId} has ${row.staleCount} claims verified more than 180 days ago — newer evidence may have superseded these verdicts. Re-verification recommended.`,
      contributingClaimCount: row.staleCount,
      detectionSource: "frontier_scan",
    }));
  } catch {
    return [];
  }
}

// ─── Core: persistGaps ───────────────────────────────────────────────────────

/**
 * Writes newly detected gaps to knowledge_gaps, skipping duplicates.
 * A gap is considered duplicate if the same gapType + description already exists
 * in an open/pursued/narrowing status.
 */
async function persistGaps(gaps: DetectedGap[]): Promise<number> {
  if (gaps.length === 0) return 0;

  let created = 0;
  for (const gap of gaps) {
    try {
      // Check for existing open gap with same description prefix (first 120 chars)
      const descPrefix = gap.description.slice(0, 120);
      const existing = await (await getDbOrThrow()).execute(sql`
        SELECT id FROM knowledge_gaps
        WHERE gapType = ${gap.gapType}
          AND description LIKE ${descPrefix + "%"}
          AND status IN ('open', 'pursued', 'narrowing')
        LIMIT 1
      `);

      const rows = existing[0] as unknown as Array<{ id: number }>;
      if (rows.length > 0) continue; // Already tracked

      await (await getDbOrThrow()).insert(knowledgeGaps).values({
        gapType: gap.gapType,
        description: gap.description,
        entityAId: gap.entityAId,
        entityBId: gap.entityBId,
        contributingClaimCount: gap.contributingClaimCount,
        detectionSource: gap.detectionSource,
        status: "open",
        priorityScore: 0, // Will be scored by gapRanker
      });

      await (await getDbOrThrow()).insert(frontierLog).values({
        actionType: "gap_detected",
        reasoning: {
          gapType: gap.gapType,
          description: gap.description,
          contributingClaimCount: gap.contributingClaimCount,
        },
        outcome: "Gap written to knowledge_gaps",
      });

      created++;
    } catch {
      // Non-fatal — continue with other gaps
    }
  }
  return created;
}

// ─── Public: runGapMapper ─────────────────────────────────────────────────────

/**
 * Runs all four gap detectors and persists new gaps.
 * Called by the Frontier Engine orchestrator on each scan tick.
 */
export async function runGapMapper(): Promise<GapMapResult> {
  const [structural, evidence, contradiction, temporal] = await Promise.all([
    detectStructuralGaps(),
    detectEvidenceGaps(),
    detectContradictionGaps(),
    detectTemporalGaps(),
  ]);

  const allGaps = [...structural, ...evidence, ...contradiction, ...temporal];
  const newGapsCreated = await persistGaps(allGaps);

  return {
    structural: structural.length,
    evidence: evidence.length,
    contradiction: contradiction.length,
    temporal: temporal.length,
    total: allGaps.length,
    newGapsCreated,
  };
}

/**
 * Detects and persists a single evidence gap for a specific document.
 * Called by analysisPipeline when a claim returns "Insufficient Evidence".
 */
export async function detectEvidenceGapForDocument(
  documentId: number,
  insufficientClaimCount: number,
  claimSample?: string
): Promise<number | null> {
  const description = claimSample
    ? `Document #${documentId} has ${insufficientClaimCount} claim(s) with "Insufficient Evidence" verdict. Sample: "${claimSample.slice(0, 200)}"`
    : `Document #${documentId} has ${insufficientClaimCount} claim(s) with "Insufficient Evidence" verdict — no authoritative source could verify these claims.`;

  try {
    // Check for existing open gap for this document
    const existing = await (await getDbOrThrow()).execute(sql`
      SELECT id FROM knowledge_gaps
      WHERE description LIKE ${"Document #" + documentId + "%"}
        AND gapType = 'evidence'
        AND status IN ('open', 'pursued', 'narrowing')
      LIMIT 1
    `);
    const rows = existing[0] as unknown as Array<{ id: number }>;
    if (rows.length > 0) {
      // Update the contributing claim count
      await (await getDbOrThrow())
        .update(knowledgeGaps)
        .set({
          contributingClaimCount: sql`contributingClaimCount + ${insufficientClaimCount}`,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeGaps.id, rows[0].id));
      return rows[0].id;
    }

    const [inserted] = await (await getDbOrThrow()).insert(knowledgeGaps).values({
      gapType: "evidence",
      description,
      contributingClaimCount: insufficientClaimCount,
      detectionSource: "pipeline_trigger",
      status: "open",
      priorityScore: 0,
    });

    const gapId = (inserted as unknown as { insertId: number }).insertId;

    await (await getDbOrThrow()).insert(frontierLog).values({
      actionType: "gap_detected",
      gapId,
      reasoning: {
        trigger: "pipeline_insufficient_evidence",
        documentId,
        insufficientClaimCount,
        claimSample: claimSample?.slice(0, 200),
      },
      outcome: "Evidence gap created from pipeline trigger",
    });

    return gapId;
  } catch {
    return null;
  }
}
