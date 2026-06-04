/**
 * entityCooccurrenceService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Computes and queries entity co-occurrence pairs.
 *
 * A co-occurrence is recorded when two distinct entities both appear in the
 * same document (via graph_relations edges that reference the same documentId).
 *
 * API:
 *   computeCooccurrencesForDocument(documentId) — upsert pairs for one doc
 *   getTopCooccurrences(opts)                   — fetch top N pairs for graph UI
 *   getCooccurrencesForEntity(entityId, limit)  — fetch pairs for one entity
 *   buildGraphData(rows)                        — convert rows to D3 graph format
 */

import { getDb } from "./db";
import {
  entityCooccurrences,
  graphRelations,
  graphEntities,
} from "../drizzle/schema";
import { eq, or, desc, sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CooccurrenceRow {
  entityAId: number;
  entityBId: number;
  entityAName: string;
  entityBName: string;
  entityAType: string;
  entityBType: string;
  coCount: number;
  documentId: number;
}

export interface CooccurrenceGraphData {
  nodes: Array<{
    id: number;
    name: string;
    entityType: string;
    degree: number;
  }>;
  links: Array<{
    source: number;
    target: number;
    value: number;
    documentId: number;
  }>;
}

type EntityMeta = {
  id: number;
  canonicalName: string;
  entityType: string;
};

// ─── Compute co-occurrences for a single document ────────────────────────────

/**
 * Finds all entity IDs referenced in graph_relations for the given document,
 * then upserts all unique pairs into entity_cooccurrences.
 *
 * Pairs are always stored with entityAId < entityBId to avoid duplicates.
 */
export async function computeCooccurrencesForDocument(documentId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Collect all entity IDs referenced by relations in this document
  const relations = await db
    .select({
      sourceEntityId: graphRelations.sourceEntityId,
      targetEntityId: graphRelations.targetEntityId,
    })
    .from(graphRelations)
    .where(eq(graphRelations.evidenceDocumentId, documentId));

  // Build a unique set of entity IDs
  const entityIdSet = new Set<number>();
  for (const rel of relations) {
    entityIdSet.add(rel.sourceEntityId);
    entityIdSet.add(rel.targetEntityId);
  }

  const entityIds = Array.from(entityIdSet);
  if (entityIds.length < 2) return 0;

  // Generate all unique pairs (A < B to avoid duplicates)
  const pairs: Array<{ entityAId: number; entityBId: number }> = [];
  for (let i = 0; i < entityIds.length; i++) {
    for (let j = i + 1; j < entityIds.length; j++) {
      const a = Math.min(entityIds[i], entityIds[j]);
      const b = Math.max(entityIds[i], entityIds[j]);
      pairs.push({ entityAId: a, entityBId: b });
    }
  }

  if (pairs.length === 0) return 0;

  // Upsert each pair (MySQL INSERT ... ON DUPLICATE KEY UPDATE)
  for (const pair of pairs) {
    await db
      .insert(entityCooccurrences)
      .values({
        entityAId: pair.entityAId,
        entityBId: pair.entityBId,
        documentId,
        coCount: 1,
      })
      .onDuplicateKeyUpdate({
        set: {
          coCount: sql`${entityCooccurrences.coCount} + 1`,
          updatedAt: sql`NOW()`,
        },
      });
  }

  return pairs.length;
}

// ─── Query: top co-occurrences for graph UI ───────────────────────────────────

export interface GetTopCooccurrencesOpts {
  /** Filter to a specific document */
  documentId?: number;
  /** Maximum number of pairs to return */
  limit?: number;
}

export async function getTopCooccurrences(
  opts: GetTopCooccurrencesOpts = {}
): Promise<CooccurrenceRow[]> {
  const db = await getDb();
  if (!db) return [];

  const { documentId, limit = 100 } = opts;

  const coocRows = await db
    .select({
      entityAId: entityCooccurrences.entityAId,
      entityBId: entityCooccurrences.entityBId,
      coCount: entityCooccurrences.coCount,
      documentId: entityCooccurrences.documentId,
    })
    .from(entityCooccurrences)
    .where(documentId !== undefined ? eq(entityCooccurrences.documentId, documentId) : undefined)
    .orderBy(desc(entityCooccurrences.coCount))
    .limit(limit);

  if (coocRows.length === 0) return [];

  return enrichWithEntityMeta(db, coocRows);
}

// ─── Query: co-occurrences for a single entity ────────────────────────────────

export async function getCooccurrencesForEntity(
  entityId: number,
  limit = 50
): Promise<CooccurrenceRow[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      entityAId: entityCooccurrences.entityAId,
      entityBId: entityCooccurrences.entityBId,
      coCount: entityCooccurrences.coCount,
      documentId: entityCooccurrences.documentId,
    })
    .from(entityCooccurrences)
    .where(
      or(
        eq(entityCooccurrences.entityAId, entityId),
        eq(entityCooccurrences.entityBId, entityId)
      )
    )
    .orderBy(desc(entityCooccurrences.coCount))
    .limit(limit);

  if (rows.length === 0) return [];

  return enrichWithEntityMeta(db, rows);
}

