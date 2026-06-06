/**
 * alertRouter.ts — Meta-Agent Alert Routing Layer
 *
 * Routes meta-agent findings to the appropriate notification channel:
 *   - "info"     → console.log only
 *   - "warning"  → console.warn + owner notification (batched)
 *   - "critical" → console.error + immediate owner notification + Telegram
 *
 * Deduplicates alerts within a 24-hour window so the same finding
 * doesn't spam the owner on every swarm tick.
 */

import { getDb } from "../db";
import { metaAgentChecks } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { ENV } from "../_core/env";
import type { DriftFinding } from "./codeDriftService";
import type { InvariantResult } from "./pipelineGuardian";
import { gt, eq, and } from "drizzle-orm";

export type AlertSeverity = "info" | "warning" | "critical";

export interface MetaFinding {
  checkType: string;
  severity: AlertSeverity;
  confidence: number;
  summary: string;
  details: Record<string, unknown>;
  actionTaken?: "ok" | "alerted" | "queuedFix" | "autoResolved" | "escalated";
}

// ─── Deduplication ────────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Returns true if this checkType + severity combo was already persisted
 * within the dedup window (so we don't re-alert).
 */
async function isRecentlyAlerted(checkType: string, severity: AlertSeverity): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
  try {
    const recent = await db
      .select({ id: metaAgentChecks.id })
      .from(metaAgentChecks)
      .where(
        and(
          eq(metaAgentChecks.checkType, checkType),
          eq(metaAgentChecks.severity, severity),
          eq(metaAgentChecks.actionTaken, "alerted"),
          gt(metaAgentChecks.createdAt, cutoff)
        )
      )
      .limit(1);
    return recent.length > 0;
  } catch {
    return false;
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function persistFinding(finding: MetaFinding): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const result = await db.insert(metaAgentChecks).values({
      agentName: "codeGuardianAgent",
      checkType: finding.checkType,
      finding: finding.details as Record<string, unknown>,
      actionTaken: finding.actionTaken ?? "ok",
      severity: finding.severity,
      confidence: finding.confidence,
    });
    return (result as unknown as { insertId: number }).insertId ?? null;
  } catch (err) {
    console.error("[MetaAgent] Failed to persist finding:", err);
    return null;
  }
}

// ─── Telegram (reuse ENV pattern from alertDispatcher) ───────────────────────

async function sendTelegramMetaAlert(finding: MetaFinding): Promise<void> {
  const token = ENV.telegramBotToken;
  const chatId = ENV.telegramChannelId;
  if (!token || !chatId) return;

  const icon = finding.severity === "critical" ? "🚨" : "⚠️";
  const text =
    `${icon} *Meta-Agent Alert* [${finding.severity.toUpperCase()}]\n\n` +
    `*Check:* ${finding.checkType}\n` +
    `*Summary:* ${finding.summary.slice(0, 300)}\n` +
    `*Confidence:* ${Math.round(finding.confidence * 100)}%`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.warn("[MetaAgent] Telegram send failed:", res.status, await res.text());
    }
  } catch (err) {
    console.warn("[MetaAgent] Telegram fetch error:", err);
  }
}

// ─── Main Router ──────────────────────────────────────────────────────────────

/**
 * Routes a single finding: persists it, then dispatches notifications
 * according to severity and deduplication rules.
 */
export async function routeFinding(finding: MetaFinding): Promise<void> {
  const { checkType, severity, summary } = finding;

  if (severity === "info") {
    console.log(`[MetaAgent] ℹ️  [${checkType}] ${summary}`);
    await persistFinding({ ...finding, actionTaken: "ok" });
    return;
  }

  const alreadyAlerted = await isRecentlyAlerted(checkType, severity);
  if (alreadyAlerted) {
    console.log(`[MetaAgent] ⏭️  [${checkType}] Deduped — already alerted within 24h`);
    return;
  }

  if (severity === "warning") {
    console.warn(`[MetaAgent] ⚠️  [${checkType}] ${summary}`);
    await persistFinding({ ...finding, actionTaken: "alerted" });
    // Owner notification (non-blocking)
    notifyOwner({
      title: `⚠️ Meta-Agent Warning: ${checkType}`,
      content: summary,
    }).catch(() => { /* non-fatal */ });
    return;
  }

  if (severity === "critical") {
    console.error(`[MetaAgent] 🚨 [${checkType}] ${summary}`);
    await persistFinding({ ...finding, actionTaken: "escalated" });
    // Immediate owner notification
    await notifyOwner({
      title: `🚨 Meta-Agent Critical: ${checkType}`,
      content: `${summary}\n\nDetails: ${JSON.stringify(finding.details, null, 2).slice(0, 500)}`,
    }).catch(() => { /* non-fatal */ });
    // Telegram for critical
    await sendTelegramMetaAlert(finding);
  }
}

/**
 * Routes a batch of findings, respecting deduplication per finding.
 */
export async function routeFindings(findings: MetaFinding[]): Promise<void> {
  // Process sequentially to avoid hammering the notification API
  for (const finding of findings) {
    await routeFinding(finding);
  }
}

// ─── Converters ───────────────────────────────────────────────────────────────

export function driftFindingToMetaFinding(df: DriftFinding): MetaFinding {
  return {
    checkType: df.checkType,
    severity: df.severity,
    confidence: df.confidence,
    summary: df.summary,
    details: df.details,
  };
}

export function invariantResultToMetaFinding(ir: InvariantResult): MetaFinding {
  return {
    checkType: `pipeline.${ir.name}`,
    severity: ir.severity,
    confidence: 0.95,
    summary: `[${ir.status.toUpperCase()}] ${ir.name}: ${ir.actual} (threshold: ${ir.threshold})`,
    details: ir.details,
  };
}
