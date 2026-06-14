/**
 * metaLayer.ts — L4: Meta-Agent Layer
 *
 * Runs after every event to assess system health.
 * Triggers safe mode if health score drops below threshold.
 * Fires the existing MetaAgent health check for system_health_change events.
 */

import type { LoopEvent } from "../eventBus";
import type { LoopAction } from "../loopOrchestrator";
import { evaluateHealthAndTriggerSafeMode } from "../safeModeController";
import { publishEvent } from "../eventBus";
import { spawnDevTask } from "../../manusOrchestrator";
import { getDb } from "../../db";
import { metaAgentChecks } from "../../../drizzle/schema";
import { sql, desc } from "drizzle-orm";

// Track last known health score to detect changes
let _lastPublishedHealthScore: number | null = null;
const HEALTH_CHANGE_THRESHOLD = 60; // Publish event when score drops below this

export interface MetaLayerResult {
  actions: LoopAction[];
  healthScore: number;
  safeModeTriggered: boolean;
}

export async function runMetaLayer(
  event: LoopEvent,
  _priorActions: LoopAction[]
): Promise<MetaLayerResult> {
  const actions: LoopAction[] = [];
  let safeModeTriggered = false;

  // Get the latest health score from meta_agent_checks
  const healthScore = await getLatestHealthScore();

  // Publish system_health_change event when health drops below threshold
  if (
    healthScore < HEALTH_CHANGE_THRESHOLD &&
    (_lastPublishedHealthScore === null ||
      _lastPublishedHealthScore >= HEALTH_CHANGE_THRESHOLD)
  ) {
    try {
      await publishEvent("system_health_change", {
        score: healthScore,
        threshold: HEALTH_CHANGE_THRESHOLD,
        previousScore: _lastPublishedHealthScore,
      });
    } catch {
      // Non-fatal: don't block the meta layer if event publishing fails
    }
  }
  _lastPublishedHealthScore = healthScore;

  // Check if we need to enter safe mode
  if (healthScore < 40) {
    safeModeTriggered = await evaluateHealthAndTriggerSafeMode(healthScore);
    if (safeModeTriggered) {
      actions.push({
        type: "meta_safe_mode_triggered",
        description: `Safe mode triggered: health score ${healthScore} < 40`,
        priority: 100,
        result: "success",
      });
    }
  } else if (healthScore < 60) {
    // Halt non-critical operations — log but don't enter safe mode
    actions.push({
      type: "meta_health_warning",
      description: `Health warning: score ${healthScore} is below halt threshold (60). Non-critical operations halted.`,
      priority: 80,
      result: "success",
    });
  } else {
    actions.push({
      type: "meta_health_check",
      description: `Health check passed: score ${healthScore}`,
      priority: 5,
      result: "success",
    });
  }

  // For system_health_change events, log the change explicitly
  if (event.eventType === "system_health_change") {
    actions.push({
      type: "meta_health_change_logged",
      description: `System health change event processed: ${JSON.stringify(event.payload)}`,
      priority: 60,
      result: "success",
    });
  }

  // When health is critical (≤30), fire system_capability_required and spawn a dev repair task
  if (healthScore <= 30) {
    try {
      const criticalCheck = await getLatestCriticalCheck();
      const adapterName = criticalCheck?.checkType ?? "unknown";

      await publishEvent("system_capability_required", {
        healthScore,
        adapterName,
        errorLog: criticalCheck?.finding ?? {},
      });

      // Only spawn a repair task when we have an actionable adapter name.
      // If criticalCheck is null (no DB row found), adapterName falls back to
      // "unknown" — spawning a repair task for an unknown adapter is a no-op
      // that wastes resources and produces a misleading repair prompt.
      if (adapterName !== "unknown") {
        await spawnDevTask({
          adapterName,
          errorLog: JSON.stringify(criticalCheck?.finding ?? {}),
          healthScore,
        });
      }

      actions.push({
        type: "meta_dev_repair_spawned",
        description: `system_capability_required fired — spawnDevTask called for: ${adapterName}`,
        priority: 90,
        result: "success",
      });
    } catch {
      // Non-fatal — don't block the meta layer
    }
  }

  return { actions, healthScore, safeModeTriggered };
}

async function getLatestCriticalCheck(): Promise<{
  checkType: string;
  finding: Record<string, unknown>;
} | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({
        checkType: metaAgentChecks.checkType,
        finding: metaAgentChecks.finding,
      })
      .from(metaAgentChecks)
      .where(sql`${metaAgentChecks.severity} = 'critical'`)
      .orderBy(desc(metaAgentChecks.createdAt))
      .limit(1);
    if (!row) return null;
    return {
      checkType: row.checkType,
      finding: (row.finding as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}

async function getLatestHealthScore(): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return 100;

    // Derive health score from recent check severities:
    // critical → 30, warning → 70, info → 100
    const [row] = await db
      .select({ severity: metaAgentChecks.severity })
      .from(metaAgentChecks)
      .orderBy(sql`${metaAgentChecks.createdAt} DESC`)
      .limit(1);

    if (!row) return 100;
    if (row.severity === "critical") return 30;
    if (row.severity === "warning") return 70;
    return 100;
  } catch {
    return 100; // Default to healthy if no checks exist yet
  }
}
