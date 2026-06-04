/**
 * webhookDeliveryService.ts
 *
 * Wraps the alertDispatcher webhook firing with:
 *   1. Delivery log writes (success, failed, timeout, retry_pending)
 *   2. Exponential-backoff retry scheduling (3 attempts max)
 *   3. Admin query helpers for the delivery log UI
 *
 * The retry job is invoked by the orchestrator tick on a 5-minute cron.
 */
import crypto from "crypto";
import { getDb } from "./db";
import { webhookDeliveryLog, webhookAlerts } from "../drizzle/schema";
import { eq, desc, and, lte, lt, inArray } from "drizzle-orm";

export interface DeliveryPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── HMAC signature ───────────────────────────────────────────────────────────

function buildSignature(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

// ─── Core delivery with logging ───────────────────────────────────────────────

export async function deliverWebhook(
  webhookId: number,
  url: string,
  secret: string,
  eventType: string,
  payload: DeliveryPayload,
  attemptCount = 1
): Promise<{ success: boolean; httpStatus?: number; latencyMs: number; errorMsg?: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const body = JSON.stringify(payload);
  const signature = buildSignature(secret, body);
  const start = Date.now();

  let httpStatus: number | undefined;
  let responseBody: string | undefined;
  let errorMsg: string | undefined;
  let success = false;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TruthDesk-Signature": signature,
        "X-TruthDesk-Event": eventType,
        "User-Agent": "TruthDesk-Webhook/1.0",
        "X-TruthDesk-Attempt": String(attemptCount),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = res.status;
    const raw = await res.text().catch(() => "");
    responseBody = raw.slice(0, 2048);
    success = res.ok;
    if (!success) errorMsg = `HTTP ${res.status}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errorMsg = msg.includes("TimeoutError") || msg.includes("AbortError")
      ? "Request timed out after 10s"
      : `Network error: ${msg}`;
  }

  const latencyMs = Date.now() - start;

  // Compute retry schedule (exponential backoff: 5m, 30m, 2h)
  const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
  const nextRetryAt =
    !success && attemptCount <= RETRY_DELAYS_MS.length
      ? new Date(Date.now() + RETRY_DELAYS_MS[attemptCount - 1])
      : null;

  const status = success
    ? "success"
    : nextRetryAt
    ? "retry_pending"
    : "failed";

  await db.insert(webhookDeliveryLog).values({
    webhookId,
    url,
    eventType,
    payload: payload as unknown as Record<string, unknown>,
    httpStatus: httpStatus ?? null,
    status,
    responseBody: responseBody ?? null,
    latencyMs,
    attemptCount,
    nextRetryAt: nextRetryAt ?? undefined,
    errorMsg: errorMsg ?? null,
  });

  return { success, httpStatus, latencyMs, errorMsg };
}

// ─── Retry job — called by orchestrator tick every 5 minutes ─────────────────

export async function retryPendingWebhooks(): Promise<{ retried: number; succeeded: number }> {
  const db = await getDb();
  if (!db) return { retried: 0, succeeded: 0 };

  const now = new Date();
  const pending = await db
    .select()
    .from(webhookDeliveryLog)
    .where(
      and(
        eq(webhookDeliveryLog.status, "retry_pending"),
        lte(webhookDeliveryLog.nextRetryAt, now)
      )
    )
    .limit(50);

  if (pending.length === 0) return { retried: 0, succeeded: 0 };

  // Fetch webhook secrets for the IDs we need
  const webhookIds = Array.from(new Set(pending.map((p) => p.webhookId)));
  const hooks = await db
    .select({ id: webhookAlerts.id, url: webhookAlerts.url, secret: webhookAlerts.secret, active: webhookAlerts.active })
    .from(webhookAlerts)
    .where(inArray(webhookAlerts.id, webhookIds));

  const hookMap = new Map(hooks.map((h) => [h.id, h]));

  let retried = 0;
  let succeeded = 0;

  for (const entry of pending) {
    const hook = hookMap.get(entry.webhookId);
    if (!hook || !hook.active) {
      // Mark permanently failed — webhook deleted or disabled
      await db
        .update(webhookDeliveryLog)
        .set({ status: "failed", errorMsg: "Webhook disabled or deleted", nextRetryAt: null })
        .where(eq(webhookDeliveryLog.id, entry.id));
      continue;
    }

    const nextAttempt = (entry.attemptCount ?? 1) + 1;
    const payload = entry.payload as DeliveryPayload;
    const result = await deliverWebhook(
      hook.id,
      hook.url,
      hook.secret,
      entry.eventType,
      payload,
      nextAttempt
    );

    // Mark the original entry as superseded
    await db
      .update(webhookDeliveryLog)
      .set({ status: result.success ? "success" : "failed", nextRetryAt: null })
      .where(eq(webhookDeliveryLog.id, entry.id));

    retried++;
    if (result.success) succeeded++;
  }

  return { retried, succeeded };
}

// ─── Admin query helpers ──────────────────────────────────────────────────────

export interface DeliveryLogFilters {
  webhookId?: number;
  status?: "success" | "failed" | "timeout" | "retry_pending";
  eventType?: string;
  limit?: number;
  offset?: number;
}

export async function getDeliveryLog(filters: DeliveryLogFilters = {}) {
  const db = await getDb();
  if (!db) return { entries: [], total: 0 };

  const { webhookId, status, eventType, limit = 50, offset = 0 } = filters;

  const conditions = [];
  if (webhookId !== undefined) conditions.push(eq(webhookDeliveryLog.webhookId, webhookId));
  if (status !== undefined) conditions.push(eq(webhookDeliveryLog.status, status));
  if (eventType !== undefined) conditions.push(eq(webhookDeliveryLog.eventType, eventType));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [entries, countResult] = await Promise.all([
    db
      .select()
      .from(webhookDeliveryLog)
      .where(where)
      .orderBy(desc(webhookDeliveryLog.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: webhookDeliveryLog.id })
      .from(webhookDeliveryLog)
      .where(where),
  ]);

  return { entries, total: countResult.length };
}

export async function getDeliveryStats(webhookId?: number) {
  const db = await getDb();
  if (!db) return null;

  const where = webhookId !== undefined ? eq(webhookDeliveryLog.webhookId, webhookId) : undefined;
  const all = await db.select().from(webhookDeliveryLog).where(where);

  const total = all.length;
  const success = all.filter((e) => e.status === "success").length;
  const failed = all.filter((e) => e.status === "failed").length;
  const retryPending = all.filter((e) => e.status === "retry_pending").length;
  const avgLatency =
    total > 0
      ? Math.round(all.reduce((s, e) => s + (e.latencyMs ?? 0), 0) / total)
      : 0;
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;

  // Last 24h
  const since24h = new Date(Date.now() - 24 * 60 * 60_000);
  const recent = all.filter((e) => e.createdAt >= since24h);

  return {
    total,
    success,
    failed,
    retryPending,
    avgLatency,
    successRate,
    last24h: {
      total: recent.length,
      success: recent.filter((e) => e.status === "success").length,
      failed: recent.filter((e) => e.status === "failed").length,
    },
  };
}

// ─── Manual retry trigger (admin action) ─────────────────────────────────────

export async function manualRetry(deliveryLogId: number): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  if (!db) return { success: false, message: "DB unavailable" };

  const [entry] = await db
    .select()
    .from(webhookDeliveryLog)
    .where(eq(webhookDeliveryLog.id, deliveryLogId))
    .limit(1);

  if (!entry) return { success: false, message: "Delivery log entry not found" };
  if (entry.status === "success") return { success: false, message: "Already delivered successfully" };

  const [hook] = await db
    .select()
    .from(webhookAlerts)
    .where(eq(webhookAlerts.id, entry.webhookId))
    .limit(1);

  if (!hook) return { success: false, message: "Webhook not found" };
  if (!hook.active) return { success: false, message: "Webhook is disabled" };

  const nextAttempt = (entry.attemptCount ?? 1) + 1;
  const payload = entry.payload as DeliveryPayload;
  const result = await deliverWebhook(hook.id, hook.url, hook.secret, entry.eventType, payload, nextAttempt);

  // Mark original as superseded
  await db
    .update(webhookDeliveryLog)
    .set({ status: result.success ? "success" : "failed", nextRetryAt: null })
    .where(eq(webhookDeliveryLog.id, deliveryLogId));

  return {
    success: result.success,
    message: result.success
      ? `Delivered successfully (${result.latencyMs}ms)`
      : `Delivery failed: ${result.errorMsg}`,
  };
}

// ─── Prune old log entries (keep last 90 days) ────────────────────────────────

export async function pruneDeliveryLog(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000);
  const old = await db
    .select({ id: webhookDeliveryLog.id })
    .from(webhookDeliveryLog)
    .where(lt(webhookDeliveryLog.createdAt, cutoff))
    .limit(500);

  if (old.length === 0) return 0;

  await db
    .delete(webhookDeliveryLog)
    .where(inArray(webhookDeliveryLog.id, old.map((r) => r.id)));

  return old.length;
}
