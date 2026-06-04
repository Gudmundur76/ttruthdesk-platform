/**
 * apiV2Router.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Truth Desk Public API v2
 *
 * All endpoints are under /api/v2/ and are publicly accessible (no auth required).
 * Rate limiting is applied globally (60 req/min per IP).
 *
 * Endpoints:
 *   GET /api/v2/claims              — paginated claims with filtering
 *   GET /api/v2/claims/:id          — single claim by ID
 *   GET /api/v2/documents/:id/claims — all claims for a document
 *   GET /api/v2/verticals           — list all verticals with stats
 *   GET /api/v2/verticals/:domainKey — single vertical with top claims
 *   GET /api/v2/entities            — paginated graph entities
 *   GET /api/v2/entities/:id        — single entity with relations
 *   GET /api/v2/audit/:documentId   — audit report for a document
 *   GET /api/v2/health              — API health check
 */
import { Router, type Request, type Response } from "express";
import { getDb } from "./db";
import { claims, documents, graphEntities, graphRelations, auditReports } from "../drizzle/schema";
import { eq, and, isNotNull, desc, asc, sql, or, like } from "drizzle-orm";

// ─── CORS headers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePagination(req: Request): { page: number; limit: number; offset: number } {
  const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? "20", 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

function apiError(res: Response, status: number, message: string) {
  return res.set(CORS_HEADERS).status(status).json({
    ok: false,
    error: message,
    timestamp: new Date().toISOString(),
  });
}

function apiOk<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.set(CORS_HEADERS).status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
    ...meta,
    data,
  });
}

