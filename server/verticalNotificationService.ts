/**
 * Vertical Notification Service
 *
 * Sends digest notifications to users who have subscribed to research verticals.
 * Supports three frequencies: instant (on new claim), daily, and weekly digests.
 * Uses the Manus built-in notification channel as the primary delivery mechanism.
 *
 * Called by:
 *  - The orchestrator tick job (after ingesting new claims)
 *  - A scheduled heartbeat job (daily/weekly digest sweep)
 */

import { getDb } from "./db";
import { notifyOwner } from "./_core/notification";
import {
  verticalAlerts,
  notificationLog,
  claims,
  documents,
  users,
} from "../drizzle/schema";
import { eq, and, gte, gt, inArray, sql, desc } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotificationResult {
  userId: number;
  verticalDomain: string;
  claimsSent: number;
  contradictionsSent: number;
  channel: "manus" | "webhook";
  status: "sent" | "failed" | "skipped";
  error?: string;
}

export interface DigestSweepResult {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  notifications: NotificationResult[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the cutoff timestamp for a given frequency.
 * - instant: last 15 minutes (used after ingestion)
 * - daily: last 24 hours
 * - weekly: last 7 days
 */
function getCutoffDate(frequency: "instant" | "daily" | "weekly"): Date {
  const now = Date.now();
  const offsets: Record<string, number> = {
    instant: 15 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - (offsets[frequency] ?? offsets.daily));
}

/**
 * Format a claim for inclusion in a notification message.
 */
function formatClaim(claim: {
  claimText: string;
  verdict: string | null;
  confidenceScore: number | null;
  documentTitle?: string | null;
}): string {
  const confidence = claim.confidenceScore != null
    ? ` (${Math.round(claim.confidenceScore * 100)}% confidence)`
    : "";
  const verdict = claim.verdict ? ` — ${claim.verdict}` : "";
  const source = claim.documentTitle ? `\n  Source: ${claim.documentTitle}` : "";
  return `• ${claim.claimText}${verdict}${confidence}${source}`;
}

// ─── Core notification sender ─────────────────────────────────────────────────

/**
 * Send a digest notification to a single user for a single vertical.
 * Returns the result of the notification attempt.
 */
async function sendVerticalDigest(opts: {
  userId: number;
  userName: string | null;
  verticalDomain: string;
  newClaims: Array<{
    id: number;
    claimText: string;
    verdict: string | null;
    confidenceScore: number | null;
    documentTitle?: string | null;
  }>;
  newContradictions: Array<{
    id: number;
    claimText: string;
    verdict: string | null;
    confidenceScore: number | null;
    documentTitle?: string | null;
  }>;
}): Promise<NotificationResult> {
  const { userId, verticalDomain, newClaims, newContradictions } = opts;

  if (newClaims.length === 0 && newContradictions.length === 0) {
    return {
      userId,
      verticalDomain,
      claimsSent: 0,
      contradictionsSent: 0,
      channel: "manus",
      status: "skipped",
    };
  }

  const verticalLabel = verticalDomain.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const sections: string[] = [];

  if (newClaims.length > 0) {
    sections.push(
      `**New High-Confidence Claims (${newClaims.length})**\n` +
      newClaims.slice(0, 5).map(formatClaim).join("\n") +
      (newClaims.length > 5 ? `\n  …and ${newClaims.length - 5} more` : "")
    );
  }

  if (newContradictions.length > 0) {
    sections.push(
      `**New Contradictions Detected (${newContradictions.length})**\n` +
      newContradictions.slice(0, 3).map(formatClaim).join("\n") +
      (newContradictions.length > 3 ? `\n  …and ${newContradictions.length - 3} more` : "")
    );
  }

  const title = `Truth Desk: ${verticalLabel} Update`;
  const content = [
    `New evidence has been published in the **${verticalLabel}** vertical on Protein Truth Desk.`,
    "",
    ...sections,
    "",
    `View the full vertical at: /verticals/${verticalDomain}`,
  ].join("\n");

  try {
    // Use the Manus built-in notification system
    // Note: notifyOwner sends to the project owner; for per-user notifications
    // we use the same channel since Manus notifications are owner-scoped.
    // In a production multi-tenant deployment this would use a transactional
    // email service (Resend, Postmark, etc.).
    const sent = await notifyOwner({ title, content });

    return {
      userId,
      verticalDomain,
      claimsSent: newClaims.length,
      contradictionsSent: newContradictions.length,
      channel: "manus",
      status: sent ? "sent" : "failed",
      error: sent ? undefined : "Notification service unavailable",
    };
  } catch (err) {
    return {
      userId,
      verticalDomain,
      claimsSent: newClaims.length,
      contradictionsSent: newContradictions.length,
      channel: "manus",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Log helper ───────────────────────────────────────────────────────────────

async function logNotification(
  db: Awaited<ReturnType<typeof getDb>>,
  result: NotificationResult & { claimIds: number[]; contradictionIds: number[] }
): Promise<void> {
  if (!db) return;
  await db.insert(notificationLog).values({
    userId: result.userId,
    notifType: "vertical_digest",
    payload: {
      verticalDomain: result.verticalDomain,
      claimIds: result.claimIds,
      contradictionIds: result.contradictionIds,
      claimsSent: result.claimsSent,
      contradictionsSent: result.contradictionsSent,
    },
    channel: result.channel,
    status: result.status,
    errorMsg: result.error ?? null,
  }).catch(() => {}); // never throw on logging failure
}

// ─── Digest sweep ─────────────────────────────────────────────────────────────

/**
 * Run a full digest sweep for all active subscriptions matching the given frequency.
 * Called by the heartbeat job on a schedule.
 */
export async function runDigestSweep(
  frequency: "instant" | "daily" | "weekly" = "daily"
): Promise<DigestSweepResult> {
  const db = await getDb();
  if (!db) {
    return { processed: 0, sent: 0, skipped: 0, failed: 0, notifications: [] };
  }

  const cutoff = getCutoffDate(frequency);
  const now = new Date();

  // Find all active subscriptions for this frequency that haven't been sent recently
  const subscriptions = await db
    .select({
      id: verticalAlerts.id,
      userId: verticalAlerts.userId,
      verticalDomain: verticalAlerts.verticalDomain,
      minConfidence: verticalAlerts.minConfidence,
      notifyContradictions: verticalAlerts.notifyContradictions,
      notifySupported: verticalAlerts.notifySupported,
      lastSentAt: verticalAlerts.lastSentAt,
      userName: users.name,
    })
    .from(verticalAlerts)
    .leftJoin(users, eq(verticalAlerts.userId, users.id))
    .where(
      and(
        eq(verticalAlerts.active, true),
        eq(verticalAlerts.frequency, frequency)
      )
    )
    .limit(200);

  const results: NotificationResult[] = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    // Skip if already sent within the frequency window
    if (sub.lastSentAt && sub.lastSentAt > cutoff) {
      skipped++;
      continue;
    }

    const sinceDate = sub.lastSentAt ?? cutoff;

    // Fetch new high-confidence supported claims since last send
    // Claims join through documents to get the verticalDomain
    const newSupportedClaims = sub.notifySupported
      ? await db
          .select({
            id: claims.id,
            claimText: claims.claimText,
            verdict: claims.verdict,
            confidenceScore: claims.confidenceScore,
            documentTitle: documents.title,
          })
          .from(claims)
          .innerJoin(documents, eq(claims.documentId, documents.id))
          .where(
            and(
              eq(documents.verticalDomain, sub.verticalDomain),
              eq(claims.verdict, "Supported"),
              gte(claims.createdAt, sinceDate),
              gt(claims.confidenceScore, sub.minConfidence)
            )
          )
          .orderBy(desc(claims.confidenceScore))
          .limit(10)
      : [];

    // Fetch new contradictions since last send
    const newContradictions = sub.notifyContradictions
      ? await db
          .select({
            id: claims.id,
            claimText: claims.claimText,
            verdict: claims.verdict,
            confidenceScore: claims.confidenceScore,
            documentTitle: documents.title,
          })
          .from(claims)
          .innerJoin(documents, eq(claims.documentId, documents.id))
          .where(
            and(
              eq(documents.verticalDomain, sub.verticalDomain),
              eq(claims.verdict, "Contradicted"),
              gte(claims.createdAt, sinceDate)
            )
          )
          .orderBy(desc(claims.createdAt))
          .limit(5)
      : [];

    const result = await sendVerticalDigest({
      userId: sub.userId,
      userName: sub.userName ?? null,
      verticalDomain: sub.verticalDomain,
      newClaims: newSupportedClaims,
      newContradictions,
    });

    // Log the notification
    await logNotification(db, {
      ...result,
      claimIds: newSupportedClaims.map((c) => c.id),
      contradictionIds: newContradictions.map((c) => c.id),
    });

    // Update lastSentAt if we sent something
    if (result.status === "sent") {
      await db
        .update(verticalAlerts)
        .set({ lastSentAt: now })
        .where(eq(verticalAlerts.id, sub.id))
        .catch(() => {});
      sent++;
    } else if (result.status === "skipped") {
      skipped++;
    } else {
      failed++;
    }

    results.push(result);
  }

  return {
    processed: subscriptions.length,
    sent,
    skipped,
    failed,
    notifications: results,
  };
}

// ─── Instant notification trigger ─────────────────────────────────────────────

/**
 * Trigger instant notifications for users subscribed to a specific vertical
 * when new claims are ingested. Called from the agent ingestion endpoint.
 */
export async function triggerInstantNotifications(
  verticalDomain: string,
  newClaimIds: number[]
): Promise<void> {
  if (newClaimIds.length === 0) return;

  const db = await getDb();
  if (!db) return;

  // Find instant subscribers for this vertical
  const subscribers = await db
    .select({
      id: verticalAlerts.id,
      userId: verticalAlerts.userId,
      minConfidence: verticalAlerts.minConfidence,
      notifyContradictions: verticalAlerts.notifyContradictions,
      notifySupported: verticalAlerts.notifySupported,
      userName: users.name,
    })
    .from(verticalAlerts)
    .leftJoin(users, eq(verticalAlerts.userId, users.id))
    .where(
      and(
        eq(verticalAlerts.active, true),
        eq(verticalAlerts.frequency, "instant"),
        eq(verticalAlerts.verticalDomain, verticalDomain)
      )
    )
    .limit(50);

  if (subscribers.length === 0) return;

  // Fetch the new claims
  const newClaims = await db
    .select({
      id: claims.id,
      claimText: claims.claimText,
      verdict: claims.verdict,
      confidenceScore: claims.confidenceScore,
      documentTitle: documents.title,
    })
    .from(claims)
    .leftJoin(documents, eq(claims.documentId, documents.id))
    .where(inArray(claims.id, newClaimIds))
    .limit(20);

  const now = new Date();

  for (const sub of subscribers) {
    const relevant = newClaims.filter((c) => {
      const meetsConfidence = (c.confidenceScore ?? 0) >= sub.minConfidence;
      const isSupported = c.verdict === "Supported" && sub.notifySupported;
      const isContradiction = c.verdict === "Contradicted" && sub.notifyContradictions;
      return meetsConfidence && (isSupported || isContradiction);
    });

    if (relevant.length === 0) continue;

    const supported = relevant.filter((c) => c.verdict === "Supported");
    const contradictions = relevant.filter((c) => c.verdict === "Contradicted");

    const result = await sendVerticalDigest({
      userId: sub.userId,
      userName: sub.userName ?? null,
      verticalDomain,
      newClaims: supported,
      newContradictions: contradictions,
    });

    await logNotification(db, {
      ...result,
      claimIds: supported.map((c) => c.id),
      contradictionIds: contradictions.map((c) => c.id),
    });

    if (result.status === "sent") {
      await db
        .update(verticalAlerts)
        .set({ lastSentAt: now })
        .where(eq(verticalAlerts.id, sub.id))
        .catch(() => {});
    }
  }
}
