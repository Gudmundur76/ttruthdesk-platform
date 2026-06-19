/**
 * telemetryCollector.test.ts
 *
 * Tests for the shared telemetry service:
 *   - emitLayerTelemetry (core helper)
 *   - emitLayerStart / emitLayerEnd / emitLayerError (convenience wrappers)
 *   - getLayerTelemetrySummary (query helper)
 *
 * All DB calls are mocked so tests run without a live database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the DB module ───────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInsertChain(insertSpy: ReturnType<typeof vi.fn>) {
  return {
    insert: insertSpy,
    values: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "from", "where", "orderBy", "limit"];
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  chain.catch = (reject: (e: unknown) => void) =>
    Promise.resolve(rows).catch(reject);
  return chain;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("telemetryCollector", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ── emitLayerTelemetry ─────────────────────────────────────────────────────

  describe("emitLayerTelemetry", () => {
    it("inserts a row with the correct layer and eventType", async () => {
      const { getDb } = await import("./db");
      const insertSpy = vi.fn();
      const valuesSpy = vi.fn().mockResolvedValue(undefined);
      insertSpy.mockReturnValue({ values: valuesSpy });
      vi.mocked(getDb).mockResolvedValue({ insert: insertSpy } as never);

      const { emitLayerTelemetry } = await import("./telemetryCollector");
      await emitLayerTelemetry("L1_TRUTH", "start", "corr-001");

      expect(insertSpy).toHaveBeenCalledOnce();
      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          layer: "L1_TRUTH",
          eventType: "start",
          correlationId: "corr-001",
        })
      );
    });

    it("sets success=true for non-error eventTypes by default", async () => {
      const { getDb } = await import("./db");
      const insertSpy = vi.fn();
      const valuesSpy = vi.fn().mockResolvedValue(undefined);
      insertSpy.mockReturnValue({ values: valuesSpy });
      vi.mocked(getDb).mockResolvedValue({ insert: insertSpy } as never);

      const { emitLayerTelemetry } = await import("./telemetryCollector");
      await emitLayerTelemetry("L3_FRONTIER", "end", "corr-002");

      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it("sets success=false for error eventType", async () => {
      const { getDb } = await import("./db");
      const insertSpy = vi.fn();
      const valuesSpy = vi.fn().mockResolvedValue(undefined);
      insertSpy.mockReturnValue({ values: valuesSpy });
      vi.mocked(getDb).mockResolvedValue({ insert: insertSpy } as never);

      const { emitLayerTelemetry } = await import("./telemetryCollector");
      await emitLayerTelemetry("L4_META", "error", "corr-003");

      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it("is non-fatal — swallows DB errors silently", async () => {
      const { getDb } = await import("./db");
      const insertSpy = vi.fn().mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error("DB connection lost")),
      });
      vi.mocked(getDb).mockResolvedValue({ insert: insertSpy } as never);

      const { emitLayerTelemetry } = await import("./telemetryCollector");
      // Must not throw
      await expect(
        emitLayerTelemetry("L5_DREAM", "start", "corr-004")
      ).resolves.toBeUndefined();
    });

    it("is a no-op when DB is unavailable (getDb returns null)", async () => {
      const { getDb } = await import("./db");
      vi.mocked(getDb).mockResolvedValue(null as never);

      const { emitLayerTelemetry } = await import("./telemetryCollector");
      await expect(
        emitLayerTelemetry("L0_FRICTION", "start", "corr-005")
      ).resolves.toBeUndefined();
    });

    it("persists optional opts fields (eventQueueId, durationMs, meta)", async () => {
      const { getDb } = await import("./db");
      const insertSpy = vi.fn();
      const valuesSpy = vi.fn().mockResolvedValue(undefined);
      insertSpy.mockReturnValue({ values: valuesSpy });
      vi.mocked(getDb).mockResolvedValue({ insert: insertSpy } as never);

      const { emitLayerTelemetry } = await import("./telemetryCollector");
      await emitLayerTelemetry("L2_SELF_PROMPT", "end", "corr-006", {
        eventQueueId: 42,
        durationMs: 150,
        meta: { claimId: 7 },
      });

      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventQueueId: 42,
          durationMs: 150,
          metadataJson: { claimId: 7 },
        })
      );
    });
  });

  // ── emitLayerStart ─────────────────────────────────────────────────────────

  describe("emitLayerStart", () => {
    it("emits a 'start' event", async () => {
      const { getDb } = await import("./db");
      const insertSpy = vi.fn();
      const valuesSpy = vi.fn().mockResolvedValue(undefined);
      insertSpy.mockReturnValue({ values: valuesSpy });
      vi.mocked(getDb).mockResolvedValue({ insert: insertSpy } as never);

      const { emitLayerStart } = await import("./telemetryCollector");
      await emitLayerStart("L1_TRUTH", "corr-start-001", { eventQueueId: 10 });

      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "start", eventQueueId: 10 })
      );
    });
  });

  // ── emitLayerEnd ──────────────────────────────────────────────────────────

  describe("emitLayerEnd", () => {
    it("emits an 'end' event with computed durationMs and success=true", async () => {
      const { getDb } = await import("./db");
      const insertSpy = vi.fn();
      const valuesSpy = vi.fn().mockResolvedValue(undefined);
      insertSpy.mockReturnValue({ values: valuesSpy });
      vi.mocked(getDb).mockResolvedValue({ insert: insertSpy } as never);

      const { emitLayerEnd } = await import("./telemetryCollector");
      const startMs = Date.now() - 200;
      await emitLayerEnd("L3_FRONTIER", "corr-end-001", startMs);

      const callArg = valuesSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(callArg.eventType).toBe("end");
      expect(callArg.success).toBe(true);
      expect(typeof callArg.durationMs).toBe("number");
      expect(callArg.durationMs as number).toBeGreaterThanOrEqual(200);
    });
  });

  // ── emitLayerError ────────────────────────────────────────────────────────

  describe("emitLayerError", () => {
    it("emits an 'error' event with success=false and errorCode", async () => {
      const { getDb } = await import("./db");
      const insertSpy = vi.fn();
      const valuesSpy = vi.fn().mockResolvedValue(undefined);
      insertSpy.mockReturnValue({ values: valuesSpy });
      vi.mocked(getDb).mockResolvedValue({ insert: insertSpy } as never);

      const { emitLayerError } = await import("./telemetryCollector");
      await emitLayerError("L4_META", "corr-err-001", "DB_UNAVAILABLE");

      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "error",
          success: false,
          errorCode: "DB_UNAVAILABLE",
        })
      );
    });
  });

  // ── getLayerTelemetrySummary ──────────────────────────────────────────────

  describe("getLayerTelemetrySummary", () => {
    it("returns null when DB is unavailable", async () => {
      const { getDb } = await import("./db");
      vi.mocked(getDb).mockResolvedValue(null as never);

      const { getLayerTelemetrySummary } = await import("./telemetryCollector");
      const result = await getLayerTelemetrySummary("L1_TRUTH");
      expect(result).toBeNull();
    });

    it("returns a summary with correct shape when rows exist", async () => {
      const { getDb } = await import("./db");
      const now = new Date();
      const mockRows = [
        {
          layer: "L1_TRUTH",
          eventType: "end",
          success: true,
          durationMs: 120,
          createdAt: now,
          correlationId: "c1",
          errorCode: null,
          eventQueueId: null,
          payloadHash: null,
          metadataJson: null,
          id: 1,
        },
        {
          layer: "L1_TRUTH",
          eventType: "end",
          success: true,
          durationMs: 80,
          createdAt: now,
          correlationId: "c2",
          errorCode: null,
          eventQueueId: null,
          payloadHash: null,
          metadataJson: null,
          id: 2,
        },
        {
          layer: "L1_TRUTH",
          eventType: "error",
          success: false,
          durationMs: null,
          createdAt: now,
          correlationId: "c3",
          errorCode: "LAYER_ERROR",
          eventQueueId: null,
          payloadHash: null,
          metadataJson: null,
          id: 3,
        },
      ];

      const chain = makeSelectChain(mockRows);
      vi.mocked(getDb).mockResolvedValue({ select: chain.select } as never);

      const { getLayerTelemetrySummary } = await import("./telemetryCollector");
      const result = await getLayerTelemetrySummary("L1_TRUTH");

      expect(result).not.toBeNull();
      expect(result?.layer).toBe("L1_TRUTH");
      expect(result?.totalRuns).toBe(2); // only "end" events count
      expect(result?.successRate).toBe(1); // both end rows are success=true
      expect(result?.avgDurationMs).toBe(100); // (120 + 80) / 2
      expect(result?.errorCount).toBe(1);
      expect(result?.lastRunAt).toEqual(now);
    });

    it("returns zero-run summary when no rows match the layer", async () => {
      const { getDb } = await import("./db");
      const chain = makeSelectChain([]);
      vi.mocked(getDb).mockResolvedValue({ select: chain.select } as never);

      const { getLayerTelemetrySummary } = await import("./telemetryCollector");
      const result = await getLayerTelemetrySummary("L5_DREAM");

      expect(result?.totalRuns).toBe(0);
      expect(result?.successRate).toBe(0);
      expect(result?.avgDurationMs).toBeNull();
      expect(result?.lastRunAt).toBeNull();
    });

    it("returns null when DB throws", async () => {
      const { getDb } = await import("./db");
      vi.mocked(getDb).mockRejectedValue(new Error("DB error"));

      const { getLayerTelemetrySummary } = await import("./telemetryCollector");
      const result = await getLayerTelemetrySummary("L2_SELF_PROMPT");
      expect(result).toBeNull();
    });
  });

  // ── Layer coverage — all 6 TelemetryLayer values are accepted ─────────────

  describe("TelemetryLayer coverage", () => {
    const layers = [
      "L0_FRICTION",
      "L1_TRUTH",
      "L2_SELF_PROMPT",
      "L3_FRONTIER",
      "L4_META",
      "L5_DREAM",
    ] as const;

    it.each(layers)("emitLayerStart accepts layer %s", async (layer) => {
      const { getDb } = await import("./db");
      const insertSpy = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      vi.mocked(getDb).mockResolvedValue({ insert: insertSpy } as never);

      const { emitLayerStart } = await import("./telemetryCollector");
      await expect(
        emitLayerStart(layer, "corr-coverage")
      ).resolves.toBeUndefined();
    });
  });
});
