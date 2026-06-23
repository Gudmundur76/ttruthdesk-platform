/**
 * selfDirectWebhook.ts
 *
 * Inbound webhook from the self-direct watcher.
 *
 * POST /api/self-direct/spec-ready
 *   - Verifies HMAC-SHA256 signature (x-self-direct-signature: sha256=<hex>)
 *   - Stores the spec in self_direct_specs table
 *   - Calls notifyOwner() so the spec appears in the Manus chat session as a YES/NO prompt
 *
 * POST /api/self-direct/decision
 *   - Accepts { specId, decision: "approve" | "reject" }
 *   - Updates the spec status in the DB
 *   - Executes `pnpm --prefix /home/ubuntu/self-direct meta:apply <specId>` on approve
 *   - Notifies owner of the outcome
 *
 * Both endpoints are public (no session cookie required) but are protected
 * by the HMAC secret for spec-ready and by the CRON_SECRET/webhookSecret for decision.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import type { Request, Response } from "express";
import { getDb } from "./db";
import { selfDirectSpecs } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";

const execAsync = promisify(exec);

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
    summary?: string;
    spec?: unknown;
    beforeF1?: number;
    afterF1Predicted?: number;
  };

  const specId = payload.specId;
  const adapterId = payload.adapterId;
  const title = payload.title;
  const summary = payload.summary ?? payload.body;
  const spec = payload.spec ?? payload;
  const beforeF1 = payload.beforeF1 ?? payload.beforeRate;
  const afterF1Predicted = payload.afterF1Predicted ?? payload.afterRate;

  if (!specId || !adapterId || !title || !summary) {
    res.status(400).json({
      ok: false,
      error: "Missing required fields: specId, adapterId, title, summary (or body)",
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
      ? `\n📊 F1: ${(beforeF1 * 100).toFixed(1)}% → predicted ${(afterF1Predicted * 100).toFixed(1)}% after fix`
      : "";

  const notifContent =
    `🔧 **Adapter:** \`${adapterId}\`${f1Line}\n\n` +
    `**What self-direct proposes:**\n${summary}\n\n` +
    `**Spec ID:** \`${specId}\`\n\n` +
    `---\n` +
    `Reply **YES** to apply this fix automatically, or **NO** to reject it.\n` +
    `I will act on your reply immediately.`;

  await notifyOwner({
    title: `🤖 self-direct: Fix ready — ${title}`,
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
  const validTokens = [ENV.cronSecret, ENV.selfDirectWebhookSecret].filter(Boolean);
  if (!validTokens.some(t => t === auth)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { specId, decision } = req.body as {
    specId?: string;
    decision?: string;
  };

  if (!specId || (decision !== "approve" && decision !== "reject")) {
    res.status(400).json({
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

  // Execute the self-direct CLI to apply or reject the spec
  const cliCmd =
    decision === "approve"
      ? `pnpm --prefix /home/ubuntu/self-direct meta:apply ${specId}`
      : `pnpm --prefix /home/ubuntu/self-direct meta:reject ${specId}`;

  let cliOutput = "";
  try {
    const { stdout, stderr } = await execAsync(cliCmd, { timeout: 60_000 });
    cliOutput = (stdout + stderr).trim().slice(0, 500);
    console.log(`[selfDirectWebhook] CLI ${decision}: ${cliOutput}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[selfDirectWebhook] CLI ${decision} failed: ${msg}`);
    cliOutput = `CLI error: ${msg.slice(0, 200)}`;
  }

  // Notify owner of the outcome
  const verb = decision === "approve" ? "approved ✅" : "rejected ❌";
  const outcomeDetail =
    decision === "approve"
      ? `Fix is being applied. self-direct will monitor and report back.\n\n\`\`\`\n${cliOutput}\n\`\`\``
      : `No changes made. self-direct continues watching.`;

  await notifyOwner({
    title: `self-direct: Spec ${verb} — ${specId}`,
    content: `Spec \`${specId}\` has been **${verb}**.\n\n${outcomeDetail}`,
  }).catch((err: unknown) => {
    console.warn("[selfDirectWebhook] notifyOwner (decision) failed:", err);
  });

  res.json({ ok: true, specId, status, cliOutput });
}

// ─── Helper: list pending specs (used by tRPC router) ────────────────────────

export async function getPendingSpecs() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(selfDirectSpecs)
    .where(eq(selfDirectSpecs.status, "pending_review"))
    .orderBy(selfDirectSpecs.createdAt);
}

export async function getAllSpecs(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(selfDirectSpecs)
    .orderBy(selfDirectSpecs.createdAt)
    .limit(limit);
}
