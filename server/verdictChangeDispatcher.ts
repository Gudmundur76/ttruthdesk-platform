/**
 * verdictChangeDispatcher.ts — Sprint 0 Fix 2
 *
 * Fires webhook fan-out and publishes a loop event whenever a claim verdict
 * changes during re-evaluation.
 *
 * Separated from reEvaluationEngine.ts so both can be tested independently.
 */
import { getActiveWebhookAlerts, updateWebhookAlertLastFired } from "./db";
import { publishEvent } from "./autonomousLoop/eventBus";
import { buildHmacSignature } from "./alertDispatcher";
import { logger, errData } from "./logger";
const log = logger("verdictChangeDispatcher");

export interface VerdictChangedPayload {
  claimId: number;
  documentId: number;
  previousLabel: string | null;
  newLabel: string | null;
  previousScore: number | null;
  newScore: number | null;
}

/**
 * Fan-out to all active webhooks subscribed to "verdict_changed" events,
 * and publish a "verdict_complete" loop event so downstream layers can react.
 *
 * Non-fatal: individual webhook failures are logged but do not throw.
 */
export async function dispatchVerdictChanged(
  payload: VerdictChangedPayload
): Promise<void> {
  const body = JSON.stringify({
    event: "verdict_changed",
    timestamp: new Date().toISOString(),
    data: payload,
  });

  // ── 1. Webhook fan-out ────────────────────────────────────────────────────
  try {
    const webhooks = await getActiveWebhookAlerts();
    const tasks: Promise<void>[] = [];

    for (const wh of webhooks) {
      const eventTypes = Array.isArray(wh.eventTypes)
        ? (wh.eventTypes as string[])
        : [];
      if (eventTypes.length === 0 || eventTypes.includes("verdict_changed")) {
        tasks.push(
          (async () => {
            const signature = buildHmacSignature(wh.secret, body);
            try {
              const res = await fetch(wh.url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-TruthDesk-Signature": `sha256=${signature}`,
                  "X-TruthDesk-Event": "verdict_changed",
                  "User-Agent": "TruthDesk-Webhook/1.0",
                },
                body,
                signal: AbortSignal.timeout(10_000),
              });
              if (res.ok) {
                await updateWebhookAlertLastFired(wh.id);
              } else {
                log.warn(
                  `[VerdictDispatcher] Webhook ${wh.id} returned ${res.status}`
                );
              }
            } catch (err) {
              log.warn(
                `[VerdictDispatcher] Webhook ${wh.id} error:`,
                errData(err)
              );
            }
          })()
        );
      }
    }

    await Promise.allSettled(tasks);
  } catch (err) {
    log.warn("[VerdictDispatcher] Webhook fan-out error:", errData(err));
  }

  // ── 2. Publish loop event ─────────────────────────────────────────────────
  try {
    await publishEvent("verdict_complete", {
      claimId: payload.claimId,
      documentId: payload.documentId,
      previousLabel: payload.previousLabel,
      newLabel: payload.newLabel,
      previousScore: payload.previousScore,
      newScore: payload.newScore,
    });
  } catch (err) {
    log.warn("[VerdictDispatcher] publishEvent error:", errData(err));
  }
}
