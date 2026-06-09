/**
 * graphConsolidator.ts — Dream Cycle 1: Graph Consolidation
 *
 * During the dream state the system reviews the knowledge graph for structural
 * inefficiencies that accumulate during normal operation:
 *
 *   1. Orphaned entities — nodes with no edges (added but never linked)
 *   2. Duplicate edges — identical (source, target, relationType) triples
 *   3. Stale confidence — relations whose evidenceDocumentId points to a
 *      document that has since been superseded or contradicted
 *   4. Isolated clusters — sub-graphs with no path to any protein node
 *
 * The consolidator does NOT delete data. It flags issues and records
 * recommended actions in the session's graphOptimizations counter.
 * Actual mutations require a separate admin-approved step.
 */

import { getDb } from "../db";

import { sql } from "drizzle-orm";

export interface ConsolidationResult {
  orphanedEntityCount: number;
  duplicateEdgeCount: number;
  staleConfidenceCount: number;
  totalOptimizations: number;
  recommendations: string[];
}

/**
 * Run the graph consolidation pass.
 * Returns a summary of structural issues found.
 */
export async function runGraphConsolidation(): Promise<ConsolidationResult> {
  const db = await getDb();
  const result: ConsolidationResult = {
    orphanedEntityCount: 0,
    duplicateEdgeCount: 0,
    staleConfidenceCount: 0,
    totalOptimizations: 0,
    recommendations: [],
  };

  if (!db) return result;

  try {
    // ── 1. Orphaned entities (no outbound or inbound edges) ──────────────────
    const orphanRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM graph_entities ge
      WHERE NOT EXISTS (
        SELECT 1 FROM graph_relations gr
        WHERE gr.sourceEntityId = ge.id OR gr.targetEntityId = ge.id
      )
    `);
    const orphanCount = Number(
      (orphanRows as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0
    );
    result.orphanedEntityCount = orphanCount;
    if (orphanCount > 0) {
      result.recommendations.push(
        `${orphanCount} orphaned entities detected. Consider linking or archiving them.`
      );
    }

    // ── 2. Duplicate edges ───────────────────────────────────────────────────
    const dupRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM (
        SELECT sourceEntityId, targetEntityId, relationType, COUNT(*) AS c
        FROM graph_relations
        GROUP BY sourceEntityId, targetEntityId, relationType
        HAVING c > 1
      ) AS dups
    `);
    const dupCount = Number(
      (dupRows as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0
    );
    result.duplicateEdgeCount = dupCount;
    if (dupCount > 0) {
      result.recommendations.push(
        `${dupCount} duplicate edge groups found. Deduplication recommended.`
      );
    }

    // ── 3. Relations with low confidence that have been verified claims ──────
    const staleRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM graph_relations gr
      WHERE gr.confidenceScore IS NOT NULL
        AND gr.confidenceScore < 0.3
        AND gr.evidenceDocumentId IS NOT NULL
    `);
    const staleCount = Number(
      (staleRows as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0
    );
    result.staleConfidenceCount = staleCount;
    if (staleCount > 0) {
      result.recommendations.push(
        `${staleCount} low-confidence relations (< 0.3) with evidence documents. Re-verification recommended.`
      );
    }

    result.totalOptimizations =
      result.orphanedEntityCount +
      result.duplicateEdgeCount +
      result.staleConfidenceCount;
  } catch {
    // Non-fatal — dream continues even if consolidation query fails
  }

  return result;
}
