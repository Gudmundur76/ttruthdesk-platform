/**
 * exportRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Structured data export endpoints for claims, audit reports, and entities.
 *
 * All endpoints are public (no auth required), rate-limited to 20 req/min per IP.
 *
 * Endpoints:
 *   GET /api/v2/export/claims.csv   — CSV export of claims with filters
 *   GET /api/v2/export/claims.json  — JSON export of claims with filters
 *   GET /api/v2/export/reports.csv  — CSV export of audit report summaries
 *   GET /api/v2/export/reports.json — JSON export of audit report summaries
 *   GET /api/v2/export/entities.csv — CSV export of graph entities
 *   GET /api/v2/export/entities.json— JSON export of graph entities
 *
 * Query parameters (all optional):
 *   vertical   — filter by verticalDomain (e.g. "structural_biology")
 *   verdict    — filter by verdict (e.g. "Supported")
 *   from       — ISO date string, filter createdAt >= from
 *   to         — ISO date string, filter createdAt <= to
 *   documentId — filter by specific document ID
 *   limit      — max rows (default 500, max 5000)
 */
import { Router, type Request, type Response } from "express";
import { getDb } from "./db";
import { claims, documents, auditReports, graphEntities } from "../drizzle/schema";
import { eq, and, gte, lte, like, desc } from "drizzle-orm";

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const exportRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const EXPORT_RATE_LIMIT = 20;
const EXPORT_RATE_WINDOW_MS = 60_000;

function checkExportRateLimit(req: Request): boolean {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.ip ??
    "unknown";
  const now = Date.now();
  const entry = exportRateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    exportRateLimitMap.set(ip, { count: 1, resetAt: now + EXPORT_RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= EXPORT_RATE_LIMIT;
}

// ─── CORS headers ─────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

// ─── CSV serialiser ───────────────────────────────────────────────────────────
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];
  return lines.join("\r\n");
}

// ─── Filter builder ───────────────────────────────────────────────────────────
function parseLimit(req: Request): number {
  const raw = parseInt((req.query.limit as string) ?? "500", 10);
  return isNaN(raw) ? 500 : Math.min(5000, Math.max(1, raw));
}

