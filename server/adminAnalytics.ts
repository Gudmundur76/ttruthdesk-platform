/**
 * adminAnalytics.ts
 *
 * Database query helpers for the admin analytics dashboard.
 * All queries are read-only and designed to be fast on TiDB Serverless.
 *
 * Exported functions:
 *   getPlatformOverview()  — top-level counts and rates
 *   getVerdictDistribution() — breakdown of claim verdicts
 *   getVerticalHealth()   — per-vertical document and claim stats
 *   getProcessingTrend()  — daily document and claim counts for the last 30 days
 *   getQualityDistribution() — confidence score histogram
 *   getTopEntities()      — most-cited graph entities
 *   getRecentActivity()   — last 20 events across documents, claims, and tasks
 */

import { getDb } from "./db";
import { documents, claims, graphEntities, graphRelations, coordTasks } from "../drizzle/schema";
import { sql, count, avg, desc, gte, and, isNotNull } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlatformOverview {
  totalDocuments: number;
  completedDocuments: number;
  failedDocuments: number;
  pendingDocuments: number;
  totalClaims: number;
  verifiedClaims: number;
  contradictionCount: number;
  totalEntities: number;
  totalRelations: number;
  avgConfidenceScore: number | null;
  coordTasksActive: number;
  coordTasksCompleted: number;
}

export interface VerdictBucket {
  verdict: string;
  count: number;
  percentage: number;
}

export interface VerticalHealthRow {
  verticalDomain: string;
  documentCount: number;
  claimCount: number;
  completedCount: number;
  failedCount: number;
  avgConfidence: number | null;
}

export interface DailyTrendRow {
  date: string;
  documentsProcessed: number;
  claimsExtracted: number;
}

export interface ConfidenceBucket {
  range: string;
  count: number;
}

export interface TopEntityRow {
  canonicalName: string;
  entityType: string;
  claimCount: number;
}

export interface RecentActivityItem {
  type: "document" | "claim" | "task";
  id: number;
  label: string;
  status: string | null;
  timestamp: Date | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Platform-wide overview stats. */
export async function getPlatformOverview(): Promise<PlatformOverview> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [docStats] = await db
    .select({
      total: count(),
      completed: sql<number>`SUM(CASE WHEN ${documents.status} = 'complete' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN ${documents.status} = 'failed' THEN 1 ELSE 0 END)`,
      pending: sql<number>`SUM(CASE WHEN ${documents.status} NOT IN ('complete', 'failed') THEN 1 ELSE 0 END)`,
    })
    .from(documents);

  const [claimStats] = await db
    .select({
      total: count(),
      verified: sql<number>`SUM(CASE WHEN ${claims.verdict} IS NOT NULL THEN 1 ELSE 0 END)`,
      avgConf: avg(claims.confidenceScore),
    })
    .from(claims);

  const [contradictionCount] = await db
    .select({ count: count() })
    .from(graphRelations)
    .where(sql`${graphRelations.relationType} = 'contradicts'`);

  const [entityCount] = await db.select({ count: count() }).from(graphEntities);

  const [relationCount] = await db.select({ count: count() }).from(graphRelations);

  const [taskStats] = await db
    .select({
      active: sql<number>`SUM(CASE WHEN ${coordTasks.status} IN ('running', 'pending') THEN 1 ELSE 0 END)`,
      completed: sql<number>`SUM(CASE WHEN ${coordTasks.status} = 'completed' THEN 1 ELSE 0 END)`,
    })
    .from(coordTasks)
    .limit(1);

  return {
    totalDocuments: Number(docStats?.total ?? 0),
    completedDocuments: Number(docStats?.completed ?? 0),
    failedDocuments: Number(docStats?.failed ?? 0),
    pendingDocuments: Number(docStats?.pending ?? 0),
    totalClaims: Number(claimStats?.total ?? 0),
    verifiedClaims: Number(claimStats?.verified ?? 0),
    contradictionCount: Number(contradictionCount?.count ?? 0),
    totalEntities: Number(entityCount?.count ?? 0),
    totalRelations: Number(relationCount?.count ?? 0),
    avgConfidenceScore: claimStats?.avgConf != null ? Number(claimStats.avgConf) : null,
    coordTasksActive: Number(taskStats?.active ?? 0),
    coordTasksCompleted: Number(taskStats?.completed ?? 0),
  };
}

/** Verdict distribution with percentages. */
export async function getVerdictDistribution(): Promise<VerdictBucket[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const rows = await db
    .select({
      verdict: claims.verdict,
      count: count(),
    })
    .from(claims)
    .where(isNotNull(claims.verdict))
    .groupBy(claims.verdict)
    .orderBy(desc(count()));

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  return rows.map((r) => ({
    verdict: r.verdict ?? "Unknown",
    count: Number(r.count),
    percentage: total > 0 ? Math.round((Number(r.count) / total) * 1000) / 10 : 0,
  }));
}

