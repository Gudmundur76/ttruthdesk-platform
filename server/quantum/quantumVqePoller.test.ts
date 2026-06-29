/**
 * quantumVqePoller.test.ts
 * Tests for runQuantumVqePoller() — heartbeat job that polls WuKong VQE jobs
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ── Mock child_process.spawn ──────────────────────────────────────────────────
let spawnMockFn: ReturnType<typeof vi.fn>;

vi.mock("child_process", async () => {
  const { EventEmitter } = await import("events");
  spawnMockFn = vi.fn();
  return { spawn: spawnMockFn };
});

// ── Mock DB ───────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));

// ── Mock ENV ──────────────────────────────────────────────────────────────────
vi.mock("../_core/env", () => ({
  ENV: { originqApiKey: "test-originq-key" },
}));

vi.mock("../../drizzle/schema", () => ({
  quantumVqeJobs: { id: "id", jobId: "jobId", status: "status", citationEdgeId: "citationEdgeId", backend: "backend" },
  citationEdges: { id: "id", quantumProvenance: "quantumProvenance" },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeMockProc(stdoutData: string, exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  setImmediate(() => {
    proc.stdout.emit("data", Buffer.from(stdoutData));
    proc.emit("close", exitCode);
  });
  return proc;
}

function makeDb() {
  const db: Record<string, unknown> = {};
  const updateChain: Record<string, unknown> = {};
  updateChain.set = vi.fn().mockReturnValue(updateChain);
  updateChain.where = vi.fn().mockResolvedValue({ affectedRows: 1 });
  db.update = vi.fn().mockReturnValue(updateChain);
  return { db, updateChain };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("runQuantumVqePoller()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { runQuantumVqePoller } = await import("./quantumVqePoller");
    const result = await runQuantumVqePoller();
    expect(result).toEqual({ polled: 0, upgraded: 0, failed: 0, pending: 0 });
  });

  it("returns zeros when no pending jobs exist", async () => {
    const { db } = makeDb();
    const selectChain: Record<string, unknown> = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockResolvedValue([]);
    db.select = vi.fn().mockReturnValue(selectChain);
    mocks.mockGetDb.mockResolvedValue(db);

    const { runQuantumVqePoller } = await import("./quantumVqePoller");
    const result = await runQuantumVqePoller();
    expect(result).toEqual({ polled: 0, upgraded: 0, failed: 0, pending: 0 });
  });

  it("upgrades a job when VQE completes successfully", async () => {
    const pendingJobs = [
      { id: 1, jobId: "job-abc", backend: "WK_C180_2", citationEdgeId: 10, status: "pending" },
    ];
    const { db, updateChain } = makeDb();
    const selectChain: Record<string, unknown> = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockResolvedValue(pendingJobs);
    db.select = vi.fn().mockReturnValue(selectChain);
    mocks.mockGetDb.mockResolvedValue(db);

    const vqeResult = JSON.stringify({
      vqe_energy: -1.234,
      backend: "WK_C180_2",
      hardware: "WuKong",
      job_id: "job-abc",
      status: "done",
      provenance_status: "quantum-hardware",
    });
    spawnMockFn.mockImplementation(() => makeMockProc(vqeResult));

    const { runQuantumVqePoller } = await import("./quantumVqePoller");
    const result = await runQuantumVqePoller();

    expect(result.polled).toBe(1);
    expect(result.upgraded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.pending).toBe(0);
    // DB update called for the job and the citation edge
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it("marks a job as failed when vqeScorer returns error", async () => {
    const pendingJobs = [
      { id: 2, jobId: "job-fail", backend: "WK_C180_2", citationEdgeId: null, status: "pending" },
    ];
    const { db } = makeDb();
    const selectChain: Record<string, unknown> = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockResolvedValue(pendingJobs);
    db.select = vi.fn().mockReturnValue(selectChain);
    mocks.mockGetDb.mockResolvedValue(db);

    const errorResult = JSON.stringify({
      error: "Job not found on backend",
      provenance_status: "quantum-architecture",
    });
    spawnMockFn.mockImplementation(() => makeMockProc(errorResult));

    const { runQuantumVqePoller } = await import("./quantumVqePoller");
    const result = await runQuantumVqePoller();

    expect(result.polled).toBe(1);
    expect(result.upgraded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(0);
    // Only one update (job status → failed), no citation edge update
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("counts still-pending jobs when status is computing", async () => {
    const pendingJobs = [
      { id: 3, jobId: "job-computing", backend: "WK_C180_2", citationEdgeId: null, status: "computing" },
    ];
    const { db } = makeDb();
    const selectChain: Record<string, unknown> = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockResolvedValue(pendingJobs);
    db.select = vi.fn().mockReturnValue(selectChain);
    mocks.mockGetDb.mockResolvedValue(db);

    const computingResult = JSON.stringify({
      status: "computing",
      provenance_status: "pending",
    });
    spawnMockFn.mockImplementation(() => makeMockProc(computingResult));

    const { runQuantumVqePoller } = await import("./quantumVqePoller");
    const result = await runQuantumVqePoller();

    expect(result.polled).toBe(1);
    expect(result.upgraded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.pending).toBe(1);
  });

  it("handles spawn parse error gracefully (marks as failed)", async () => {
    const pendingJobs = [
      { id: 4, jobId: "job-parse-err", backend: "WK_C180_2", citationEdgeId: null, status: "pending" },
    ];
    const { db } = makeDb();
    const selectChain: Record<string, unknown> = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockResolvedValue(pendingJobs);
    db.select = vi.fn().mockReturnValue(selectChain);
    mocks.mockGetDb.mockResolvedValue(db);

    // Return invalid JSON
    spawnMockFn.mockImplementation(() => makeMockProc("not valid json", 1));

    const { runQuantumVqePoller } = await import("./quantumVqePoller");
    const result = await runQuantumVqePoller();

    // Parse error → provenance_status = "quantum-architecture" → failed
    expect(result.polled).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("handles spawn error event gracefully", async () => {
    const pendingJobs = [
      { id: 5, jobId: "job-spawn-err", backend: "WK_C180_2", citationEdgeId: null, status: "pending" },
    ];
    const { db } = makeDb();
    const selectChain: Record<string, unknown> = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockResolvedValue(pendingJobs);
    db.select = vi.fn().mockReturnValue(selectChain);
    mocks.mockGetDb.mockResolvedValue(db);

    spawnMockFn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.kill = vi.fn();
      setImmediate(() => proc.emit("error", new Error("spawn ENOENT")));
      return proc;
    });

    const { runQuantumVqePoller } = await import("./quantumVqePoller");
    const result = await runQuantumVqePoller();

    expect(result.polled).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("skips citation edge update when citationEdgeId is null", async () => {
    const pendingJobs = [
      { id: 6, jobId: "job-no-edge", backend: "WK_C180_2", citationEdgeId: null, status: "pending" },
    ];
    const { db } = makeDb();
    const selectChain: Record<string, unknown> = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockResolvedValue(pendingJobs);
    db.select = vi.fn().mockReturnValue(selectChain);
    mocks.mockGetDb.mockResolvedValue(db);

    const vqeResult = JSON.stringify({
      vqe_energy: -0.5,
      backend: "WK_C180_2",
      provenance_status: "quantum-hardware",
    });
    spawnMockFn.mockImplementation(() => makeMockProc(vqeResult));

    const { runQuantumVqePoller } = await import("./quantumVqePoller");
    const result = await runQuantumVqePoller();

    expect(result.upgraded).toBe(1);
    // Only 1 update (job status), NOT 2 (no citation edge update)
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("returns failed result when ORIGINQ_API_KEY is not set", async () => {
    // Re-mock ENV with empty key
    vi.doMock("../_core/env", () => ({ ENV: { originqApiKey: "" } }));

    const pendingJobs = [
      { id: 7, jobId: "job-no-key", backend: "WK_C180_2", citationEdgeId: null, status: "pending" },
    ];
    const { db } = makeDb();
    const selectChain: Record<string, unknown> = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockResolvedValue(pendingJobs);
    db.select = vi.fn().mockReturnValue(selectChain);
    mocks.mockGetDb.mockResolvedValue(db);

    // spawn should not be called since key is empty
    spawnMockFn.mockImplementation(() => {
      throw new Error("should not be called");
    });

    vi.resetModules();
    vi.doMock("../_core/env", () => ({ ENV: { originqApiKey: "" } }));
    vi.doMock("../db", () => ({ getDb: mocks.mockGetDb }));
    vi.doMock("child_process", () => ({ spawn: spawnMockFn }));
    vi.doMock("../../drizzle/schema", () => ({
      quantumVqeJobs: { id: "id", jobId: "jobId", status: "status", citationEdgeId: "citationEdgeId", backend: "backend" },
      citationEdges: { id: "id", quantumProvenance: "quantumProvenance" },
    }));

    const { runQuantumVqePoller } = await import("./quantumVqePoller");
    const result = await runQuantumVqePoller();

    // Without API key, pollVqeJob returns quantum-architecture error → failed
    expect(result.polled).toBe(1);
    expect(result.failed).toBe(1);
  });
});
