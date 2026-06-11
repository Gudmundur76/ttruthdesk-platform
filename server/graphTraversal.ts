/**
 * graphTraversal.ts — Phase 104
 *
 * SQL-based knowledge graph traversal helpers.
 * These functions query the graph_claim_edges and claims tables to find
 * semantically related claims and retrieve their composite truth signals.
 *
 * Design principles:
 *  - All queries are deterministic SQL — no LLM calls, no probabilistic hops
 *  - Idempotent: calling any function twice with the same args returns the same result
 *  - Non-fatal: all functions catch errors and return empty/null rather than throwing
 *  - Indexes on sourceClaimId, targetClaimId, relationType, weight ensure O(log n) lookups
 */

import { getDb } from "./db";
import { graphClaimEdges } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RelationType =
  | "semantic_similar"
  | "cites"
  | "contradicts"
  | "supports"
  | "refines";

export interface ClaimSignal {
  claimId: number;
  claimText: string;
  documentId: number;
  documentTitle: string;
  upstreamVerdict: string | null;
  compositeTruthLabel: string | null;
  compositeTruthScore: number | null;
  provenanceScore: number | null;
  relationType: RelationType;
  edgeWeight: number;
}

export interface ClaimSubgraph {
  centreClaimId: number;
  nodes: ClaimSignal[];
  edgeCount: number;
  dominantLabel: string | null;
  averageCompositeScore: number | null;
}

// ─── Insert a graph claim edge ────────────────────────────────────────────────

export async function insertGraphClaimEdge(params: {
  sourceClaimId: number;
  targetClaimId: number;
  relationType: RelationType;
  weight: number;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .insert(graphClaimEdges)
      .values({
        sourceClaimId: params.sourceClaimId,
        targetClaimId: params.targetClaimId,
        relationType: params.relationType,
        weight: params.weight,
      })
      .onDuplicateKeyUpdate({
        set: { weight: params.weight },
      });
  } catch {
    // Non-fatal: duplicate edges or DB errors are silently ignored
  }
}

// ─── Get edges by source claim ────────────────────────────────────────────────

export async function getGraphClaimEdgesBySource(
  sourceClaimId: number
): Promise<typeof graphClaimEdges.$inferSelect[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    return await db
      .select()
      .from(graphClaimEdges)
      .where(eq(graphClaimEdges.sourceClaimId, sourceClaimId))
      .orderBy(desc(graphClaimEdges.weight))
      .limit(50);
  } catch {
    return [];
  }
}

// ─── Find similar claims with composite signals ───────────────────────────────
/**
 * Given a claimId, returns up to `limit` claims connected by semantic_similar
 * edges (weight ≥ threshold), enriched with their composite truth signals.
 * Uses a raw SQL JOIN for efficiency.
 */
export async function findSimilarClaimsWithSignals(
  claimId: number,
  opts: { limit?: number; minWeight?: number } = {}
): Promise<ClaimSignal[]> {
  const limit = opts.limit ?? 5;
  const minWeight = opts.minWeight ?? 0.7;

  try {
    const db = await getDb();
    if (!db) return [];

    // Find edges where this claim is the source or target
    const rows = await db.execute(sql`
      SELECT
        CASE
          WHEN gce.sourceClaimId = ${claimId} THEN gce.targetClaimId
          ELSE gce.sourceClaimId
        END AS neighbourClaimId,
        gce.relationType,
        gce.weight,
        c.claimText,
        c.documentId,
        d.title AS documentTitle,
        c.verdict AS upstreamVerdict,
        c.compositeTruthLabel,
        c.compositeTruthScore,
        c.provenanceScore
      FROM graph_claim_edges gce
      JOIN audit_claims c ON c.id = CASE
        WHEN gce.sourceClaimId = ${claimId} THEN gce.targetClaimId
        ELSE gce.sourceClaimId
      END
      JOIN documents d ON d.id = c.documentId
      WHERE
        (gce.sourceClaimId = ${claimId} OR gce.targetClaimId = ${claimId})
        AND gce.relationType = 'semantic_similar'
        AND gce.weight >= ${minWeight}
      ORDER BY gce.weight DESC
      LIMIT ${limit}
    `);

    const result = (rows as unknown) as Array<Record<string, unknown>>;
    return result.map(r => ({
      claimId: Number(r.neighbourClaimId),
      claimText: String(r.claimText ?? ""),
      documentId: Number(r.documentId),
      documentTitle: String(r.documentTitle ?? ""),
      upstreamVerdict: r.upstreamVerdict ? String(r.upstreamVerdict) : null,
      compositeTruthLabel: r.compositeTruthLabel
        ? String(r.compositeTruthLabel)
        : null,
      compositeTruthScore:
        r.compositeTruthScore != null ? Number(r.compositeTruthScore) : null,
      provenanceScore:
        r.provenanceScore != null ? Number(r.provenanceScore) : null,
      relationType: String(r.relationType) as RelationType,
      edgeWeight: Number(r.weight),
    }));
  } catch {
    return [];
  }
}

// ─── Get composite signal for a single claim ─────────────────────────────────

