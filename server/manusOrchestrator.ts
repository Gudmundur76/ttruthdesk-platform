/**
 * manusOrchestrator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Manus API Orchestrator for Truth Desk's Coordination Layer.
 *
 * Responsibilities:
 *  1. Spawn Manus tasks via the v2 task.create API.
 *  2. Monitor running tasks (heartbeat check, stall detection).
 *  3. Auto-restart failed/stalled tasks up to MAX_RETRIES.
 *  4. Register/deregister tasks in coord_tasks via the coord REST API.
 *  5. Expose a tRPC-compatible handler for admin-triggered spawning.
 *
 * Architecture:
 *  - All Manus API calls go through `manusApiCall()` — a thin fetch wrapper
 *    that adds the x-manus-api-key header and handles the ok/error envelope.
 *  - The orchestrator is stateless: all state lives in coord_tasks (DB).
 *  - Designed to be called from a scheduled heartbeat job (every 5 min).
 *
 * Environment variables required:
 *  - MANUS_API_KEY     — Manus platform API key (from API integration settings)
 *  - COORD_API_KEY     — shared secret for /api/coord/* endpoints
 *  - VITE_APP_URL      — base URL of this Truth Desk deployment (for coord API calls)
 *
 * Usage:
 *  import { spawnVerticalTask, runOrchestratorTick } from "./manusOrchestrator";
 *
 *  // Spawn a new task for a vertical
 *  const { manusTaskId } = await spawnVerticalTask({
 *    vertical: "protein-supplement",
 *    taskId: "task-abc123",
 *    prompt: "Process the next 20 PMC papers for protein-supplement vertical...",
 *  });
 *
 *  // Run in a scheduled job to detect stalls and restart tasks
 *  await runOrchestratorTick();
 */

import { ENV } from "./_core/env";

// ─── Constants ────────────────────────────────────────────────────────────────

const MANUS_API_BASE = "https://api.manus.ai";
const STALL_THRESHOLD_MS = 10 * 60_000; // 10 minutes without heartbeat = stalled
const MAX_RETRIES = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpawnTaskOptions {
  /** Internal task ID (used in coord_tasks) */
  taskId: string;
  /** Vertical identifier (e.g. "protein-supplement") */
  vertical: string;
  /** The prompt/instructions to send to the Manus agent */
  prompt: string;
  /** Optional Manus project ID for durable persona/instructions */
  projectId?: string;
  /** Optional title shown in Manus task list */
  title?: string;
  /** Whether to hide this task from the Manus task list UI */
  hideInTaskList?: boolean;
}

export interface SpawnTaskResult {
  ok: boolean;
  manusTaskId?: string;
  taskUrl?: string;
  error?: string;
}

