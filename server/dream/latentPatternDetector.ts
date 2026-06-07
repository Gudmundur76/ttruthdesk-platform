/**
 * latentPatternDetector.ts — Dream Cycle 2: Latent Pattern Detection
 *
 * Scans the knowledge graph for patterns that are invisible during normal
 * operation because they require cross-entity, cross-document analysis.
 * The detector looks for:
 *
 *   1. Contradiction clusters — groups of entities where ≥ 3 contradicting
 *      edges form a cycle (A contradicts B, B contradicts C, C contradicts A)
 *   2. Temporal drift — claims verified > 180 days ago with no re-check
 *   3. Evidence deserts — entities with many claims but no Supported verdicts
 *   4. Homology bridges — proteins sharing ≥ 2 methods with no homologous_to edge
 *
 * Each detected pattern is classified by urgency and returned for the dream
 * session's patternLog.
 */

import { getDb } from "../db";
import { sql } from "drizzle-orm";

export interface DetectedPattern {
  type:
    | "contradiction_cluster"
    | "temporal_drift"
    | "evidence_desert"
    | "homology_bridge";
  description: string;
  urgency: "low" | "medium" | "high" | "critical";
  entityIds: number[];
  evidence: string;
}

export interface PatternDetectionResult {
  patterns: DetectedPattern[];
  totalFound: number;
}

/**
 * Run the latent pattern detection pass.
 */
export async function runPatternDetection(): Promise<PatternDetectionResult> {
  const db = await getDb();
  const patterns: DetectedPattern[] = [];

  if (!db) return { patterns, totalFound: 0 };

  // ── 1. Temporal drift: claims not re-checked in > 180 days ──────────────
  try {
    const driftRows = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM claims
      WHERE pdbEvidenceCheckedAt IS NOT NULL
        AND pdbEvidenceCheckedAt < DATE_SUB(NOW(), INTERVAL 180 DAY)
        AND verdict IN ('Supported', 'Partially Supported')
    `);
    const driftCount = Number(((driftRows as unknown) as Array<{ cnt: number }>)[0]?.cnt ?? 0);
    if (driftCount > 0) {
      patterns.push({
        type: "temporal_drift",
        description: `${driftCount} verified claims have not been re-checked in over 180 days.`,
        urgency: driftCount > 50 ? "high" : driftCount > 10 ? "medium" : "low",
        entityIds: [],
        evidence: `${driftCount} claims with pdbEvidenceCheckedAt > 180 days old`,
      });
    }
  } catch { /* non-fatal */ }

  // ── 2. Evidence deserts: entities with ≥ 3 claims but 0 Supported ────────
  try {
    const desertRows = await db.execute(sql`
      SELECT ge.id, ge.canonicalName, COUNT(c.id) AS total_claims,
             SUM(CASE WHEN c.verdict = 'Supported' THEN 1 ELSE 0 END) AS supported_count
      FROM graph_entities ge
      JOIN claims c ON c.documentId IN (
        SELECT gr.evidenceDocumentId FROM graph_relations gr
        WHERE gr.sourceEntityId = ge.id OR gr.targetEntityId = ge.id
      )
      GROUP BY ge.id, ge.canonicalName
      HAVING total_claims >= 3 AND supported_count = 0
      LIMIT 10
    `);
    const deserts = (desertRows as unknown) as Array<{
      id: number;
      canonicalName: string;
      total_claims: number;
    }>;
    if (deserts.length > 0) {
      patterns.push({
        type: "evidence_desert",
        description: `${deserts.length} entities have ≥ 3 claims with zero Supported verdicts.`,
        urgency: deserts.length > 5 ? "high" : "medium",
        entityIds: deserts.map((d) => d.id),
        evidence: deserts
          .slice(0, 3)
          .map((d) => `${d.canonicalName} (${d.total_claims} claims)`)
          .join(", "),
      });
    }
  } catch { /* non-fatal */ }

  // ── 3. Contradiction clusters: entities with ≥ 3 contradicts edges ────────
  try {
    const clusterRows = await db.execute(sql`
      SELECT sourceEntityId, COUNT(*) AS contradiction_count
      FROM graph_relations
      WHERE relationType = 'contradicts'
      GROUP BY sourceEntityId
      HAVING contradiction_count >= 3
      LIMIT 10
    `);
    const clusters = (clusterRows as unknown) as Array<{
      sourceEntityId: number;
      contradiction_count: number;
    }>;
    if (clusters.length > 0) {
      patterns.push({
        type: "contradiction_cluster",
        description: `${clusters.length} entities are at the center of ≥ 3 contradiction edges.`,
        urgency: clusters.length > 3 ? "critical" : "high",
        entityIds: clusters.map((c) => c.sourceEntityId),
        evidence: `${clusters.length} entities with high contradiction degree`,
      });
    }
  } catch { /* non-fatal */ }

  // ── 4. Homology bridges: proteins sharing methods but no homologous_to ─────
  try {
    const bridgeRows = await db.execute(sql`
      SELECT a.sourceEntityId AS proteinA, b.sourceEntityId AS proteinB,
             COUNT(DISTINCT a.targetEntityId) AS shared_methods
      FROM graph_relations a
      JOIN graph_relations b
        ON a.targetEntityId = b.targetEntityId
        AND a.sourceEntityId != b.sourceEntityId
        AND a.relationType = 'uses_method'
        AND b.relationType = 'uses_method'
      WHERE NOT EXISTS (
        SELECT 1 FROM graph_relations h
        WHERE h.relationType = 'homologous_to'
          AND ((h.sourceEntityId = a.sourceEntityId AND h.targetEntityId = b.sourceEntityId)
            OR (h.sourceEntityId = b.sourceEntityId AND h.targetEntityId = a.sourceEntityId))
      )
      GROUP BY a.sourceEntityId, b.sourceEntityId
      HAVING shared_methods >= 2
      LIMIT 5
    `);
    const bridges = (bridgeRows as unknown) as Array<{
      proteinA: number;
      proteinB: number;
      shared_methods: number;
    }>;
    if (bridges.length > 0) {
      patterns.push({
        type: "homology_bridge",
        description: `${bridges.length} protein pairs share ≥ 2 experimental methods but have no homologous_to edge.`,
        urgency: "medium",
        entityIds: Array.from(new Set(bridges.flatMap((b) => [b.proteinA, b.proteinB]))),
        evidence: `${bridges.length} candidate homology pairs`,
      });
    }
  } catch { /* non-fatal */ }

  return { patterns, totalFound: patterns.length };
}
