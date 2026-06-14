/**
 * autonomousLoop/loopOrchestrator.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for loopOrchestrator.ts — processEvent() and getLoopConfig().
 * Note: persistLoopRun is a private function — we mock getDb to stub DB ops.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockRunFrictionGate: vi.fn(),
  mockGetSafeModeStatus: vi.fn(),
  mockRunTruthLayer: vi.fn(),
  mockRunSelfPromptLayer: vi.fn(),
  mockRunFrontierLayer: vi.fn(),
  mockRunMetaLayer: vi.fn(),
  mockMarkEventSkipped: vi.fn(),
  mockMarkEventFailed: vi.fn(),
  mockMarkEventProcessed: vi.fn(),
  mockPublishEvent: vi.fn(),
  mockGetDb: vi.fn(),
}));

vi.mock("./layers/frictionLayer", () => ({ runFrictionGate: mocks.mockRunFrictionGate }));
vi.mock("./safeModeController", () => ({ getSafeModeStatus: mocks.mockGetSafeModeStatus }));
vi.mock("./layers/truthLayer", () => ({ runTruthLayer: mocks.mockRunTruthLayer }));
vi.mock("./layers/selfPromptLayer", () => ({ runSelfPromptLayer: mocks.mockRunSelfPromptLayer }));
vi.mock("./layers/frontierLayer", () => ({ runFrontierLayer: mocks.mockRunFrontierLayer }));
vi.mock("./layers/metaLayer", () => ({ runMetaLayer: mocks.mockRunMetaLayer }));
vi.mock("./eventBus", () => ({
  markEventSkipped: mocks.mockMarkEventSkipped,
  markEventFailed: mocks.mockMarkEventFailed,
  markEventProcessed: mocks.mockMarkEventProcessed,
  publishEvent: mocks.mockPublishEvent,
  claimNextEvent: vi.fn().mockResolvedValue(null),
  getPendingEventCount: vi.fn().mockResolvedValue(0),
  getRecentEvents: vi.fn().mockResolvedValue([]),
  scheduleDrain: vi.fn(),
  EVENT_ENTRY_LAYERS: {},
}));
vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));

import { processEvent, getLoopConfig } from "./loopOrchestrator";
import type { LoopEvent } from "./eventBus";

/** Minimal DB mock for insert (persistLoopRun) and select (getLoopConfig) */
function makeDb() {
  return {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([{ insertId: 42 }]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    then: undefined,
  };
}

const baseEvent: LoopEvent = {
  id: 1,
  eventType: "document_submitted",
  entryLayer: 0,
  payload: { documentId: 42 },
  status: "pending",
  loopRunId: null,
  skipReason: null,
  attempts: 0,
  errorMessage: null,
  createdAt: new Date(),
  processedAt: null,
};

describe("loopOrchestrator — processEvent()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetDb.mockResolvedValue(makeDb());
    mocks.mockRunFrictionGate.mockResolvedValue({ shouldProcess: true, actions: [], reason: null });
    mocks.mockGetSafeModeStatus.mockResolvedValue({ active: false, reason: null });
    mocks.mockRunTruthLayer.mockResolvedValue({ actions: [], verdicts: [] });
    mocks.mockRunSelfPromptLayer.mockResolvedValue({ actions: [] });
    mocks.mockRunFrontierLayer.mockResolvedValue({ ran: false, actions: [] });
    mocks.mockRunMetaLayer.mockResolvedValue({ actions: [] });
    mocks.mockMarkEventSkipped.mockResolvedValue(undefined);
    mocks.mockMarkEventFailed.mockResolvedValue(undefined);
    mocks.mockMarkEventProcessed.mockResolvedValue(undefined);
    mocks.mockPublishEvent.mockResolvedValue(undefined);
  });

  it("returns a LoopRunResult with expected shape", async () => {
    const result = await processEvent(baseEvent);
    expect(result).toHaveProperty("loopRunId");
    expect(result).toHaveProperty("eventId", 1);
    expect(result).toHaveProperty("eventType", "document_submitted");
    expect(result).toHaveProperty("layersExecuted");
    expect(result).toHaveProperty("actionsExecuted");
    expect(result).toHaveProperty("converged");
    expect(result).toHaveProperty("safeModeTriggered");
    expect(result).toHaveProperty("durationMs");
  });

  it("converges when friction gate rejects and calls markEventSkipped", async () => {
    mocks.mockRunFrictionGate.mockResolvedValue({
      shouldProcess: false,
      actions: [],
      reason: "no_verifiable_payload",
    });
    const result = await processEvent(baseEvent);
    expect(mocks.mockMarkEventSkipped).toHaveBeenCalledWith(1, "no_verifiable_payload");
    expect(result.converged).toBe(true);
    expect(result.convergenceReason).toBe("no_verifiable_payload");
  });

  it("skips non-document events in safe mode", async () => {
    mocks.mockGetSafeModeStatus.mockResolvedValue({ active: true, reason: "high_error_rate" });
    const scheduledEvent: LoopEvent = { ...baseEvent, eventType: "scheduled_tick" };
    const result = await processEvent(scheduledEvent);
    expect(mocks.mockMarkEventSkipped).toHaveBeenCalledWith(1, "safe_mode: high_error_rate");
    expect(result.safeModeTriggered).toBe(true);
    expect(result.converged).toBe(true);
  });

  it("allows document_submitted events through safe mode and runs truth layer", async () => {
    mocks.mockGetSafeModeStatus.mockResolvedValue({ active: true, reason: "high_error_rate" });
    await processEvent(baseEvent);
    expect(mocks.mockMarkEventSkipped).not.toHaveBeenCalled();
    expect(mocks.mockRunTruthLayer).toHaveBeenCalledOnce();
  });

  it("publishes verdict_complete events for each verdict from truth layer", async () => {
    mocks.mockRunTruthLayer.mockResolvedValue({
      actions: [],
      verdicts: [
        { claimId: 10, verdict: "supported" },
        { claimId: 11, verdict: "refuted" },
      ],
    });
    await processEvent(baseEvent);
    expect(mocks.mockPublishEvent).toHaveBeenCalledTimes(2);
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith("verdict_complete", expect.objectContaining({ claimId: 10 }));
  });

  it("does not run frontier layer in safe mode", async () => {
    mocks.mockGetSafeModeStatus.mockResolvedValue({ active: true, reason: "high_error_rate" });
    await processEvent(baseEvent);
    expect(mocks.mockRunFrontierLayer).not.toHaveBeenCalled();
  });

  it("includes layers 0 and 1 in layersExecuted for document_submitted", async () => {
    const result = await processEvent(baseEvent);
    expect(result.layersExecuted).toContain(0);
    expect(result.layersExecuted).toContain(1);
  });
});

describe("loopOrchestrator — getLoopConfig()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns config row when DB has a config", async () => {
    const configRow = { id: 1, key: "maxConcurrentEvents", value: "5" };
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([configRow]),
      then: undefined,
    };
    mocks.mockGetDb.mockResolvedValue(db);
    const config = await getLoopConfig();
    expect(config).toEqual(configRow);
  });

  it("returns null when DB has no config", async () => {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
      then: undefined,
    };
    mocks.mockGetDb.mockResolvedValue(db);
    const config = await getLoopConfig();
    expect(config).toBeNull();
  });

  it("returns null when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const config = await getLoopConfig();
    expect(config).toBeNull();
  });
});
