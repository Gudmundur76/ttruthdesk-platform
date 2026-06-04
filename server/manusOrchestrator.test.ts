/**
 * manusOrchestrator.test.ts
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Mock ENV before importing the module under test
vi.mock("./_core/env", () => ({
  ENV: {
    manusApiKey: "test-manus-key",
    coordApiKey: "test-coord-key",
    appUrl: "http://localhost:3000",
  },
}));

import {
  buildVerticalAgentPrompt,
  spawnVerticalTask,
  getManusTaskStatus,
  stopManusTask,
  runOrchestratorTick,
  type SpawnTaskOptions,
} from "./manusOrchestrator";

function makeFetch(responses: Array<{ ok: boolean; body: unknown }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const resp = responses[callIndex++] ?? { ok: true, body: { ok: true } };
    return {
      ok: resp.ok,
      status: resp.ok ? 200 : 400,
      json: async () => resp.body,
    };
  });
}

// ─── buildVerticalAgentPrompt ─────────────────────────────────────────────────

describe("buildVerticalAgentPrompt", () => {
  it("includes the task ID and vertical in the prompt", () => {
    const prompt = buildVerticalAgentPrompt({
      taskId: "task-abc123",
      vertical: "protein-supplement",
      coordBaseUrl: "https://example.com",
      coordApiKey: "secret-key",
    });
    expect(prompt).toContain("task-abc123");
    expect(prompt).toContain("protein-supplement");
  });

  it("includes the coord base URL and auth header", () => {
    const prompt = buildVerticalAgentPrompt({
      taskId: "task-xyz",
      vertical: "creatine",
      coordBaseUrl: "https://app.example.com",
      coordApiKey: "my-secret",
    });
    expect(prompt).toContain("https://app.example.com/api/coord");
    expect(prompt).toContain("X-Coord-Key: my-secret");
  });

  it("includes the ingest endpoint in the workflow", () => {
    const prompt = buildVerticalAgentPrompt({
      taskId: "task-1",
      vertical: "omega3",
      coordBaseUrl: "https://example.com",
      coordApiKey: "key",
    });
    expect(prompt).toContain("/api/coord/ingest");
    expect(prompt).toContain("queueItemId");
  });

  it("respects the maxItems parameter", () => {
    const prompt = buildVerticalAgentPrompt({
      taskId: "task-1",
      vertical: "omega3",
      coordBaseUrl: "https://example.com",
      coordApiKey: "key",
      maxItems: 5,
    });
    expect(prompt).toContain("5 items");
  });

  it("defaults to 20 items when maxItems is not provided", () => {
    const prompt = buildVerticalAgentPrompt({
      taskId: "task-1",
      vertical: "omega3",
      coordBaseUrl: "https://example.com",
      coordApiKey: "key",
    });
    expect(prompt).toContain("20 items");
  });

  it("includes error handling instructions for queue/fail and tasks/fail", () => {
    const prompt = buildVerticalAgentPrompt({
      taskId: "task-1",
      vertical: "omega3",
      coordBaseUrl: "https://example.com",
      coordApiKey: "key",
    });
    expect(prompt).toContain("/api/coord/queue/fail");
    expect(prompt).toContain("/api/coord/tasks/fail");
  });

  it("tells the agent to register itself first", () => {
    const prompt = buildVerticalAgentPrompt({
      taskId: "task-reg",
      vertical: "zinc",
      coordBaseUrl: "https://example.com",
      coordApiKey: "key",
    });
    expect(prompt).toContain("/api/coord/tasks/register");
  });
});

// ─── spawnVerticalTask ────────────────────────────────────────────────────────

describe("spawnVerticalTask", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns ok:true and manusTaskId on success", async () => {
    const mockFetch = makeFetch([
      { ok: true, body: { ok: true, task_id: "manus-task-001", task_url: "https://manus.ai/tasks/manus-task-001" } },
      { ok: true, body: { ok: true } },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    const opts: SpawnTaskOptions = {
      taskId: "task-abc",
      vertical: "protein-supplement",
      prompt: "Process papers",
    };
    const result = await spawnVerticalTask(opts);

    expect(result.ok).toBe(true);
    expect(result.manusTaskId).toBe("manus-task-001");
    expect(result.taskUrl).toBe("https://manus.ai/tasks/manus-task-001");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns ok:false when Manus API call fails", async () => {
    const mockFetch = makeFetch([
      { ok: false, body: { ok: false, message: "Unauthorized" } },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    const result = await spawnVerticalTask({
      taskId: "task-fail",
      vertical: "creatine",
      prompt: "Process papers",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("sends the correct x-manus-api-key header", async () => {
    const mockFetch = makeFetch([
      { ok: true, body: { ok: true, task_id: "t-001", task_url: "https://manus.ai/t/t-001" } },
      { ok: true, body: { ok: true } },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    await spawnVerticalTask({ taskId: "task-header", vertical: "vitamin-d", prompt: "Process papers" });

    const firstCall = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    const headers = firstCall[1].headers as Record<string, string>;
    expect(headers["x-manus-api-key"]).toBe("test-manus-key");
  });

  it("includes AbortSignal.timeout in the Manus API fetch call", async () => {
    const mockFetch = makeFetch([
      { ok: true, body: { ok: true, task_id: "t-002", task_url: "https://manus.ai/t/t-002" } },
      { ok: true, body: { ok: true } },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    await spawnVerticalTask({ taskId: "task-signal", vertical: "magnesium", prompt: "Process papers" });

    const firstCall = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstCall[1].signal).toBeDefined();
  });

  it("calls the Manus v2/task.create endpoint", async () => {
    const mockFetch = makeFetch([
      { ok: true, body: { ok: true, task_id: "t-003", task_url: "https://manus.ai/t/t-003" } },
      { ok: true, body: { ok: true } },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    await spawnVerticalTask({ taskId: "task-url-check", vertical: "iron", prompt: "Process papers" });

    const firstCall = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstCall[0]).toContain("/v2/task.create");
  });
});

// ─── getManusTaskStatus ───────────────────────────────────────────────────────

describe("getManusTaskStatus", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns task status on success", async () => {
    const mockFetch = makeFetch([
      { ok: true, body: { ok: true, task: { id: "manus-task-001", status: "running", title: "Test task" } } },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    const status = await getManusTaskStatus("manus-task-001");

    expect(status).not.toBeNull();
    expect(status?.id).toBe("manus-task-001");
    expect(status?.status).toBe("running");
  });

  it("returns null when Manus API call fails", async () => {
    const mockFetch = makeFetch([
      { ok: false, body: { ok: false, message: "Not found" } },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    const status = await getManusTaskStatus("nonexistent-task");
    expect(status).toBeNull();
  });

  it("calls the correct Manus task.detail endpoint with encoded task ID", async () => {
    const mockFetch = makeFetch([
      { ok: true, body: { ok: true, task: { id: "manus-task-001", status: "completed" } } },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    await getManusTaskStatus("manus-task-001");

    const firstCall = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstCall[0]).toContain("/v2/task.detail");
    expect(firstCall[0]).toContain("manus-task-001");
  });
});

// ─── stopManusTask ────────────────────────────────────────────────────────────

describe("stopManusTask", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns true on successful stop", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: true, body: { ok: true } }]));
    expect(await stopManusTask("manus-task-001")).toBe(true);
  });

  it("returns false when the stop call fails", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: false, body: { ok: false, message: "Task not found" } }]));
    expect(await stopManusTask("nonexistent")).toBe(false);
  });

  it("sends task_id in the request body", async () => {
    const mockFetch = makeFetch([{ ok: true, body: { ok: true } }]);
    vi.stubGlobal("fetch", mockFetch);

    await stopManusTask("manus-task-xyz");

    const firstCall = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(firstCall[1].body as string) as Record<string, unknown>;
    expect(body.task_id).toBe("manus-task-xyz");
  });
});

// ─── runOrchestratorTick ──────────────────────────────────────────────────────

describe("runOrchestratorTick", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns error summary when coord /tasks returns ok:false", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: true, body: { ok: false, error: "Unauthorized" } }]));

    const summary = await runOrchestratorTick();

    expect(summary.checked).toBe(0);
    expect(summary.errors.length).toBeGreaterThan(0);
  });

  it("returns zero stalled/synced when all tasks are healthy (recent heartbeat)", async () => {
    const recentHeartbeat = new Date(Date.now() - 60_000).toISOString();
    vi.stubGlobal("fetch", makeFetch([
      { ok: true, body: { ok: true, tasks: [
        { taskId: "task-healthy", manusTaskId: "manus-001", status: "running", lastHeartbeatAt: recentHeartbeat, vertical: "protein-supplement", retryCount: 0 },
      ]}},
    ]));

    const summary = await runOrchestratorTick();

    expect(summary.checked).toBe(1);
    expect(summary.stalled).toBe(0);
    expect(summary.synced).toBe(0);
  });

  it("syncs a stalled task that Manus reports as completed", async () => {
    const staleHeartbeat = new Date(Date.now() - 15 * 60_000).toISOString();
    vi.stubGlobal("fetch", makeFetch([
      { ok: true, body: { ok: true, tasks: [
        { taskId: "task-stalled", manusTaskId: "manus-stalled-001", status: "running", lastHeartbeatAt: staleHeartbeat, vertical: "creatine", retryCount: 0 },
      ]}},
      { ok: true, body: { ok: true, task: { id: "manus-stalled-001", status: "completed" } } },
      { ok: true, body: { ok: true } }, // POST /tasks/complete
    ]));

    const summary = await runOrchestratorTick();

    expect(summary.checked).toBe(1);
    expect(summary.stalled).toBe(1);
    expect(summary.synced).toBe(1);
    expect(summary.errors).toHaveLength(0);
  });

  it("syncs a stalled task that Manus reports as failed", async () => {
    const staleHeartbeat = new Date(Date.now() - 15 * 60_000).toISOString();
    vi.stubGlobal("fetch", makeFetch([
      { ok: true, body: { ok: true, tasks: [
        { taskId: "task-failed", manusTaskId: "manus-failed-001", status: "running", lastHeartbeatAt: staleHeartbeat, vertical: "omega3", retryCount: 0 },
      ]}},
      { ok: true, body: { ok: true, task: { id: "manus-failed-001", status: "failed" } } },
      { ok: true, body: { ok: true } }, // POST /tasks/fail
    ]));

    const summary = await runOrchestratorTick();

    expect(summary.checked).toBe(1);
    expect(summary.stalled).toBe(1);
    expect(summary.synced).toBe(1);
  });

  it("retries a stalled task when Manus reports running but no callback", async () => {
    const staleHeartbeat = new Date(Date.now() - 15 * 60_000).toISOString();
    vi.stubGlobal("fetch", makeFetch([
      { ok: true, body: { ok: true, tasks: [
        { taskId: "task-no-callback", manusTaskId: "manus-no-callback-001", status: "running", lastHeartbeatAt: staleHeartbeat, vertical: "vitamin-d", retryCount: 0 },
      ]}},
      { ok: true, body: { ok: true, task: { id: "manus-no-callback-001", status: "running" } } },
      { ok: true, body: { ok: true } }, // POST /tasks/heartbeat
      { ok: true, body: { ok: true } }, // POST Manus task.stop
      { ok: true, body: { ok: true } }, // POST /tasks/fail
    ]));

    const summary = await runOrchestratorTick();

    expect(summary.checked).toBe(1);
    expect(summary.stalled).toBe(1);
    expect(summary.retried).toBe(1);
  });

  it("does not retry when retryCount has reached MAX_RETRIES (3)", async () => {
    const staleHeartbeat = new Date(Date.now() - 15 * 60_000).toISOString();
    const mockFetch = makeFetch([
      { ok: true, body: { ok: true, tasks: [
        { taskId: "task-exhausted", manusTaskId: "manus-exhausted-001", status: "running", lastHeartbeatAt: staleHeartbeat, vertical: "magnesium", retryCount: 3 },
      ]}},
      { ok: true, body: { ok: true, task: { id: "manus-exhausted-001", status: "running" } } },
      { ok: true, body: { ok: true } }, // POST /tasks/heartbeat only
    ]);
    vi.stubGlobal("fetch", mockFetch);

    const summary = await runOrchestratorTick();

    expect(summary.retried).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("summary has the correct shape", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: true, body: { ok: true, tasks: [] } }]));

    const summary = await runOrchestratorTick();

    expect(typeof summary.checked).toBe("number");
    expect(typeof summary.stalled).toBe("number");
    expect(typeof summary.synced).toBe("number");
    expect(typeof summary.retried).toBe("number");
    expect(Array.isArray(summary.errors)).toBe(true);
  });
});