/** Per-vertical document and claim health. */
export async function getVerticalHealth(): Promise<VerticalHealthRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const rows = await db
    .select({
      verticalDomain: documents.verticalDomain,
      documentCount: count(),
      completedCount: sql<number>`SUM(CASE WHEN ${documents.status} = 'complete' THEN 1 ELSE 0 END)`,
      failedCount: sql<number>`SUM(CASE WHEN ${documents.status} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(documents)
    .groupBy(documents.verticalDomain)
    .orderBy(desc(count()));

  // Get claim counts per vertical via a join
  const claimRows = await db
    .select({
      verticalDomain: documents.verticalDomain,
      claimCount: count(claims.id),
      avgConf: avg(claims.confidenceScore),
    })
    .from(documents)
    .leftJoin(claims, sql`${claims.documentId} = ${documents.id}`)
    .groupBy(documents.verticalDomain);

  const claimMap = new Map(
    claimRows.map((r) => [r.verticalDomain, { claimCount: Number(r.claimCount), avgConf: r.avgConf != null ? Number(r.avgConf) : null }])
  );

  return rows.map((r) => ({
    verticalDomain: r.verticalDomain ?? "unknown",
    documentCount: Number(r.documentCount),
    claimCount: claimMap.get(r.verticalDomain ?? "")?.claimCount ?? 0,
    completedCount: Number(r.completedCount),
    failedCount: Number(r.failedCount),
    avgConfidence: claimMap.get(r.verticalDomain ?? "")?.avgConf ?? null,
  }));
}

/** Daily document and claim counts for the last 30 days. */
export async function getProcessingTrend(): Promise<DailyTrendRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const docRows = await db
    .select({
      date: sql<string>`DATE(${documents.createdAt})`,
      count: count(),
    })
    .from(documents)
    .where(gte(documents.createdAt, thirtyDaysAgo))
    .groupBy(sql`DATE(${documents.createdAt})`)
    .orderBy(sql`DATE(${documents.createdAt})`);

  const claimRows = await db
    .select({
      date: sql<string>`DATE(${claims.createdAt})`,
      count: count(),
    })
    .from(claims)
    .where(gte(claims.createdAt, thirtyDaysAgo))
    .groupBy(sql`DATE(${claims.createdAt})`)
    .orderBy(sql`DATE(${claims.createdAt})`);

  // Merge into a single timeline
  const dateMap = new Map<string, DailyTrendRow>();
  for (const r of docRows) {
    const d = r.date;
    if (!dateMap.has(d)) dateMap.set(d, { date: d, documentsProcessed: 0, claimsExtracted: 0 });
    dateMap.get(d)!.documentsProcessed = Number(r.count);
  }
  for (const r of claimRows) {
    const d = r.date;
    if (!dateMap.has(d)) dateMap.set(d, { date: d, documentsProcessed: 0, claimsExtracted: 0 });
    dateMap.get(d)!.claimsExtracted = Number(r.count);
  }

  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Confidence score histogram in 10% buckets. */
export async function getQualityDistribution(): Promise<ConfidenceBucket[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const rows = await db
    .select({
      bucket: sql<string>`CONCAT(FLOOR(${claims.confidenceScore} * 10) * 10, '–', FLOOR(${claims.confidenceScore} * 10) * 10 + 10, '%')`,
      count: count(),
    })
    .from(claims)
    .where(isNotNull(claims.confidenceScore))
    .groupBy(sql`FLOOR(${claims.confidenceScore} * 10)`)
    .orderBy(sql`FLOOR(${claims.confidenceScore} * 10)`);

  return rows.map((r) => ({ range: r.bucket, count: Number(r.count) }));
}

/** Top 10 most-cited graph entities (by number of claims referencing them). */
export async function getTopEntities(): Promise<TopEntityRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Count claims per entity via graphRelations (sourceEntityId)
  const rows = await db
    .select({
      canonicalName: graphEntities.canonicalName,
      entityType: graphEntities.entityType,
      claimCount: sql<number>`COUNT(${graphRelations.id})`,
    })
    .from(graphEntities)
    .leftJoin(graphRelations, sql`${graphRelations.sourceEntityId} = ${graphEntities.id}`)
    .groupBy(graphEntities.id, graphEntities.canonicalName, graphEntities.entityType)
    .orderBy(desc(sql`COUNT(${graphRelations.id})`))
    .limit(10);

  return rows.map((r) => ({
    canonicalName: r.canonicalName,
    entityType: r.entityType,
    claimCount: Number(r.claimCount ?? 0),
  }));
}

/** Last 20 recent activity events across documents and coord tasks. */
export async function getRecentActivity(): Promise<RecentActivityItem[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const recentDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      status: documents.status,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .orderBy(desc(documents.updatedAt))
    .limit(10);

  const recentTasks = await db
    .select({
      id: coordTasks.id,
      vertical: coordTasks.vertical,
      status: coordTasks.status,
      startedAt: coordTasks.startedAt,
    })
    .from(coordTasks)
    .orderBy(desc(coordTasks.startedAt))
    .limit(10);

  const items: RecentActivityItem[] = [
    ...recentDocs.map((d) => ({
      type: "document" as const,
      id: d.id,
      label: d.title,
      status: d.status,
      timestamp: d.updatedAt,
    })),
    ...recentTasks.map((t) => ({
      type: "task" as const,
      id: t.id,
      label: `Agent: ${t.vertical}`,
      status: t.status,
      timestamp: t.startedAt,
    })),
  ];

  return items.sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0)).slice(0, 20);
}
