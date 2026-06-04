/**
 * batchAuditRouter.ts
 *
 * Express router that exposes POST /api/v2/batch-audit
 *
 * Accepts up to 20 papers in a single request, runs the full analysis
 * pipeline on each (claim extraction → PDB validation → quality scoring),
 * and returns structured results as a JSON array.
 *
 * Authentication: Bearer token (COORD_API_KEY) for programmatic access,
 * or a valid session cookie for authenticated web users.
 *
 * Rate limiting: max 5 batch requests per 15 minutes per IP.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getDb } from "./db";
import { documents, claims as claimsTable } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { runAnalysisPipeline } from "./analysisPipeline";
import { scoreBatch } from "./claimQualityScorer";

// ─── Rate limiter (in-memory, per IP) ────────────────────────────────────────
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 5;
const ipWindows = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  let window = ipWindows.get(ip);
  if (!window || now > window.resetAt) {
    window = { count: 0, resetAt: now + WINDOW_MS };
    ipWindows.set(ip, window);
  }
  window.count++;
  if (window.count > MAX_REQUESTS) {
    return { allowed: false, retryAfterMs: window.resetAt - now };
  }
  return { allowed: true, retryAfterMs: 0 };
}

// ─── Input schema ─────────────────────────────────────────────────────────────
const PaperSchema = z.object({
  /** Unique caller-assigned ID for correlating results back to inputs */
  ref: z.string().max(128).optional(),
  title: z.string().min(1).max(512),
  text: z.string().min(20).max(200_000),
  /** Optional vertical domain override (defaults to structural_biology) */
  verticalDomain: z.string().max(64).optional(),
  /** Optional PMID for provenance tracking */
  pmid: z.string().max(20).optional(),
});

const BatchAuditRequestSchema = z.object({
  papers: z.array(PaperSchema).min(1).max(20),
  /**
   * If true, run quality scoring after the pipeline completes.
   * Adds ~200ms per paper but returns confidenceScore in results.
   */
  includeQualityScores: z.boolean().default(true),
});

// ─── Result types ─────────────────────────────────────────────────────────────
type ClaimResult = {
  claimId: number;
  claimText: string;
  claimType: string | null;
  verdict: string | null;
  verdictRationale: string | null;
  confidenceScore: number | null;
  confidenceFlags: string[] | null;
  extractedValue: string | null;
};

type PaperResult = {
  ref: string | null;
  title: string;
  documentId: number;
  status: "complete" | "failed";
  errorMessage: string | null;
  claimCount: number;
  claims: ClaimResult[];
  processingMs: number;
};

// ─── System user ID for batch-created documents ───────────────────────────────
const BATCH_USER_ID = 1; // Owner / system user

// ─── Router ───────────────────────────────────────────────────────────────────
export const batchAuditRouter = Router();

