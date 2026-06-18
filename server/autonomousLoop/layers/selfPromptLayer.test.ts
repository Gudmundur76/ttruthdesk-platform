/**
 * selfPromptLayer.test.ts
 * Unit tests for autonomousLoop/layers/selfPromptLayer.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockRunSelfPromptCycle: vi.fn(),
  mockPublishEvent: vi.fn(),
  mockAppendLog: vi.fn(),
  mockRunFrontierEngine: vi.fn(),
  mockRunInversePromptEngine: vi.fn(),
}));

vi.mock("../../selfPrompt/engine", () => ({
  runSelfPromptCycle: mocks.mockRunSelfPromptCycle,
}));
vi.mock("../eventBus", () => ({
  publishEvent: mocks.mockPublishEvent,
}));
vi.mock("../../wikiEngine", () => ({
  appendLog: mocks.mockAppendLog,
}));
// These are dynamically imported inside handleInsufficientEvidence — must be
// mocked at module level so vi.mock hoisting intercepts the dynamic import.
vi.mock("../../frontier/frontierEngine", () => ({
  runFrontierEngine: mocks.mockRunFrontierEngine,
}));
vi.mock("../../inversePrompt/inversePromptEngine", () => ({
  runInversePromptEngine: mocks.mockRunInversePromptEngine,
}));

describe("runSelfPromptLayer()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockRunSelfPromptCycle.mockResolvedValue({ actionsExecuted: 2, nextState: "idle" });
    mocks.mockPublishEvent.mockResolvedValue(undefined);
    mocks.mockAppendLog.mockResolvedValue(undefined);
    mocks.mockRunFrontierEngine.mockResolvedValue({
      gapMapping: { total: 0, newGaps: 0, closedGaps: 0 },
      actionsExecuted: 0,
    });
    mocks.mockRunInversePromptEngine.mockResolvedValue({
      candidatesGenerated: 0,
      passedGate: 0,
    });
  });

  it("handles verdict_complete Supported — returns wiki_update action", async () => {
    const { runSelfPromptLayer } = await import("./selfPromptLayer");
    const result = await runSelfPromptLayer({
      eventType: "verdict_complete",
      payload: { verdict: "Supported", documentId: 1, claimId: 10 },
    } as never);
    expect(result.actions.length).toBeGreaterThan(0);
    const types = result.actions.map((a) => a.type);
    // Supported verdict should trigger wiki_update or similar
    expect(types.some((t) => t.includes("wiki") || t.includes("supported") || t.includes("graph"))).toBe(true);
  });

  it("handles verdict_complete Contradicted — returns actions", async () => {
    const { runSelfPromptLayer } = await import("./selfPromptLayer");
    const result = await runSelfPromptLayer({
      eventType: "verdict_complete",
      payload: { verdict: "Contradicted", documentId: 2, claimId: 20 },
    } as never);
    expect(result.actions.length).toBeGreaterThan(0);
  });

  it("handles verdict_complete Insufficient Evidence — returns actions", async () => {
    const { runSelfPromptLayer } = await import("./selfPromptLayer");
    const result = await runSelfPromptLayer({
      eventType: "verdict_complete",
      payload: { verdict: "Insufficient Evidence", documentId: 3, claimId: 30 },
    } as never);
    expect(result.actions.length).toBeGreaterThan(0);
  });

  it("handles verdict_complete Partially Supported — returns actions", async () => {
    const { runSelfPromptLayer } = await import("./selfPromptLayer");
    const result = await runSelfPromptLayer({
      eventType: "verdict_complete",
      payload: { verdict: "Partially Supported", documentId: 4, claimId: 40 },
    } as never);
    expect(result.actions.length).toBeGreaterThan(0);
  });

  it("handles verdict_complete with unknown verdict — runs self_prompt_cycle", async () => {
    const { runSelfPromptLayer } = await import("./selfPromptLayer");
    const result = await runSelfPromptLayer({
      eventType: "verdict_complete",
      payload: { verdict: "Ambiguous", documentId: 5, claimId: 50 },
    } as never);
    expect(result.actions.length).toBeGreaterThan(0);
    const types = result.actions.map((a) => a.type);
    expect(types).toContain("self_prompt_cycle");
  });

  it("handles scheduled_tick event — returns actions", async () => {
    const { runSelfPromptLayer } = await import("./selfPromptLayer");
    const result = await runSelfPromptLayer({
      eventType: "scheduled_tick",
      payload: {},
    } as never);
    expect(result.actions.length).toBeGreaterThan(0);
  });

  it("handles gap_closed event — returns actions", async () => {
    const { runSelfPromptLayer } = await import("./selfPromptLayer");
    const result = await runSelfPromptLayer({
      eventType: "gap_closed",
      payload: { gapId: 7 },
    } as never);
    expect(result.actions.length).toBeGreaterThan(0);
  });
});
