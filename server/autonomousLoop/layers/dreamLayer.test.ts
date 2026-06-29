/**
 * dreamLayer.test.ts
 * Unit tests for autonomousLoop/layers/dreamLayer.ts
 *
 * Build3 T076-T084 — Wake protocol integration
 * Contract: FR-L5-01, FR-L5-32, FR-L5-38, FR-L5-39
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockRunDreamSession: vi.fn(),
  mockCheckDreamEligibility: vi.fn(),
}));

vi.mock("../../dream/dreamEngine", () => ({
  runDreamSession: mocks.mockRunDreamSession,
  checkDreamEligibility: mocks.mockCheckDreamEligibility,
}));

const makeSessionResult = (overrides?: Partial<{
  sessionId: string;
  cyclesCompleted: number;
  durationMs: number;
  wakeProtocolResult: { eventsPublished: number };
}>) => ({
  sessionId: "sess-abc-123",
  cyclesCompleted: 5,
  durationMs: 3200,
  wakeProtocolResult: { eventsPublished: 3 },
  ...overrides,
});

describe("runDreamLayer()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: eligible
    mocks.mockCheckDreamEligibility.mockResolvedValue({
      eligible: true,
      reason: null,
    });
  });

  it("returns ran=false for non-trigger event types", async () => {
    const { runDreamLayer } = await import("./dreamLayer");
    const result = await runDreamLayer(
      { id: 1, eventType: "document_submitted", payload: {} } as never,
      []
    );
    expect(result.ran).toBe(false);
    expect(result.actions).toHaveLength(0);
    expect(mocks.mockCheckDreamEligibility).not.toHaveBeenCalled();
  });

  it("returns ran=false when prior actions already include a dream_ type", async () => {
    const { runDreamLayer } = await import("./dreamLayer");
    const result = await runDreamLayer(
      { id: 2, eventType: "dream_cycle_started", payload: {} } as never,
      [{ type: "dream_session_complete", description: "already ran", priority: 60, result: "success" }]
    );
    expect(result.ran).toBe(false);
    expect(mocks.mockCheckDreamEligibility).not.toHaveBeenCalled();
  });

  it("returns ran=false and pushes skipped action when ineligible", async () => {
    mocks.mockCheckDreamEligibility.mockResolvedValue({
      eligible: false,
      reason: "Cooldown active (4h remaining)",
    });
    const { runDreamLayer } = await import("./dreamLayer");
    const result = await runDreamLayer(
      { id: 3, eventType: "dream_cycle_started", payload: {} } as never,
      []
    );
    expect(result.ran).toBe(false);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe("dream_session_skipped");
    expect(result.actions[0].description).toContain("Cooldown active");
  });

  it("returns ran=false and pushes skipped action when runDreamSession returns null", async () => {
    mocks.mockRunDreamSession.mockResolvedValue(null);
    const { runDreamLayer } = await import("./dreamLayer");
    const result = await runDreamLayer(
      { id: 4, eventType: "dream_pattern_detected", payload: {} } as never,
      []
    );
    expect(result.ran).toBe(false);
    expect(result.actions[0].type).toBe("dream_session_skipped");
    expect(result.actions[0].description).toContain("null");
  });

  it("runs dream session on dream_cycle_started event", async () => {
    mocks.mockRunDreamSession.mockResolvedValue(makeSessionResult());
    const { runDreamLayer } = await import("./dreamLayer");
    const result = await runDreamLayer(
      { id: 5, eventType: "dream_cycle_started", payload: {} } as never,
      []
    );
    expect(result.ran).toBe(true);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe("dream_session_complete");
    expect(result.actions[0].result).toBe("success");
    expect(result.actions[0].description).toContain("5 cycles");
    expect(result.actions[0].description).toContain("3 events published");
  });

  it("runs dream session on dream_pattern_detected event", async () => {
    mocks.mockRunDreamSession.mockResolvedValue(makeSessionResult({ cyclesCompleted: 3 }));
    const { runDreamLayer } = await import("./dreamLayer");
    const result = await runDreamLayer(
      { id: 6, eventType: "dream_pattern_detected", payload: { patternType: "convergence" } } as never,
      []
    );
    expect(result.ran).toBe(true);
    expect(result.actions[0].type).toBe("dream_session_complete");
  });

  it("runs dream session on dream_queue_processed event", async () => {
    mocks.mockRunDreamSession.mockResolvedValue(makeSessionResult());
    const { runDreamLayer } = await import("./dreamLayer");
    const result = await runDreamLayer(
      { id: 7, eventType: "dream_queue_processed", payload: {} } as never,
      []
    );
    expect(result.ran).toBe(true);
    expect(result.actions[0].result).toBe("success");
  });

  it("passes systemHealth from event payload to checkDreamEligibility", async () => {
    mocks.mockRunDreamSession.mockResolvedValue(makeSessionResult());
    const { runDreamLayer } = await import("./dreamLayer");
    await runDreamLayer(
      { id: 8, eventType: "dream_cycle_started", payload: { systemHealth: 75 } } as never,
      []
    );
    expect(mocks.mockCheckDreamEligibility).toHaveBeenCalledWith(75);
  });

  it("defaults systemHealth to 100 when not present in payload", async () => {
    mocks.mockRunDreamSession.mockResolvedValue(makeSessionResult());
    const { runDreamLayer } = await import("./dreamLayer");
    await runDreamLayer(
      { id: 9, eventType: "dream_cycle_started", payload: {} } as never,
      []
    );
    expect(mocks.mockCheckDreamEligibility).toHaveBeenCalledWith(100);
  });

  it("records failed action when runDreamSession throws", async () => {
    mocks.mockRunDreamSession.mockRejectedValue(new Error("dream engine exploded"));
    const { runDreamLayer } = await import("./dreamLayer");
    const result = await runDreamLayer(
      { id: 10, eventType: "dream_cycle_started", payload: {} } as never,
      []
    );
    expect(result.ran).toBe(false);
    expect(result.actions[0].type).toBe("dream_session_complete");
    expect(result.actions[0].result).toBe("failed");
    expect(result.actions[0].error).toContain("dream engine exploded");
  });

  it("records failed action when checkDreamEligibility throws", async () => {
    mocks.mockCheckDreamEligibility.mockRejectedValue(new Error("db unavailable"));
    const { runDreamLayer } = await import("./dreamLayer");
    const result = await runDreamLayer(
      { id: 11, eventType: "dream_cycle_started", payload: {} } as never,
      []
    );
    expect(result.ran).toBe(false);
    expect(result.actions[0].result).toBe("failed");
    expect(result.actions[0].error).toContain("db unavailable");
  });
});
