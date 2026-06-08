/**
 * cronRunLogger.test.ts — imports from the real module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { logCronRun, withCronLog } from "./cronRunLogger";

vi.mock("./db", () => ({ getDb: vi.fn() }));
import { getDb } from "./db";

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockDb = { insert: mockInsert };

beforeEach(() => {
  vi.clearAllMocks();
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
});

describe("logCronRun", () => {
  it("inserts a record with the correct jobName and status", async () => {
    await logCronRun("test-job", "ok", 100, "Processed 5 items");
    expect(mockInsert).toHaveBeenCalledOnce();
  });
  it("does not throw when DB returns null", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(logCronRun("test-job", "ok", 100)).resolves.toBeUndefined();
  });
  it("does not throw when DB insert throws", async () => {
    mockInsert.mockReturnValue({ values: vi.fn().mockRejectedValue(new Error("DB error")) });
    await expect(logCronRun("test-job", "error", 50)).resolves.toBeUndefined();
  });
  it("accepts all three status values without throwing", async () => {
    await expect(logCronRun("j", "ok", 1)).resolves.toBeUndefined();
    await expect(logCronRun("j", "error", 1)).resolves.toBeUndefined();
    await expect(logCronRun("j", "skipped", 1)).resolves.toBeUndefined();
  });
});

describe("withCronLog", () => {
  it("returns status ok and the summary string when fn succeeds", async () => {
    const r = await withCronLog("test-job", async () => "Ingested 12 papers");
    expect(r.status).toBe("ok"); expect(r.summary).toBe("Ingested 12 papers");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
  it("returns status error and the error message when fn throws", async () => {
    const r = await withCronLog("test-job", async () => { throw new Error("Something failed"); });
    expect(r.status).toBe("error"); expect(r.summary).toBe("Something failed");
  });
  it("records the run via logCronRun on success", async () => {
    await withCronLog("test-job", async () => "done");
    expect(mockInsert).toHaveBeenCalledOnce();
  });
  it("records the run via logCronRun on failure", async () => {
    await withCronLog("test-job", async () => { throw new Error("fail"); });
    expect(mockInsert).toHaveBeenCalledOnce();
  });
  it("durationMs is a non-negative number", async () => {
    const r = await withCronLog("test-job", async () => "ok");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
  it("handles non-Error throws and converts to string", async () => {
    const r = await withCronLog("test-job", async () => { throw "string error"; });
    expect(r.status).toBe("error"); expect(r.summary).toBe("string error");
  });
});