// ─── Internal: enrich co-occurrence rows with entity metadata ─────────────────

type CoocBaseRow = {
  entityAId: number;
  entityBId: number;
  coCount: number;
  documentId: number;
};

async function enrichWithEntityMeta(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  rows: CoocBaseRow[]
): Promise<CooccurrenceRow[]> {
  // Collect all entity IDs we need to look up
  const allIds = new Set<number>();
  for (const row of rows) {
    allIds.add(row.entityAId);
    allIds.add(row.entityBId);
  }

  const idArray = Array.from(allIds);
  if (idArray.length === 0) return [];

  const entities: EntityMeta[] = await db
    .select({
      id: graphEntities.id,
      canonicalName: graphEntities.canonicalName,
      entityType: graphEntities.entityType,
    })
    .from(graphEntities)
    .where(
      idArray.length === 1
        ? eq(graphEntities.id, idArray[0])
        : or(...idArray.map((id) => eq(graphEntities.id, id)))
    );

  const entityMap = new Map<number, EntityMeta>(
    entities.map((e: EntityMeta) => [e.id, e])
  );

  return rows
    .map((row: CoocBaseRow): CooccurrenceRow | null => {
      const a = entityMap.get(row.entityAId);
      const b = entityMap.get(row.entityBId);
      if (!a || !b) return null;
      return {
        entityAId: row.entityAId,
        entityBId: row.entityBId,
        entityAName: a.canonicalName,
        entityBName: b.canonicalName,
        entityAType: a.entityType,
        entityBType: b.entityType,
        coCount: row.coCount,
        documentId: row.documentId,
      };
    })
    .filter((r): r is CooccurrenceRow => r !== null);
}

// ─── Build graph data for D3 force simulation ─────────────────────────────────

export function buildGraphData(rows: CooccurrenceRow[]): CooccurrenceGraphData {
  const nodeMap = new Map<
    number,
    { id: number; name: string; entityType: string; degree: number }
  >();

  for (const row of rows) {
    if (!nodeMap.has(row.entityAId)) {
      nodeMap.set(row.entityAId, {
        id: row.entityAId,
        name: row.entityAName,
        entityType: row.entityAType,
        degree: 0,
      });
    }
    if (!nodeMap.has(row.entityBId)) {
      nodeMap.set(row.entityBId, {
        id: row.entityBId,
        name: row.entityBName,
        entityType: row.entityBType,
        degree: 0,
      });
    }
    nodeMap.get(row.entityAId)!.degree++;
    nodeMap.get(row.entityBId)!.degree++;
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links: rows.map((row) => ({
      source: row.entityAId,
      target: row.entityBId,
      value: row.coCount,
      documentId: row.documentId,
    })),
  };
}