// ─── Rate limiter (simple in-memory, per IP) ──────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(req: Request): boolean {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT) return false;
  return true;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function createApiV2Router(): Router {
  const router = Router();

  // Preflight
  router.options("*", (_req, res) => {
    res.set(CORS_HEADERS).status(204).end();
  });

  // Rate limit middleware
  router.use((req, res, next) => {
    if (!checkRateLimit(req)) {
      res.set({ ...CORS_HEADERS, "Retry-After": "60" }).status(429).json({
        ok: false,
        error: "Rate limit exceeded. Max 60 requests per minute.",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    next();
  });

  // ── GET /api/v2/health ────────────────────────────────────────────────────

  router.get("/health", async (_req, res) => {
    const db = await getDb();
    const dbOk = !!db;
    res.set(CORS_HEADERS).status(dbOk ? 200 : 503).json({
      ok: dbOk,
      version: "2.0",
      timestamp: new Date().toISOString(),
      services: { database: dbOk ? "ok" : "unavailable" },
    });
  });

  // ── GET /api/v2/claims ────────────────────────────────────────────────────
  //
  // Query params:
  //   page, limit       — pagination
  //   verdict           — filter by verdict (e.g. "Supported")
  //   vertical          — filter by vertical domain key
  //   minScore          — filter by minimum confidenceScore (0.0–1.0)
  //   q                 — full-text search in claimText

  router.get("/claims", async (req, res) => {
    const db = await getDb();
    if (!db) return apiError(res, 503, "Database unavailable");

    const { page, limit, offset } = parsePagination(req);
    const verdict = req.query.verdict as string | undefined;
    const vertical = req.query.vertical as string | undefined;
    const minScore = parseFloat((req.query.minScore as string) ?? "0") || 0;
    const q = req.query.q as string | undefined;

    // Build WHERE conditions
    const conditions = [];
    if (verdict) conditions.push(eq(claims.verdict, verdict as "Supported" | "Contradicted" | "Partially Supported" | "Ambiguous" | "Insufficient Evidence" | "Out of Scope" | "Needs Expert Review"));
    if (vertical) conditions.push(eq(documents.verticalDomain, vertical));
    if (minScore > 0) conditions.push(sql`${claims.confidenceScore} >= ${minScore}`);
    if (q && q.length >= 3) conditions.push(like(claims.claimText, `%${q}%`));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: claims.id,
          claimText: claims.claimText,
          claimType: claims.claimType,
          extractedValue: claims.extractedValue,
          verdict: claims.verdict,
          confidenceScore: claims.confidenceScore,
          pdbEvidenceUrl: claims.pdbEvidenceUrl,
          documentId: claims.documentId,
          verticalDomain: documents.verticalDomain,
          documentTitle: documents.title,
        })
        .from(claims)
        .innerJoin(documents, eq(claims.documentId, documents.id))
        .where(whereClause)
        .orderBy(desc(claims.confidenceScore))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(claims)
        .innerJoin(documents, eq(claims.documentId, documents.id))
        .where(whereClause),
    ]);

    const total = Number(countRows[0]?.count ?? 0);
    return apiOk(res, rows, {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: offset + limit < total,
        hasPrev: page > 1,
      },
    });
  });

  // ── GET /api/v2/claims/:id ────────────────────────────────────────────────

  router.get("/claims/:id", async (req, res) => {
    const db = await getDb();
    if (!db) return apiError(res, 503, "Database unavailable");

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return apiError(res, 400, "Invalid claim ID");

    const rows = await db
      .select({
        id: claims.id,
        claimText: claims.claimText,
        claimType: claims.claimType,
        extractedValue: claims.extractedValue,
        verdict: claims.verdict,
        verdictRationale: claims.verdictRationale,
        overriddenVerdict: claims.overriddenVerdict,
        confidenceScore: claims.confidenceScore,
        confidenceFlags: claims.confidenceFlags,
        pdbEvidenceUrl: claims.pdbEvidenceUrl,
        pdbEvidenceRaw: claims.pdbEvidenceRaw,
        pdbEvidenceCheckedAt: claims.pdbEvidenceCheckedAt,
        documentId: claims.documentId,
        verticalDomain: documents.verticalDomain,
        documentTitle: documents.title,
      })
      .from(claims)
      .innerJoin(documents, eq(claims.documentId, documents.id))
      .where(eq(claims.id, id))
      .limit(1);

    if (rows.length === 0) return apiError(res, 404, "Claim not found");
    return apiOk(res, rows[0]);
  });

  // ── GET /api/v2/documents/:id/claims ─────────────────────────────────────

  router.get("/documents/:id/claims", async (req, res) => {
    const db = await getDb();
    if (!db) return apiError(res, 503, "Database unavailable");

    const docId = parseInt(req.params.id, 10);
    if (isNaN(docId)) return apiError(res, 400, "Invalid document ID");

    const { page, limit, offset } = parsePagination(req);

    const [rows, countRows, docRows] = await Promise.all([
      db
        .select({
          id: claims.id,
          claimText: claims.claimText,
          claimType: claims.claimType,
          extractedValue: claims.extractedValue,
          verdict: claims.verdict,
          confidenceScore: claims.confidenceScore,
          pdbEvidenceUrl: claims.pdbEvidenceUrl,
        })
        .from(claims)
        .where(eq(claims.documentId, docId))
        .orderBy(desc(claims.confidenceScore))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(claims)
        .where(eq(claims.documentId, docId)),
      db
        .select({ id: documents.id, title: documents.title, verticalDomain: documents.verticalDomain, status: documents.status })
        .from(documents)
        .where(eq(documents.id, docId))
        .limit(1),
    ]);

    if (docRows.length === 0) return apiError(res, 404, "Document not found");

    const total = Number(countRows[0]?.count ?? 0);
    return apiOk(res, rows, {
      document: docRows[0],
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: offset + limit < total, hasPrev: page > 1 },
    });
  });

  // ── GET /api/v2/verticals ─────────────────────────────────────────────────

  router.get("/verticals", async (_req, res) => {
    const db = await getDb();
    if (!db) return apiError(res, 503, "Database unavailable");

    const docStats = await db
      .select({
        verticalDomain: documents.verticalDomain,
        totalDocs: sql<number>`COUNT(*)`,
        completedDocs: sql<number>`SUM(CASE WHEN ${documents.status} = 'complete' THEN 1 ELSE 0 END)`,
      })
      .from(documents)
      .groupBy(documents.verticalDomain);

    const claimStats = await db
      .select({
        verticalDomain: documents.verticalDomain,
        totalClaims: sql<number>`COUNT(*)`,
        supportedClaims: sql<number>`SUM(CASE WHEN ${claims.verdict} IN ('Supported', 'Partially Supported') THEN 1 ELSE 0 END)`,
        avgScore: sql<number>`AVG(${claims.confidenceScore})`,
      })
      .from(claims)
      .innerJoin(documents, eq(claims.documentId, documents.id))
      .groupBy(documents.verticalDomain);

    const claimMap = Object.fromEntries(claimStats.map((r) => [r.verticalDomain, r]));

    const data = docStats.map((d) => {
      const c = claimMap[d.verticalDomain ?? ""] ?? { totalClaims: 0, supportedClaims: 0, avgScore: null };
      const totalClaims = Number(c.totalClaims);
      const supportedClaims = Number(c.supportedClaims);
      return {
        domainKey: d.verticalDomain,
        totalDocs: Number(d.totalDocs),
        completedDocs: Number(d.completedDocs),
        totalClaims,
        supportedClaims,
        supportRate: totalClaims > 0 ? Math.round((supportedClaims / totalClaims) * 1000) / 1000 : 0,
        avgConfidenceScore: c.avgScore ? Math.round(Number(c.avgScore) * 1000) / 1000 : null,
      };
    });

    return apiOk(res, data);
  });

  // ── GET /api/v2/verticals/:domainKey ──────────────────────────────────────

  router.get("/verticals/:domainKey", async (req, res) => {
    const db = await getDb();
    if (!db) return apiError(res, 503, "Database unavailable");

    const { domainKey } = req.params;
    const { limit } = parsePagination(req);

    const [docStats, verdictDist, topClaims] = await Promise.all([
      db
        .select({
          total: sql<number>`COUNT(*)`,
          completed: sql<number>`SUM(CASE WHEN ${documents.status} = 'complete' THEN 1 ELSE 0 END)`,
        })
        .from(documents)
        .where(eq(documents.verticalDomain, domainKey)),
      db
        .select({ verdict: claims.verdict, count: sql<number>`COUNT(*)` })
        .from(claims)
        .innerJoin(documents, eq(claims.documentId, documents.id))
        .where(and(eq(documents.verticalDomain, domainKey), sql`${claims.verdict} IS NOT NULL`))
        .groupBy(sql`${claims.verdict}`),
      db
        .select({
          id: claims.id,
          claimText: claims.claimText,
          verdict: claims.verdict,
          confidenceScore: claims.confidenceScore,
          pdbEvidenceUrl: claims.pdbEvidenceUrl,
          documentId: claims.documentId,
        })
        .from(claims)
        .innerJoin(documents, eq(claims.documentId, documents.id))
        .where(and(eq(documents.verticalDomain, domainKey), isNotNull(claims.confidenceScore)))
        .orderBy(desc(claims.confidenceScore))
        .limit(Math.min(limit, 20)),
    ]);

    if (Number(docStats[0]?.total ?? 0) === 0) return apiError(res, 404, "Vertical not found or has no documents");

    const verdictCounts: Record<string, number> = {};
    let totalClaims = 0;
    for (const row of verdictDist) {
      verdictCounts[row.verdict ?? "Unknown"] = Number(row.count);
      totalClaims += Number(row.count);
    }

    return apiOk(res, {
      domainKey,
      stats: {
        totalDocs: Number(docStats[0]?.total ?? 0),
        completedDocs: Number(docStats[0]?.completed ?? 0),
        totalClaims,
        verdictCounts,
      },
      topClaims,
    });
  });

  // ── GET /api/v2/entities ──────────────────────────────────────────────────

  router.get("/entities", async (req, res) => {
    const db = await getDb();
    if (!db) return apiError(res, 503, "Database unavailable");

    const { page, limit, offset } = parsePagination(req);
    const entityType = req.query.type as string | undefined;
    const q = req.query.q as string | undefined;

    const conditions = [];
    if (entityType) conditions.push(eq(graphEntities.entityType, entityType as "protein" | "pdb_id" | "method" | "organism" | "ligand" | "author" | "concept" | "document"));
    if (q && q.length >= 2) conditions.push(like(graphEntities.canonicalName, `%${q}%`));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: graphEntities.id,
          entityType: graphEntities.entityType,
          canonicalName: graphEntities.canonicalName,
          wikiPagePath: graphEntities.wikiPagePath,
          firstSeenDocumentId: graphEntities.firstSeenDocumentId,
          metadata: graphEntities.metadata,
        })
        .from(graphEntities)
        .where(whereClause)
        .orderBy(desc(graphEntities.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)` }).from(graphEntities).where(whereClause),
    ]);

    const total = Number(countRows[0]?.count ?? 0);
    return apiOk(res, rows, {
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasNext: offset + limit < total, hasPrev: page > 1 },
    });
  });

  // ── GET /api/v2/entities/:id ──────────────────────────────────────────────

  router.get("/entities/:id", async (req, res) => {
    const db = await getDb();
    if (!db) return apiError(res, 503, "Database unavailable");

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return apiError(res, 400, "Invalid entity ID");

    const [entityRows, relationsRows] = await Promise.all([
      db.select().from(graphEntities).where(eq(graphEntities.id, id)).limit(1),
      db
        .select({
          id: graphRelations.id,
          relationType: graphRelations.relationType,
          sourceEntityId: graphRelations.sourceEntityId,
          targetEntityId: graphRelations.targetEntityId,
          confidenceScore: graphRelations.confidenceScore,
          evidenceDocumentId: graphRelations.evidenceDocumentId,
        })
        .from(graphRelations)
        .where(or(eq(graphRelations.sourceEntityId, id), eq(graphRelations.targetEntityId, id)))
        .limit(50),
    ]);

    if (entityRows.length === 0) return apiError(res, 404, "Entity not found");
    return apiOk(res, { entity: entityRows[0], relations: relationsRows });
  });

  // ── GET /api/v2/audit/:documentId ─────────────────────────────────────────

  router.get("/audit/:documentId", async (req, res) => {
    const db = await getDb();
    if (!db) return apiError(res, 503, "Database unavailable");

    const docId = parseInt(req.params.documentId, 10);
    if (isNaN(docId)) return apiError(res, 400, "Invalid document ID");

    const [docRows, reportRows, claimRows] = await Promise.all([
      db
        .select({ id: documents.id, title: documents.title, verticalDomain: documents.verticalDomain, status: documents.status })
        .from(documents)
        .where(eq(documents.id, docId))
        .limit(1),
      db.select().from(auditReports).where(eq(auditReports.documentId, docId)).limit(1),
      db
        .select({
          id: claims.id,
          claimText: claims.claimText,
          claimType: claims.claimType,
          verdict: claims.verdict,
          overriddenVerdict: claims.overriddenVerdict,
          confidenceScore: claims.confidenceScore,
          pdbEvidenceUrl: claims.pdbEvidenceUrl,
        })
        .from(claims)
        .where(eq(claims.documentId, docId))
        .orderBy(asc(claims.id)),
    ]);

    if (docRows.length === 0) return apiError(res, 404, "Document not found");
    return apiOk(res, {
      document: docRows[0],
      report: reportRows[0] ?? null,
      claims: claimRows,
    });
  });

  return router;
}
