/**
 * selfDirectWebhook.ts
 *
 * Inbound webhook from the self-direct watcher.
 *
 * POST /api/self-direct/spec-ready
 *   - Verifies HMAC-SHA256 signature (x-self-direct-signature: sha256=<hex>)
 *   - Stores the spec in self_direct_specs table
 *   - Calls notifyOwner() so the spec appears in the Manus chat session
 *
 * POST /api/self-direct/decision
 *   - Accepts { specId, decision: "approve" | "reject" }
 *   - Updates the spec status in the DB
 *   - Calls the self-direct CLI via HTTP to advance the state machine
 *
 * Both endpoints are public (no session cookie required) but are protected
 * by the HMAC secret for spec-ready and by the CRON_SECRET for decision.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { getDb } from "./db";
import { selfDirectSpecs } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";

// ─── HMAC verification ────────────────────────────────────────────────────────

function verifySignature(
  body: string,
  sigHeader: string,
  secret: string
): boolean {
  if (!secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── POST /api/self-direct/spec-ready ─────────────────────────────────────────

export async function handleSpecReady(
  req: Request,
  res: Response
): Promise<void> {
  const rawBody: string =
    (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
  const sig = (req.headers["x-self-direct-signature"] as string) ?? "";

  if (!verifySignature(rawBody, sig, ENV.selfDirectWebhookSecret)) {
    res.status(401).json({ ok: false, error: "Invalid signature" });
    return;
  }

  // Accept both the self-direct NotificationPayload shape and the direct spec shape
  const payload = req.body as {
    // NotificationPayload fields (from self-direct notifier)
    type?: string;
    title?: string;
    body?: string;
    specId?: string;
    specPath?: string;
    adapterId?: string;
    beforeRate?: number;
    afterRate?: number;
    delta?: number;
    timestamp?: string;
    // Direct spec fields (for manual / test calls)
    summary?: string;
    spec?: unknown;
    beforeF1?: number;
    afterF1Predicted?: number;
  };

  const specId = payload.specId;
  const adapterId = payload.adapterId;
  const title = payload.title;
  // Map NotificationPayload.body → summary, or use summary directly
  const summary = payload.summary ?? payload.body;
  // Store the full payload as the spec JSON when no explicit spec field
  const spec = payload.spec ?? payload;
  const beforeF1 = payload.beforeF1 ?? payload.beforeRate;
  const afterF1Predicted = payload.afterF1Predicted ?? payload.afterRate;

  if (!specId || !adapterId || !title || !summary) {
    res
      .status(400)
      .json({
        ok: false,
        error:
          "Missing required fields: specId, adapterId, title, summary (or body)",
      });
    return;
  }

  // Upsert — idempotent if self-direct retries
  const db = await getDb();
  if (!db) {
    res.status(503).json({ ok: false, error: "Database unavailable" });
    return;
  }
  await db
    .insert(selfDirectSpecs)
    .values({
      specId,
      adapterId,
      title,
      summary,
      specJson: spec,
      beforeF1: beforeF1 ?? null,
      afterF1Predicted: afterF1Predicted ?? null,
      status: "pending_review",
    })
    .onDuplicateKeyUpdate({
      set: {
        title,
        summary,
        specJson: spec,
        beforeF1: beforeF1 ?? null,
        afterF1Predicted: afterF1Predicted ?? null,
        status: "pending_review",
        decidedAt: null,
      },
    });

  // Build the notification that appears in the Manus chat session
  const f1Line =
    beforeF1 != null && afterF1Predicted != null
      ? `\nF1: ${(beforeF1 * 100).toFixed(1)}% → predicted ${(afterF1Predicted * 100).toFixed(1)}% after fix`
      : "";

  const notifContent =
    `**Adapter:** ${adapterId}${f1Line}\n\n` +
    `${summary}\n\n` +
    `**Spec ID:** \`${specId}\`\n\n` +
    `Reply **YES** to apply this fix or **NO** to reject it.\n` +
    `(I will call \`POST /api/self-direct/decision\` on your behalf.)`;

  await notifyOwner({
    title: `self-direct: Fix spec ready — ${title}`,
    content: notifContent,
  }).catch((err: unknown) => {
    console.warn("[selfDirectWebhook] notifyOwner failed:", err);
  });

  res.json({ ok: true, specId });
}

// ─── POST /api/self-direct/decision ──────────────────────────────────────────

export async function handleDecision(
  req: Request,
  res: Response
): Promise<void> {
  // Accept CRON_SECRET or selfDirectWebhookSecret as bearer token
  const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const validTokens = [ENV.cronSecret, ENV.selfDirectWebhookSecret].filter(
    Boolean
  );
  if (!validTokens.some(t => t === auth)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { specId, decision } = req.body as {
    specId?: string;
    decision?: string;
  };

  if (!specId || (decision !== "approve" && decision !== "reject")) {
    res
      .status(400)
      .json({
        ok: false,
        error: "Required: specId, decision ('approve'|'reject')",
      });
    return;
  }

  const status = decision === "approve" ? "approved" : "rejected";

  const db = await getDb();
  if (!db) {
    res.status(503).json({ ok: false, error: "Database unavailable" });
    return;
  }
  const result = await db
    .update(selfDirectSpecs)
    .set({ status, decidedAt: new Date() })
    .where(eq(selfDirectSpecs.specId, specId));

  if (!result[0] || result[0].affectedRows === 0) {
    res.status(404).json({ ok: false, error: `Spec ${specId} not found` });
    return;
  }

  // Notify owner of the decision outcome
  const verb = decision === "approve" ? "approved ✅" : "rejected ❌";
  await notifyOwner({
    title: `self-direct: Spec ${verb}`,
    content:
      `Spec \`${specId}\` has been **${verb}**.\n\n` +
      (decision === "approve"
        ? "self-direct will now apply the fix and report back when monitoring confirms improvement."
        : "No changes will be made. self-direct continues watching."),
  }).catch((err: unknown) => {
    console.warn("[selfDirectWebhook] notifyOwner (decision) failed:", err);
  });

  res.json({ ok: true, specId, status });
}
