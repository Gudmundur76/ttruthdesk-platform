/**
 * safeModeController.ts — Safe Mode management for the Autonomous Loop.
 *
 * Per the spec:
 *   IF health_score < 60: Halt non-critical operations, alert owner, log
 *   IF health_score < 40: Enter safe mode — only user-submitted claims,
 *                         no frontier generation, require human intervention
 */

import { getDb } from "../db";
import { loopConfig } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

export interface SafeModeStatus {
  active: boolean;
  reason?: string;
  triggeredAt?: Date;
}

/** Thresholds from the spec */
export const HALT_THRESHOLD = 60;
export const SAFE_MODE_THRESHOLD = 40;

export async function getSafeModeStatus(): Promise<SafeModeStatus> {
  const db = await getDb();
  if (!db) return { active: false };

  const [config] = await db.select().from(loopConfig).where(eq(loopConfig.id, 1));
  if (!config) return { active: false };

  return {
    active: config.safeMode,
    reason: config.safeModeReason ?? undefined,
    triggeredAt: config.safeModeTriggeredAt ?? undefined,
  };
}

export async function enterSafeMode(reason: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(loopConfig)
    .set({
      safeMode: true,
      safeModeReason: reason,
      safeModeTriggeredAt: new Date(),
    })
    .where(eq(loopConfig.id, 1));

  // Alert the owner
  await notifyOwner({
    title: "⚠️ Autonomous Loop: Safe Mode Activated",
    content: `The autonomous loop has entered safe mode.\n\nReason: ${reason}\n\nOnly user-submitted claims will be processed. Frontier generation is halted. Human intervention required before resuming autonomy.`,
  }).catch(() => {/* non-fatal */});
}

export async function exitSafeMode(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(loopConfig)
    .set({
      safeMode: false,
      safeModeReason: null,
      safeModeTriggeredAt: null,
    })
    .where(eq(loopConfig.id, 1));
}

/**
 * Evaluate health score and trigger safe mode if thresholds are breached.
 * Returns true if safe mode was triggered.
 */
export async function evaluateHealthAndTriggerSafeMode(
  healthScore: number
): Promise<boolean> {
  if (healthScore < SAFE_MODE_THRESHOLD) {
    const reason = `Health score ${healthScore} is below safe mode threshold (${SAFE_MODE_THRESHOLD})`;
    await enterSafeMode(reason);
    return true;
  }
  return false;
}
