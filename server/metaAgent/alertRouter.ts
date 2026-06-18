/**
 * alertRouter.ts — Meta-Agent Alert Routing Layer
 *
 * Routes meta-agent findings to the appropriate notification channel:
 *   - "info"     → log.info only
 *   - "warning"  → log.warn + owner notification (batched)
 *   - "critical" → log.error + immediate owner notification + Telegram
 *
 * Deduplicates alerts within a 24-hour window so the same finding
 * doesn't spam the owner on every swarm tick.
 *
 * build1_foundation Phase 138 upgrades:
 *   - Deduplication now uses meta_agent_alerts.dedupeKey (deterministic hash)
 *     instead of querying metaAgentChecks. This gives a stable, auditable
 *     dedup trail that survives schema changes to meta_agent_checks.
 *   - persistAlert() writes to meta_agent_alerts (new table) in addition to
 *     metaAgentChecks (legacy table, kept for backward compat).
 *   - routeFinding() returns the meta_agent_alerts.id for telemetry wiring.
 */

import { getDb } from "../db";
import { metaAgentChecks, metaAgentAlerts } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { ENV } from "../_core/env";
import type { DriftFinding } from "./codeDriftService";
import type { InvariantResult } from "./pipelineGuardian";
import { gt, eq, and } from "drizzle-orm";
import { logger, errData } from "../logger";
const log = logger("metaAgent/alertRouter");


export type AlertSeverity = "info" | "warning" | "critical";

/**
 * FrictionEngine-structured assumption entry.
 * Each finding exposes the hidden premise it detected and the test
 * that would disprove it — mirroring FrictionEngine's cognitive schema.
 */
export interface FrictionAssumption {
  statement: string;
  type: "technical" | "epistemic" | "pipeline" | "security";
  risk: "low" | "medium" | "high" | "critical";
  test: string;
}

export interface MetaFinding {
  checkType: string;
  severity: AlertSeverity;
  confidence: number;
  summary: string;
  details: Record<string, unknown>;
  actionTaken?: "ok" | "alerted" | "queuedFix" | "autoResolved" | "escalated";
  assumptions?: FrictionAssumption[];
  recommended_action?: "ok" | "alerted" | "queuedFix" | "autoResolved" | "escalated" | "investigate";
}

// ─── Deduplication ────────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Build a deterministic deduplication key for a finding.
 * Format: "checkType:severity" — stable across restarts.
 */
export function buildDedupeKey(checkType: string, severity: AlertSeverity): string {
  return `${checkType}:${severity}`;
}

/**
 * Returns true if this dedupeKey was already dispatched within the dedup window.
 * Uses meta_agent_alerts.dedupeKey for a stable, auditable dedup trail.
 */
async function isRecentlyAlerted(checkType: string, severity: AlertSeverity): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const dedupeKey = buildDedupeKey(checkType, severity);
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
  try {
    const recent = await db
      .select({ id: metaAgentAlerts.id })
      .from(metaAgentAlerts)
      .where(
        and(
          eq(metaAgentAlerts.dedupeKey, dedupeKey),
          gt(metaAgentAlerts.dispatchedAt, cutoff)
        )
      )
      .limit(1);
    return recent.length > 0;
  } catch {
    // Fall back to legacy metaAgentChecks query if meta_agent_alerts is unavailable
    try {
      const cutoffLegacy = new Date(Date.now() - DEDUP_WINDOW_MS);
      const recent = await db
        .select({ id: metaAgentChecks.id })
        .from(metaAgentChecks)
        .where(
          and(
            eq(metaAgentChecks.checkType, checkType),
            eq(metaAgentChecks.severity, severity),
            eq(metaAgentChecks.actionTaken, "alerted"),
            gt(metaAgentChecks.createdAt, cutoffLegacy)
          )
        )
        .limit(1);
      return recent.length > 0;
    } catch {
      return false;
    }
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * Persist a finding to the legacy meta_agent_checks table.
 * Kept for backward compatibility with existing dashboards and queries.
 */
export async function persistFinding(finding: MetaFinding): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const enrichedDetails: Record<string, unknown> = {
      ...finding.details,
      ...(finding.assumptions ? { friction_assumptions: finding.assumptions } : {}),
      ...(finding.recommended_action ? { friction_recommended_action: finding.recommended_action } : {}),
    };
    const result = await db.insert(metaAgentChecks).values({
      agentName: "codeGuardianAgent",
      checkType: finding.checkType,
      finding: enrichedDetails,
      actionTaken: finding.actionTaken ?? "ok",
      severity: finding.severity,
      confidence: finding.confidence,
    });
    return (result as unknown as { insertId: number }).insertId ?? null;
  } catch (err) {
    log.error("[MetaAgent] Failed to persist finding:", errData(err));
    return null;
  }
}

/**
 * Persist an alert to the new meta_agent_alerts table (build1_foundation).
 * Returns the inserted alert ID, or null on failure.
 */