export interface ManusTaskStatus {
  id: string;
  status: "running" | "completed" | "failed" | "stopped" | string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Manus API client ─────────────────────────────────────────────────────────

async function manusApiCall<T>(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const apiKey = ENV.manusApiKey;
  if (!apiKey) {
    return { ok: false, error: "MANUS_API_KEY not configured" };
  }

  try {
    const resp = await fetch(`${MANUS_API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-manus-api-key": apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await resp.json()) as Record<string, unknown>;

    if (!resp.ok || json.ok === false) {
      const errObj = json.error as Record<string, unknown> | undefined;
      const msg = errObj?.message ?? json.message ?? `HTTP ${resp.status}`;
      return { ok: false, error: String(msg) };
    }

    return { ok: true, data: json as T };
  } catch (err: unknown) {
    return { ok: false, error: String(err) };
  }
}

// ─── Coord API client (calls this server's own /api/coord/* endpoints) ────────

function getCoordBase(): string {
  return (process.env.VITE_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

async function coordCall(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: Record<string, unknown>
): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  const coordApiKey = process.env.COORD_API_KEY ?? "";
  if (!coordApiKey) {
    console.warn("[Orchestrator] COORD_API_KEY not set — coord calls disabled");
    return { ok: false, error: "COORD_API_KEY not set" };
  }

  try {
    const resp = await fetch(`${getCoordBase()}/api/coord${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-coord-key": coordApiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await resp.json()) as { ok: boolean; [key: string]: unknown };
  } catch (err: unknown) {
    return { ok: false, error: String(err) };
  }
}

// ─── Core orchestrator functions ──────────────────────────────────────────────

/**
 * Spawn a new Manus task for a given vertical and register it in coord_tasks.
 */
export async function spawnVerticalTask(
  opts: SpawnTaskOptions
): Promise<SpawnTaskResult> {
  const { taskId, vertical, prompt, projectId, title, hideInTaskList } = opts;

  console.log(
    `[Orchestrator] Spawning task ${taskId} for vertical "${vertical}"`
  );

  // Build the task.create payload
  const payload: Record<string, unknown> = {
    message: {
      content: prompt,
    },
    title: title ?? `Truth Desk — ${vertical} agent [${taskId}]`,
    hide_in_task_list: hideInTaskList ?? false,
  };
  if (projectId) payload.project_id = projectId;

  const result = await manusApiCall<{
    ok: boolean;
    task_id: string;
    task_url: string;
  }>("/v2/task.create", "POST", payload);

  if (!result.ok) {
    console.error(
      `[Orchestrator] Failed to spawn task ${taskId}: ${result.error}`
    );
    return { ok: false, error: result.error };
  }

  const manusTaskId = result.data.task_id;
  const taskUrl = result.data.task_url;

  // Register in coord_tasks
  await coordCall("/tasks/register", "POST", {
    taskId,
    vertical,
    phase: "spawned",
    manusTaskId,
    meta: { taskUrl, spawnedAt: new Date().toISOString() },
  });

  console.log(
    `[Orchestrator] Task ${taskId} spawned as Manus task ${manusTaskId}`
  );
  return { ok: true, manusTaskId, taskUrl };
}

/**
 * Check the status of a Manus task by its Manus task ID.
 */
export async function getManusTaskStatus(
  manusTaskId: string
): Promise<ManusTaskStatus | null> {
  const result = await manusApiCall<{
    ok: boolean;
    task: ManusTaskStatus;
  }>(`/v2/task.detail?task_id=${encodeURIComponent(manusTaskId)}`, "GET");

  if (!result.ok) {
    console.warn(
      `[Orchestrator] Could not fetch status for ${manusTaskId}: ${result.error}`
    );
    return null;
  }
  return result.data.task;
}

/**
 * Stop a running Manus task.
 */
export async function stopManusTask(manusTaskId: string): Promise<boolean> {
  const result = await manusApiCall<{ ok: boolean }>(
    "/v2/task.stop",
    "POST",
    { task_id: manusTaskId }
  );
  return result.ok;
}

/**
 * runOrchestratorTick — called from a scheduled job every 5 minutes.
 *
 * Workflow:
 *  1. Fetch all running/pending coord_tasks from the coord API.
 *  2. For each task, check if it has a heartbeat within STALL_THRESHOLD_MS.
 *  3. If stalled, check its Manus task status:
 *     - If Manus reports "completed" or "failed", sync the coord_tasks status.
 *     - If Manus reports "running" but Truth Desk hasn't seen a heartbeat,
 *       mark as stalled (the Manus task is still running but not calling back).
 *  4. Return a summary for logging.
 */
export async function runOrchestratorTick(): Promise<{
  checked: number;
  stalled: number;
  synced: number;
  errors: string[];
}> {
  const summary = { checked: 0, stalled: 0, synced: 0, errors: [] as string[] };

  const tasksResp = await coordCall("/tasks", "GET");
  if (!tasksResp.ok) {
    summary.errors.push(`Failed to fetch tasks: ${tasksResp.error}`);
    return summary;
  }

  const tasks = (tasksResp.tasks ?? []) as Array<{
    taskId: string;
    manusTaskId: string | null;
    status: string;
    lastHeartbeatAt: string;
    vertical: string;
  }>;

  for (const task of tasks) {
    summary.checked++;

    const lastBeat = new Date(task.lastHeartbeatAt).getTime();
    const isStale = Date.now() - lastBeat > STALL_THRESHOLD_MS;

    if (!isStale) continue; // Healthy task — skip

    summary.stalled++;
    console.log(
      `[Orchestrator] Task ${task.taskId} (${task.vertical}) is stale — checking Manus status`
    );

    if (!task.manusTaskId) {
      // No Manus task ID — mark as failed
      await coordCall("/tasks/fail", "POST", {
        taskId: task.taskId,
        errorMsg: "Stalled: no Manus task ID registered",
      });
      summary.synced++;
      continue;
    }

    const manusStatus = await getManusTaskStatus(task.manusTaskId);
    if (!manusStatus) {
      summary.errors.push(
        `Could not fetch Manus status for ${task.manusTaskId}`
      );
      continue;
    }

    if (manusStatus.status === "completed") {
      await coordCall("/tasks/complete", "POST", { taskId: task.taskId });
      console.log(
        `[Orchestrator] Task ${task.taskId} synced as completed from Manus`
      );
      summary.synced++;
    } else if (
      manusStatus.status === "failed" ||
      manusStatus.status === "stopped"
    ) {
      await coordCall("/tasks/fail", "POST", {
        taskId: task.taskId,
        errorMsg: `Manus task ${manusStatus.status}`,
      });
      console.log(
        `[Orchestrator] Task ${task.taskId} synced as failed from Manus (${manusStatus.status})`
      );
      summary.synced++;
    } else {
      // Manus says running but no heartbeat — mark as stalled in coord
      await coordCall("/tasks/heartbeat", "POST", {
        taskId: task.taskId,
        phase: "stalled-no-callback",
      });
      console.warn(
        `[Orchestrator] Task ${task.taskId} is stalled (Manus running, no callback)`
      );
    }
  }

  return summary;
}

/**
 * Build a standard coordination prompt for a vertical agent.
 * The agent is expected to:
 *  1. Call POST /api/coord/tasks/register to announce itself.
 *  2. Loop: POST /api/coord/queue/dequeue → process → POST /api/coord/queue/complete.
 *  3. POST /api/coord/tasks/heartbeat every ~2 min.
 *  4. POST /api/coord/tasks/complete when done.
 */
export function buildVerticalAgentPrompt(opts: {
  taskId: string;
  vertical: string;
  coordBaseUrl: string;
  coordApiKey: string;
  maxItems?: number;
}): string {
  const { taskId, vertical, coordBaseUrl, coordApiKey, maxItems = 20 } = opts;
  return `You are a Truth Desk vertical agent for the "${vertical}" research vertical.

Your job is to process papers from the coordination work queue and extract protein/supplement claims.

## Coordination API

Base URL: ${coordBaseUrl}/api/coord
Auth header: X-Coord-Key: ${coordApiKey}

## Your workflow

1. **Register yourself** (do this first):
   POST /api/coord/tasks/register
   Body: { "taskId": "${taskId}", "vertical": "${vertical}", "phase": "starting" }

2. **Process up to ${maxItems} items** in a loop:
   a. Dequeue next item:
      POST /api/coord/queue/dequeue
      Body: { "taskId": "${taskId}", "vertical": "${vertical}" }
      → If item is null, the queue is empty — skip to step 3.
   
   b. Process the paper (fetch abstract, extract claims, verify against known facts).
   
   c. Mark complete:
      POST /api/coord/queue/complete
      Body: { "itemId": <item.id>, "taskId": "${taskId}", "result": { "claims": [...] } }
   
   d. Send heartbeat every 2 minutes:
      POST /api/coord/tasks/heartbeat
      Body: { "taskId": "${taskId}", "phase": "processing", "workItemId": <item.id> }

3. **Mark yourself done**:
   POST /api/coord/tasks/complete
   Body: { "taskId": "${taskId}" }

## Error handling
- If processing a paper fails, call POST /api/coord/queue/fail with retry: true.
- If you encounter a fatal error, call POST /api/coord/tasks/fail with the error message.
- Always send a final heartbeat before stopping.

Start now. Register yourself and begin processing.`;
}
