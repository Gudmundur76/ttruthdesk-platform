/**
 * POST /api/public/submit-claim
 * Public endpoint — no auth required. Accepts a scientific claim text,
 * creates a document record, fires the full autonomous analysis pipeline,
 * and returns a documentId + polling URL.
 * Rate limit: 10 req/IP/hour. Claim text: 20–2000 chars.
 */
import type { Express, Request, Response } from "express";
import { createDocument, getUserByOpenId, getDb } from "./db";
import { runAnalysisPipeline } from "./analysisPipeline";
import { ENV } from "./_core/env";
import { publicSubmissions } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { logger, errData } from "./logger";
const log = logger("submitClaimRoute");


const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const ipRateMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSec: number;
} {
  const now = Date.now();
  const entry = ipRateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipRateMap.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil(
      (RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 1000
    );
    return { allowed: false, retryAfterSec };
  }
  entry.count++;
  return { allowed: true, retryAfterSec: 0 };
}

async function handleSubmitClaim(req: Request, res: Response): Promise<void> {
  const processedAt = new Date().toISOString();
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    res
      .status(429)
      .json({
        ok: false,
        error: `Rate limit exceeded. Try again in ${rateCheck.retryAfterSec} seconds.`,
        retryAfterSec: rateCheck.retryAfterSec,
        processedAt,
      });
    return;
  }
  const { claim_text, vertical_domain, source } = req.body ?? {};
  if (typeof claim_text !== "string") {
    res
      .status(400)
      .json({
        ok: false,
        error: "claim_text (string) is required.",
        processedAt,
      });
    return;
  }
  const trimmed = claim_text.trim();
  if (trimmed.length < 20) {
    res
      .status(400)
      .json({
        ok: false,
        error: "claim_text must be at least 20 characters.",
        processedAt,
      });
    return;
  }
  if (trimmed.length > 2000) {
    res
      .status(400)
      .json({
        ok: false,
        error: "claim_text must be at most 2000 characters.",
        processedAt,
      });
    return;
  }
  const vertical =
    typeof vertical_domain === "string" && vertical_domain.length <= 64
      ? vertical_domain
      : "structural_biology";
  const submissionSource =
    typeof source === "string" && source.length <= 64 ? source : "api";
  try {
    const db = await getDb();
    let ownerUserId = 1;
    if (ENV.ownerOpenId && db) {
      const ownerUser = await getUserByOpenId(ENV.ownerOpenId);
      if (ownerUser) ownerUserId = ownerUser.id;
    }
    const title =
      trimmed.length > 120 ? trimmed.slice(0, 117) + "..." : trimmed;
    const docId = await createDocument({
      userId: ownerUserId,
      title: `[Public] ${title}`,
      sourceType: "paste",
      rawText: trimmed,
      verticalDomain: vertical,
    });
    if (db) {
      await db
        .insert(publicSubmissions)
        .values({
          claimText: trimmed,
          verticalDomain: vertical,
          source: submissionSource,
          documentId: docId,
          status: "processing",
          submitterIp: ip.slice(0, 64),
        });
    }
    runAnalysisPipeline(docId, trimmed, ownerUserId)
      .then(() => {
        if (db)
          db.update(publicSubmissions)
            .set({ status: "done" })
            .where(eq(publicSubmissions.documentId, docId))
            .catch(() => {});
      })
      .catch(err => {
        log.error("[SubmitClaim] Pipeline error for doc", { docId: String(docId), ...errData(err) });
        if (db)
          db.update(publicSubmissions)
            .set({ status: "failed" })
            .where(eq(publicSubmissions.documentId, docId))
            .catch(() => {});
      });
    import("./autonomousLoop/eventBus")
      .then(({ publishEvent }) =>
        publishEvent("document_submitted", {
          documentId: docId,
          userId: ownerUserId,
          sourceType: "paste",
          publicSubmission: true,
          submissionSource,
        }).catch(() => {})
      )
      .catch(() => {});
    const siteOrigin = ENV.appUrl || "https://truthdesk.claims";
    res
      .status(202)
      .json({
        ok: true,
        documentId: docId,
        statusUrl: `${siteOrigin}/api/public/submit-claim/status/${docId}`,
        claimPageUrl: `${siteOrigin}/claim/${docId}`,
        message:
          "Claim queued for verification. Poll statusUrl to check progress.",
        processedAt,
      });
  } catch (err) {
    log.error("[SubmitClaim] Error:", errData(err));
    res
      .status(500)
      .json({
        ok: false,
        error: "Failed to queue claim for verification. Please try again.",
        processedAt,
      });
  }
}

async function handleSubmitClaimStatus(
  req: Request,
  res: Response
): Promise<void> {
  const docId = parseInt(req.params.id, 10);
  if (isNaN(docId) || docId <= 0) {
    res.status(400).json({ ok: false, error: "Invalid document ID." });
    return;
  }
  try {
    const db = await getDb();
    if (!db) {
      res.status(503).json({ ok: false, error: "Database unavailable." });
      return;
    }
    const rows = await db
      .select({
        status: publicSubmissions.status,
        documentId: publicSubmissions.documentId,
        createdAt: publicSubmissions.createdAt,
        updatedAt: publicSubmissions.updatedAt,
      })
      .from(publicSubmissions)
      .where(eq(publicSubmissions.documentId, docId))
      .limit(1);
    if (rows.length === 0) {
      res.status(404).json({ ok: false, error: "Submission not found." });
      return;
    }
    const row = rows[0];
    const siteOrigin = ENV.appUrl || "https://truthdesk.claims";
    res.json({
      ok: true,
      documentId: docId,
      status: row.status,
      claimPageUrl:
        row.status === "done" ? `${siteOrigin}/claim/${docId}` : null,
      submittedAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    log.error("[SubmitClaimStatus] Error:", errData(err));
    res.status(500).json({ ok: false, error: "Status check failed." });
  }
}

export function registerSubmitClaimRoute(app: Express): void {
  app.options("/api/public/submit-claim", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
  });
  app.options("/api/public/submit-claim/status/:id", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
  });
  app.post("/api/public/submit-claim", handleSubmitClaim);
  app.get("/api/public/submit-claim/status/:id", handleSubmitClaimStatus);
}