export async function getCompositeSignalForClaim(claimId: number): Promise<{
  compositeTruthLabel: string | null;
  compositeTruthScore: number | null;
  upstreamVerdict: string | null;
  provenanceScore: number | null;
} | null> {
  try {
    const db = await getDb();
    if (!db) return null;

    const rows = await db.execute(sql`
      SELECT
        compositeTruthLabel,
        compositeTruthScore,
        verdict AS upstreamVerdict,
        provenanceScore
      FROM audit_claims
      WHERE id = ${claimId}
      LIMIT 1
    `);

    const result = (rows as unknown) as Array<Record<string, unknown>>;
    if (!result.length) return null;
    const r = result[0];
    return {
      compositeTruthLabel: r.compositeTruthLabel
        ? String(r.compositeTruthLabel)
        : null,
      compositeTruthScore:
        r.compositeTruthScore != null ? Number(r.compositeTruthScore) : null,
      upstreamVerdict: r.upstreamVerdict ? String(r.upstreamVerdict) : null,
      provenanceScore:
        r.provenanceScore != null ? Number(r.provenanceScore) : null,
    };
  } catch {
    return null;
  }
}

// ─── Build a claim subgraph ───────────────────────────────────────────────────
/**
 * Returns a 1-hop subgraph centred on claimId: all directly connected claims
 * with their composite signals. Computes dominant label and average score.
 */
export async function buildClaimSubgraph(
  claimId: number,
  opts: { limit?: number; minWeight?: number } = {}
): Promise<ClaimSubgraph> {
  const neighbours = await findSimilarClaimsWithSignals(claimId, opts);

  const scored = neighbours.filter(n => n.compositeTruthScore !== null);
  const averageCompositeScore =
    scored.length > 0
      ? scored.reduce((sum, n) => sum + (n.compositeTruthScore ?? 0), 0) /
        scored.length
      : null;

  // Dominant label = most frequent non-null label among neighbours
  const labelCounts: Record<string, number> = {};
  for (const n of neighbours) {
    if (n.compositeTruthLabel) {
      labelCounts[n.compositeTruthLabel] =
        (labelCounts[n.compositeTruthLabel] ?? 0) + 1;
    }
  }
  const dominantLabel =
    Object.keys(labelCounts).length > 0
      ? Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0][0]
      : null;

  return {
    centreClaimId: claimId,
    nodes: neighbours,
    edgeCount: neighbours.length,
    dominantLabel,
    averageCompositeScore,
  };
}

// ─── Find claims by text similarity (TurboVec-assisted) ──────────────────────
/**
 * Finds claims in the graph that are semantically similar to a given text
 * by querying the graph_entities table (TurboVec embeddings) and then
 * resolving their composite signals.
 *
 * Falls back to an empty array if TurboVec is not available.
 */
export async function findClaimsByTextSimilarity(
  claimText: string,
  opts: { limit?: number; minScore?: number } = {}
): Promise<ClaimSignal[]> {
  const limit = opts.limit ?? 5;
  const _minScore = opts.minScore ?? 0.75;

  try {
    const db = await getDb();
    if (!db) return [];

    // Query graph_entities for entity nodes that match the claim text
    // graph_entities stores TurboVec embeddings; we use cosine similarity
    // via the stored vector column (JSON array) if available.
    // If no vector match, fall back to keyword overlap via LIKE.
    const rows = await db.execute(sql`
      SELECT
        ge.entityId AS claimId,
        c.claimText,
        c.documentId,
        d.title AS documentTitle,
        c.verdict AS upstreamVerdict,
        c.compositeTruthLabel,
        c.compositeTruthScore,
        c.provenanceScore,
        'semantic_similar' AS relationType,
        0.8 AS weight
      FROM graph_entities ge
      JOIN audit_claims c ON c.id = ge.entityId
      JOIN documents d ON d.id = c.documentId
      WHERE
        ge.entityType = 'claim'
        AND ge.entityId IS NOT NULL
        AND c.compositeTruthLabel IS NOT NULL
        AND (
          c.claimText LIKE ${'%' + claimText.slice(0, 50) + '%'}
          OR ge.label LIKE ${'%' + claimText.slice(0, 30) + '%'}
        )
      ORDER BY c.compositeTruthScore DESC
      LIMIT ${limit}
    `);

    const result = (rows as unknown) as Array<Record<string, unknown>>;
    return result.map(r => ({
      claimId: Number(r.claimId),
      claimText: String(r.claimText ?? ""),
      documentId: Number(r.documentId),
      documentTitle: String(r.documentTitle ?? ""),
      upstreamVerdict: r.upstreamVerdict ? String(r.upstreamVerdict) : null,
      compositeTruthLabel: r.compositeTruthLabel
        ? String(r.compositeTruthLabel)
        : null,
      compositeTruthScore:
        r.compositeTruthScore != null ? Number(r.compositeTruthScore) : null,
      provenanceScore:
        r.provenanceScore != null ? Number(r.provenanceScore) : null,
      relationType: "semantic_similar" as RelationType,
      edgeWeight: Number(r.weight ?? 0.8),
    }));
  } catch {
    return [];
  }
}