export async function persistAlert(
  finding: MetaFinding,
  checkId: number | null,
  handlerName: string
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const dedupeKey = buildDedupeKey(finding.checkType, finding.severity);
  try {
    const enrichedPayload: Record<string, unknown> = {
      summary: finding.summary,
      confidence: finding.confidence,
      actionTaken: finding.actionTaken ?? "ok",
      ...finding.details,
      ...(finding.assumptions ? { friction_assumptions: finding.assumptions } : {}),
      ...(finding.recommended_action ? { friction_recommended_action: finding.recommended_action } : {}),
    };
    const result = await db.insert(metaAgentAlerts).values({
      checkId: checkId ?? undefined,
      severity: finding.severity,
      handlerName,
      payload: enrichedPayload,
      dedupeKey,
      acknowledged: false,
    });
    return (result as unknown as { insertId: number }).insertId ?? null;
  } catch (err) {
    log.error("[MetaAgent] Failed to persist alert:", errData(err));
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
      log.warn("[MetaAgent] Telegram send failed:", { status: String(res.status), body: await res.text() });
    }
  } catch (err) {
    log.warn("[MetaAgent] Telegram fetch error:", errData(err));
  }
}

// ─── Main Router ──────────────────────────────────────────────────────────────

/**
 * Routes a single finding: persists it to both tables, then dispatches
 * notifications according to severity and deduplication rules.
 *
 * @returns The meta_agent_alerts.id of the persisted alert, or null if deduped/info.
 */
export async function routeFinding(finding: MetaFinding): Promise<number | null> {
  const { checkType, severity, summary } = finding;

  if (severity === "info") {
    log.info(`[MetaAgent] ℹ️  [${checkType}] ${summary}`);
    const checkId = await persistFinding({ ...finding, actionTaken: "ok" });
    await persistAlert({ ...finding, actionTaken: "ok" }, checkId, "info_logger");
    return null;
  }

  const alreadyAlerted = await isRecentlyAlerted(checkType, severity);
  if (alreadyAlerted) {
    log.info(`[MetaAgent] ⏭️  [${checkType}] Deduped — already alerted within 24h`);
    return null;
  }

  if (severity === "warning") {
    log.warn(`[MetaAgent] ⚠️  [${checkType}] ${summary}`);
    const checkId = await persistFinding({ ...finding, actionTaken: "alerted" });
    const alertId = await persistAlert({ ...finding, actionTaken: "alerted" }, checkId, "owner_notifier");
    // Owner notification (non-blocking)
    notifyOwner({
      title: `⚠️ Meta-Agent Warning: ${checkType}`,
      content: summary,
    }).catch(() => { /* non-fatal */ });
    return alertId;
  }

  if (severity === "critical") {
    log.error(`[MetaAgent] 🚨 [${checkType}] ${summary}`);
    const checkId = await persistFinding({ ...finding, actionTaken: "escalated" });
    const alertId = await persistAlert({ ...finding, actionTaken: "escalated" }, checkId, "critical_escalator");
    // Immediate owner notification
    await notifyOwner({
      title: `🚨 Meta-Agent Critical: ${checkType}`,
      content: `${summary}\n\nDetails: ${JSON.stringify(finding.details, null, 2).slice(0, 500)}`,
    }).catch(() => { /* non-fatal */ });
    // Telegram for critical
    await sendTelegramMetaAlert(finding);
    return alertId;
  }

  return null;
}

/**
 * Routes a batch of findings, respecting deduplication per finding.
 * Returns an array of alert IDs (null for deduped/info findings).
 */
export async function routeFindings(findings: MetaFinding[]): Promise<(number | null)[]> {
  // Process sequentially to avoid hammering the notification API
  const results: (number | null)[] = [];
  for (const finding of findings) {
    results.push(await routeFinding(finding));
  }
  return results;
}

// ─── Converters ───────────────────────────────────────────────────────────────

export function driftFindingToMetaFinding(df: DriftFinding): MetaFinding {
  const assumption: FrictionAssumption = {
    statement: `This assumes the codebase is free of ${df.checkType} drift`,
    type: "technical",
    risk: df.severity === "critical" ? "critical" : df.severity === "warning" ? "high" : "medium",
    test: `Re-run drift check after resolving: ${df.checkType}`,
  };
  return {
    checkType: df.checkType,
    severity: df.severity,
    confidence: df.confidence,
    summary: df.summary,
    details: df.details,
    assumptions: [assumption],
    recommended_action: df.severity === "critical" ? "escalated" : df.severity === "warning" ? "alerted" : "ok",
  };
}

export function invariantResultToMetaFinding(ir: InvariantResult): MetaFinding {
  const assumption: FrictionAssumption = {
    statement: `This assumes ${ir.name} stays within threshold (${ir.threshold})`,
    type: "pipeline",
    risk: ir.severity === "critical" ? "critical" : ir.severity === "warning" ? "high" : "low",
    test: `Verify ${ir.name}: actual=${ir.actual}, threshold=${ir.threshold}`,
  };
  return {
    checkType: `pipeline.${ir.name}`,
    severity: ir.severity,
    confidence: 0.95,
    summary: `[${ir.status.toUpperCase()}] ${ir.name}: ${ir.actual} (threshold: ${ir.threshold})`,
    details: ir.details,
    assumptions: [assumption],
    recommended_action: ir.status === "fail" ? "alerted" : ir.status === "warn" ? "investigate" : "ok",
  };
}