batchAuditRouter.post("/", async (req: Request, res: Response) => {
  // ── Auth: accept COORD_API_KEY bearer or session cookie ──────────────────
  const authHeader = req.headers.authorization ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const { ENV } = await import("./_core/env");
  const coordKey = ENV.coordApiKey as string | undefined;

  // Check if user is authenticated via session cookie
  const sessionUser = (req as unknown as { user?: { id: number } }).user;
  const isAuthenticated =
    (bearerToken && coordKey && bearerToken === coordKey) ||
    sessionUser != null;

  if (!isAuthenticated) {
    res.status(401).json({ error: "Unauthorized. Provide a valid Bearer token or session cookie." });
    return;
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: "Rate limit exceeded",
      retryAfterMs: rateCheck.retryAfterMs,
    });
    return;
  }

  // ── Parse input ───────────────────────────────────────────────────────────
  const parsed = BatchAuditRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const { papers, includeQualityScores } = parsed.data;

  const db = await getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  // ── Process each paper sequentially (avoids DB connection exhaustion) ─────
  const results: PaperResult[] = [];
  const userId = sessionUser?.id ?? BATCH_USER_ID;

  for (const paper of papers) {
    const t0 = Date.now();
    let documentId: number | null = null;

    try {
      // 1. Create document record
      const [insertResult] = await db.insert(documents).values({
        userId,
        title: paper.title,
        sourceType: "paste",
        rawText: paper.text,
        verticalDomain: paper.verticalDomain ?? "structural_biology",
        status: "pending",
      });
      documentId = (insertResult as unknown as { insertId: number }).insertId;

      // 2. Run full analysis pipeline (synchronous for batch — we await it)
      await runAnalysisPipeline(documentId, paper.text, userId);

      // 3. Optionally run quality scoring
      if (includeQualityScores) {
        await scoreBatch(documentId).catch(() => {
          // Quality scoring failure is non-fatal
        });
      }

      // 4. Fetch resulting claims
      const claimRows = await db
        .select({
          claimId: claimsTable.id,
          claimText: claimsTable.claimText,
          claimType: claimsTable.claimType,
          verdict: claimsTable.verdict,
          verdictRationale: claimsTable.verdictRationale,
          confidenceScore: claimsTable.confidenceScore,
          confidenceFlags: claimsTable.confidenceFlags,
          extractedValue: claimsTable.extractedValue,
        })
        .from(claimsTable)
        .where(eq(claimsTable.documentId, documentId));

      results.push({
        ref: paper.ref ?? null,
        title: paper.title,
        documentId,
        status: "complete",
        errorMessage: null,
        claimCount: claimRows.length,
        claims: claimRows.map((r) => ({
          claimId: r.claimId,
          claimText: r.claimText,
          claimType: r.claimType ?? null,
          verdict: r.verdict ?? null,
          verdictRationale: r.verdictRationale ?? null,
          confidenceScore: r.confidenceScore ?? null,
          confidenceFlags: r.confidenceFlags as string[] | null,
          extractedValue: r.extractedValue ?? null,
        })),
        processingMs: Date.now() - t0,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[BatchAudit] Failed to process paper "${paper.title}":`, err);

      // Mark document as failed if it was created
      if (documentId) {
        await db
          .update(documents)
          .set({ status: "failed", errorMessage })
          .where(eq(documents.id, documentId))
          .catch(() => {});
      }

      results.push({
        ref: paper.ref ?? null,
        title: paper.title,
        documentId: documentId ?? -1,
        status: "failed",
        errorMessage,
        claimCount: 0,
        claims: [],
        processingMs: Date.now() - t0,
      });
    }
  }

  // ── Build summary ─────────────────────────────────────────────────────────
  const totalClaims = results.reduce((s, r) => s + r.claimCount, 0);
  const succeeded = results.filter((r) => r.status === "complete").length;
  const failed = results.filter((r) => r.status === "failed").length;

  const verdictCounts: Record<string, number> = {};
  for (const r of results) {
    for (const c of r.claims) {
      if (c.verdict) verdictCounts[c.verdict] = (verdictCounts[c.verdict] ?? 0) + 1;
    }
  }

  res.json({
    summary: {
      papersRequested: papers.length,
      papersSucceeded: succeeded,
      papersFailed: failed,
      totalClaims,
      verdictDistribution: verdictCounts,
    },
    results,
  });
});

// ─── GET /api/v2/batch-audit/status/:documentId ───────────────────────────────
// Lightweight endpoint to poll the status of a previously submitted document.
batchAuditRouter.get("/status/:documentId", async (req: Request, res: Response) => {
  const id = parseInt(req.params.documentId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const db = await getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      status: documents.status,
      claimCount: documents.claimCount,
      errorMessage: documents.errorMessage,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const doc = rows[0];

  // Only return claims if complete
  let claimRows: ClaimResult[] = [];
  if (doc.status === "complete") {
    const raw = await db
      .select({
        claimId: claimsTable.id,
        claimText: claimsTable.claimText,
        claimType: claimsTable.claimType,
        verdict: claimsTable.verdict,
        verdictRationale: claimsTable.verdictRationale,
        confidenceScore: claimsTable.confidenceScore,
        confidenceFlags: claimsTable.confidenceFlags,
        extractedValue: claimsTable.extractedValue,
      })
      .from(claimsTable)
      .where(eq(claimsTable.documentId, id));

    claimRows = raw.map((r) => ({
      claimId: r.claimId,
      claimText: r.claimText,
      claimType: r.claimType ?? null,
      verdict: r.verdict ?? null,
      verdictRationale: r.verdictRationale ?? null,
      confidenceScore: r.confidenceScore ?? null,
      confidenceFlags: r.confidenceFlags as string[] | null,
      extractedValue: r.extractedValue ?? null,
    }));
  }

  res.json({
    documentId: doc.id,
    title: doc.title,
    status: doc.status,
    claimCount: doc.claimCount,
    errorMessage: doc.errorMessage,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    claims: claimRows,
  });
});
