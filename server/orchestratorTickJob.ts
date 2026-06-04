/**
 * orchestratorTickJob.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Heartbeat handler for the Manus Coordination Layer orchestrator.
 *
 * Registered at: POST /api/scheduled/orchestrator-tick
 * Suggested cron: every 5 minutes  →  "0 * /5 * * *"
 *
 * What this job does on each tick:
 *  1. Runs runOrchestratorTick() — syncs stalled/failed tasks with Manus API,
 *     marks them failed, and triggers retries up to MAX_RETRIES.
 *  2. For each vertical that has pending queue items but NO running task,
 *     spawns a new Manus agent task to process that vertical.
 *  3. Respects a per-vertical concurrency cap (default 2 tasks per vertical).
 *  4. Returns a structured JSON report for the Manus heartbeat platform.
 *
 * The handler is idempotent — running it twice in quick succession is safe
 * because task spawning checks for existing running tasks first.
 */
import type { Request, Response } from "express";
import { getDb } from "./db";
import {
  coordTasks,
  coordQueue,
} from "../drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  runOrchestratorTick,
  spawnVerticalTask,
  buildVerticalAgentPrompt,
} from "./manusOrchestrator";
import { VERTICAL_FEED_CONFIGS } from "./verticalFeedConfig";
import { ENV } from "./_core/env";
import crypto from "node:crypto";

// ─── Config ───────────────────────────────────────────────────────────────────

/** Max concurrent Manus tasks per vertical */
const MAX_TASKS_PER_VERTICAL = 2;

/** Max items each spawned agent should process before self-completing */
const AGENT_BATCH_SIZE = 25;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a map of vertical → count of running/pending tasks.
 */
async function getRunningTasksByVertical(): Promise<Map<string, number>> {
  const db = await getDb();
  if (!db) return new Map();
  const rows = await db
    .select({
      vertical: coordTasks.vertical,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(coordTasks)
    .where(inArray(coordTasks.status, ["pending", "running"]))
    .groupBy(coordTasks.vertical);

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.vertical, Number(row.count));
  }
  return map;
}

/**
 * Returns a map of vertical → count of pending queue items.
 */
async function getPendingQueueDepthByVertical(): Promise<Map<string, number>> {
  const db = await getDb();
  if (!db) return new Map();
  const rows = await db
    .select({
      vertical: coordQueue.vertical,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(coordQueue)
    .where(eq(coordQueue.status, "pending"))
    .groupBy(coordQueue.vertical);

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.vertical, Number(row.count));
  }
  return map;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export interface OrchestratorTickReport {
  ok: boolean;
  timestamp: string;
  orchestratorTick: {
    checked: number;
    stalled: number;
    synced: number;
    errors: string[];
  };
  verticals: Array<{
    vertical: string;
    pendingItems: number;
    runningTasks: number;
    spawned: boolean;
    spawnError?: string;
  }>;
  totalSpawned: number;
  totalSkipped: number;
}

export async function orchestratorTickHandler(
  req: Request,
  res: Response
): Promise<void> {
  const startMs = Date.now();

  try {
    // ── Step 1: Run the orchestrator tick (stall detection + retry) ───────────
    const tickResult = await runOrchestratorTick();

    // ── Step 2: Get current running task counts and queue depths ─────────────
    const [runningByVertical, pendingByVertical] = await Promise.all([
      getRunningTasksByVertical(),
      getPendingQueueDepthByVertical(),
    ]);

    // ── Step 3: Determine base URL for coord API calls ────────────────────────
    // Prefer the deployed domain; fall back to localhost for dev
    const envAny = ENV as unknown as Record<string, unknown>;
    const coordBaseUrl =
      (typeof envAny["VITE_APP_URL"] === "string" ? envAny["VITE_APP_URL"] : null) ??
      `http://localhost:${process.env.PORT ?? 3000}`;
    const coordApiKey = typeof envAny["COORD_API_KEY"] === "string" ? envAny["COORD_API_KEY"] : "";

    // ── Step 4: For each vertical, spawn a task if needed ────────────────────
    const verticalReports: OrchestratorTickReport["verticals"] = [];
    let totalSpawned = 0;
    let totalSkipped = 0;

    // Only consider verticals that have a feed config (i.e. are active)
    const activeVerticals = VERTICAL_FEED_CONFIGS.map((v) => v.domainKey);

    for (const domainKey of activeVerticals) {
      const pendingItems = pendingByVertical.get(domainKey) ?? 0;
      const runningTasks = runningByVertical.get(domainKey) ?? 0;

      // Skip if no work to do
      if (pendingItems === 0) {
        verticalReports.push({
          vertical: domainKey,
          pendingItems: 0,
          runningTasks,
          spawned: false,
        });
        totalSkipped++;
        continue;
      }

      // Skip if already at concurrency cap
      if (runningTasks >= MAX_TASKS_PER_VERTICAL) {
        verticalReports.push({
          vertical: domainKey,
          pendingItems,
          runningTasks,
          spawned: false,
        });
        totalSkipped++;
        continue;
      }

      // Spawn a new task for this vertical
      const taskId = `orch-${domainKey}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const prompt = buildVerticalAgentPrompt({
        taskId,
        vertical: domainKey,
        coordBaseUrl,
        coordApiKey,
        maxItems: AGENT_BATCH_SIZE,
      });

      try {
        const spawnResult = await spawnVerticalTask({
          taskId,
          vertical: domainKey,
          prompt,
          title: `Truth Desk — ${domainKey} agent (batch ${new Date().toISOString().slice(0, 10)})`,
        });

        if (spawnResult.ok) {
          verticalReports.push({
            vertical: domainKey,
            pendingItems,
            runningTasks: runningTasks + 1,
            spawned: true,
          });
          totalSpawned++;
        } else {
          verticalReports.push({
            vertical: domainKey,
            pendingItems,
            runningTasks,
            spawned: false,
            spawnError: spawnResult.error,
          });
          totalSkipped++;
        }
      } catch (spawnErr) {
        verticalReports.push({
          vertical: domainKey,
          pendingItems,
          runningTasks,
          spawned: false,
          spawnError: String(spawnErr),
        });
        totalSkipped++;
      }
    }

    // ── Step 5: Return structured report ─────────────────────────────────────
    const report: OrchestratorTickReport = {
      ok: true,
      timestamp: new Date().toISOString(),
      orchestratorTick: {
        checked: tickResult.checked,
        stalled: tickResult.stalled,
        synced: tickResult.synced,
        errors: tickResult.errors,
      },
      verticals: verticalReports,
      totalSpawned,
      totalSkipped,
    };

    console.log(
      `[OrchestratorTick] Done in ${Date.now() - startMs}ms — spawned=${totalSpawned} skipped=${totalSkipped} stalledSynced=${tickResult.stalled}`
    );

    res.json(report);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[OrchestratorTick] Fatal error:", error);
    res.status(500).json({
      ok: false,
      error,
      stack: err instanceof Error ? err.stack : undefined,
      context: { url: req.url, taskUid: (req as unknown as Record<string, unknown>)["taskUid"] },
      timestamp: new Date().toISOString(),
    });
  }
}
