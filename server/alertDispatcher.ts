/**
 * alertDispatcher.ts
 *
 * Dispatches high-risk claim alerts via two channels:
 *   1. Telegram (if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set)
 *   2. User-registered webhook URLs (HMAC-SHA256 signed POST)
 *
 * Called from analysisPipeline.ts when a claim's contradictionProbability >= 0.70.
 */

import crypto from "crypto";
import { getActiveWebhookAlerts, updateWebhookAlertLastFired } from "./db";
import { ENV } from "./_core/env";
import { logger, errData } from "./logger";
const log = logger("alertDispatcher");


export interface HighRiskClaimPayload {
  claimId: number;
  claimText: string;
  documentId: number;
  documentTitle: string;
  verdict: string;
  contradictionProbability: number;
  confidenceScore: number | null;
  reportUrl: string;
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function sendTelegramAlert(payload: HighRiskClaimPayload): Promise<void> {
  const token = ENV.telegramBotToken;
  const chatId = ENV.telegramChannelId;
  if (!token || !chatId) return;

  const pct = Math.round(payload.contradictionProbability * 100);
  const text =
    `⚠️ *High-Risk Claim Detected* (${pct}% contradiction probability)\n\n` +
    `*Claim:* ${escapeMarkdown(payload.claimText.slice(0, 300))}\n` +
    `*Verdict:* ${escapeMarkdown(payload.verdict)}\n` +
    `*Document:* ${escapeMarkdown(payload.documentTitle)}\n\n` +
    `[View Report](${payload.reportUrl})`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log.warn("[AlertDispatcher] Telegram send failed:", { status: String(res.status), body });
    }
  } catch (err) {
    log.warn("[AlertDispatcher] Telegram fetch error:", errData(err));
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

// ─── Webhook POST ─────────────────────────────────────────────────────────────

function buildHmacSignature(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

async function fireWebhook(
  webhookId: number,
  url: string,
  secret: string,
  payload: HighRiskClaimPayload
): Promise<boolean> {
  const body = JSON.stringify({
    event: "high_risk_claim",
    timestamp: new Date().toISOString(),
    data: payload,
  });
  const signature = buildHmacSignature(secret, body);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TruthDesk-Signature": `sha256=${signature}`,
        "X-TruthDesk-Event": "high_risk_claim",
        "User-Agent": "TruthDesk-Webhook/1.0",
      },
      body,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });
    if (!res.ok) {
      log.warn(`[AlertDispatcher] Webhook ${webhookId} returned ${res.status}`);
      return false;
    }
    await updateWebhookAlertLastFired(webhookId);
    return true;
  } catch (err) {
    log.warn(`[AlertDispatcher] Webhook ${webhookId} error:`, errData(err));
    return false;
  }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function dispatchHighRiskAlert(payload: HighRiskClaimPayload): Promise<void> {
  // Fire Telegram and webhooks concurrently
  const webhooks = await getActiveWebhookAlerts();

  const tasks: Promise<unknown>[] = [sendTelegramAlert(payload)];

  for (const wh of webhooks) {
    const eventTypes = Array.isArray(wh.eventTypes)
      ? (wh.eventTypes as string[])
      : [];
    if (eventTypes.length === 0 || eventTypes.includes("high_risk_claim")) {
      tasks.push(fireWebhook(wh.id, wh.url, wh.secret, payload));
    }
  }

  await Promise.allSettled(tasks);
}

// ─── Exported for testing ─────────────────────────────────────────────────────
export { buildHmacSignature, sendTelegramAlert, fireWebhook };