// ─── Router factory ───────────────────────────────────────────────────────────
export function createExportRouter(): Router {
  const router = Router();

  // OPTIONS pre-flight
  router.options("*", (_req, res) => res.set(CORS).status(204).send());

  // ─── Claims export ──────────────────────────────────────────────────────────
  async function fetchClaims(req: Request) {
    const db = await getDb();
    if (!db) return [];

    const limit = parseLimit(req);
    const conditions = [];

    if (req.query.documentId) {
      conditions.push(eq(claims.documentId, parseInt(req.query.documentId as string, 10)));
    }
    if (req.query.verdict) {
      // Use like() to avoid enum type conflicts
      conditions.push(like(claims.verdict, req.query.verdict as string));
    }
    if (req.query.from) {
      conditions.push(gte(claims.createdAt, new Date(req.query.from as string)));
    }
    if (req.query.to) {
      conditions.push(lte(claims.createdAt, new Date(req.query.to as string)));
    }

    // Join with documents to filter by vertical
    let rows;
    if (req.query.vertical) {
      rows = await db
        .select({
          id: claims.id,
          documentId: claims.documentId,
          claimText: claims.claimText,
          verdict: claims.verdict,
          verdictRationale: claims.verdictRationale,
          confidenceScore: claims.confidenceScore,
          pdbId: claims.pdbId,
          proteinName: claims.proteinName,
          createdAt: claims.createdAt,
          verticalDomain: documents.verticalDomain,
          documentTitle: documents.title,
        })
        .from(claims)
        .innerJoin(documents, eq(claims.documentId, documents.id))
        .where(
          and(
            like(documents.verticalDomain, req.query.vertical as string),
            ...conditions
          )
        )
        .orderBy(desc(claims.createdAt))
        .limit(limit);
    } else {
      rows = await db
        .select({
          id: claims.id,
          documentId: claims.documentId,
          claimText: claims.claimText,
          verdict: claims.verdict,
          verdictRationale: claims.verdictRationale,
          confidenceScore: claims.confidenceScore,
          pdbId: claims.pdbId,
          proteinName: claims.proteinName,
          createdAt: claims.createdAt,
          verticalDomain: documents.verticalDomain,
          documentTitle: documents.title,
        })
        .from(claims)
        .innerJoin(documents, eq(claims.documentId, documents.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(claims.createdAt))
        .limit(limit);
    }

    return rows.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      documentTitle: r.documentTitle ?? "",
      verticalDomain: r.verticalDomain,
      claimText: r.claimText,
      verdict: r.verdict ?? "",
      verdictRationale: r.verdictRationale ?? "",
      confidenceScore: r.confidenceScore ?? "",
      pdbId: r.pdbId ?? "",
      proteinName: r.proteinName ?? "",
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));
  }

  router.get("/claims.json", async (req: Request, res: Response) => {
    if (!checkExportRateLimit(req)) {
      return res.set(CORS).status(429).json({ ok: false, error: "Rate limit exceeded" });
    }
    try {
      const rows = await fetchClaims(req);
      return res.set({ ...CORS, "Content-Type": "application/json" }).json({
        ok: true,
        count: rows.length,
        exportedAt: new Date().toISOString(),
        data: rows,
      });
    } catch (err) {
      console.error("[export] claims.json error:", err);
      return res.set(CORS).status(500).json({ ok: false, error: "Export failed" });
    }
  });

  router.get("/claims.csv", async (req: Request, res: Response) => {
    if (!checkExportRateLimit(req)) {
      return res.set(CORS).status(429).json({ ok: false, error: "Rate limit exceeded" });
    }
    try {
      const rows = await fetchClaims(req);
      const csv = toCsv(rows);
      return res
        .set({
          ...CORS,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="truth-desk-claims-${Date.now()}.csv"`,
        })
        .send(csv);
    } catch (err) {
      console.error("[export] claims.csv error:", err);
      return res.set(CORS).status(500).json({ ok: false, error: "Export failed" });
    }
  });

  // ─── Audit reports export ───────────────────────────────────────────────────
  async function fetchReports(req: Request) {
    const db = await getDb();
    if (!db) return [];

    const limit = parseLimit(req);
    const conditions = [];

    if (req.query.vertical) {
      conditions.push(like(documents.verticalDomain, req.query.vertical as string));
    }
    if (req.query.documentId) {
      conditions.push(eq(auditReports.documentId, parseInt(req.query.documentId as string, 10)));
    }
    if (req.query.from) {
      conditions.push(gte(auditReports.generatedAt, new Date(req.query.from as string)));
    }
    if (req.query.to) {
      conditions.push(lte(auditReports.generatedAt, new Date(req.query.to as string)));
    }

    const rows = await db
      .select({
        id: auditReports.id,
        documentId: auditReports.documentId,
        documentTitle: documents.title,
        verticalDomain: documents.verticalDomain,
        totalClaims: auditReports.totalClaims,
        highRiskCount: auditReports.highRiskCount,
        verdictSummary: auditReports.verdictSummary,
        generatedAt: auditReports.generatedAt,
      })
      .from(auditReports)
      .innerJoin(documents, eq(auditReports.documentId, documents.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditReports.generatedAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      documentTitle: r.documentTitle ?? "",
      verticalDomain: r.verticalDomain,
      totalClaims: r.totalClaims ?? 0,
      highRiskCount: r.highRiskCount ?? 0,
      verdictSummary: r.verdictSummary ? JSON.stringify(r.verdictSummary) : "",
      generatedAt: r.generatedAt instanceof Date ? r.generatedAt.toISOString() : String(r.generatedAt),
    }));
  }

  router.get("/reports.json", async (req: Request, res: Response) => {
    if (!checkExportRateLimit(req)) {
      return res.set(CORS).status(429).json({ ok: false, error: "Rate limit exceeded" });
    }
    try {
      const rows = await fetchReports(req);
      return res.set({ ...CORS, "Content-Type": "application/json" }).json({
        ok: true,
        count: rows.length,
        exportedAt: new Date().toISOString(),
        data: rows,
      });
    } catch (err) {
      console.error("[export] reports.json error:", err);
      return res.set(CORS).status(500).json({ ok: false, error: "Export failed" });
    }
  });

  router.get("/reports.csv", async (req: Request, res: Response) => {
    if (!checkExportRateLimit(req)) {
      return res.set(CORS).status(429).json({ ok: false, error: "Rate limit exceeded" });
    }
    try {
      const rows = await fetchReports(req);
      const csv = toCsv(rows);
      return res
        .set({
          ...CORS,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="truth-desk-reports-${Date.now()}.csv"`,
        })
        .send(csv);
    } catch (err) {
      console.error("[export] reports.csv error:", err);
      return res.set(CORS).status(500).json({ ok: false, error: "Export failed" });
    }
  });

  // ─── Entities export ────────────────────────────────────────────────────────
  async function fetchEntities(req: Request) {
    const db = await getDb();
    if (!db) return [];

    const limit = parseLimit(req);
    const conditions = [];

    if (req.query.type) {
      conditions.push(like(graphEntities.entityType, req.query.type as string));
    }
    if (req.query.from) {
      conditions.push(gte(graphEntities.createdAt, new Date(req.query.from as string)));
    }

    const rows = await db
      .select({
        id: graphEntities.id,
        canonicalName: graphEntities.canonicalName,
        entityType: graphEntities.entityType,
        metadata: graphEntities.metadata,
        firstSeenDocumentId: graphEntities.firstSeenDocumentId,
        createdAt: graphEntities.createdAt,
      })
      .from(graphEntities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(graphEntities.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      canonicalName: r.canonicalName,
      entityType: r.entityType,
      firstSeenDocumentId: r.firstSeenDocumentId ?? "",
      metadata: r.metadata ? JSON.stringify(r.metadata) : "",
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));
  }

  router.get("/entities.json", async (req: Request, res: Response) => {
    if (!checkExportRateLimit(req)) {
      return res.set(CORS).status(429).json({ ok: false, error: "Rate limit exceeded" });
    }
    try {
      const rows = await fetchEntities(req);
      return res.set({ ...CORS, "Content-Type": "application/json" }).json({
        ok: true,
        count: rows.length,
        exportedAt: new Date().toISOString(),
        data: rows,
      });
    } catch (err) {
      console.error("[export] entities.json error:", err);
      return res.set(CORS).status(500).json({ ok: false, error: "Export failed" });
    }
  });

  router.get("/entities.csv", async (req: Request, res: Response) => {
    if (!checkExportRateLimit(req)) {
      return res.set(CORS).status(429).json({ ok: false, error: "Rate limit exceeded" });
    }
    try {
      const rows = await fetchEntities(req);
      const csv = toCsv(rows);
      return res
        .set({
          ...CORS,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="truth-desk-entities-${Date.now()}.csv"`,
        })
        .send(csv);
    } catch (err) {
      console.error("[export] entities.csv error:", err);
      return res.set(CORS).status(500).json({ ok: false, error: "Export failed" });
    }
  });

  return router;
}
