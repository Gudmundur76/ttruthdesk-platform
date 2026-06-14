/**
 * frontierLayer.test.ts
 * Unit tests for autonomousLoop/layers/frontierLayer.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockRunFrontierEngine: vi.fn(),
  mockHandlePaperDiscovered: vi.fn(),
}));

vi.mock("../../frontier/frontierEngine", () => ({
  runFrontierEngine: mocks.mockRunFrontierEngine,
}));
vi.mock("../../frontier/paperDiscoveredHandler", () => ({
  handlePaperDiscovered: mocks.mockHandlePaperDiscovered,
}));

const makeFrontierResult = () => ({
  gapMapping: { newGapsCreated: 2, gapsUpdated: 1 },
  hypothesisGeneration: { hypothesesGenerated: 3 },
  pursuitResults: [{ gapId: 1, action: "queue_item_created" }],
});

describe("runFrontierLayer()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns ran=false for non-trigger event types", async () => {
    const { runFrontierLayer } = await import("./frontierLayer");
    const result = await runFrontierLayer(
      { eventType: "document_submitted", payload: {} } as never,
      []
    );
    expect(result.ran).toBe(false);
    expect(result.actions).toHaveLength(0);
  });

  it("returns ran=false when prior actions already include frontier_ type", async () => {
    const { runFrontierLayer } = await import("./frontierLayer");
    const result = await runFrontierLayer(
      { eventType: "verdict_complete", payload: {} } as never,
      [{ type: "frontier_engine_run", description: "already ran", priority: 50, result: "success" }]
    );
    expect(result.ran).toBe(false);
  });

  it("runs frontier engine on verdict_complete event", async () => {
    mocks.mockRunFrontierEngine.mockResolvedValue(makeFrontierResult());
    const { runFrontierLayer } = await import("./frontierLayer");
    const result = await runFrontierLayer(
      { eventType: "verdict_complete", payload: { verdict: "Insufficient Evidence" } } as never,
      []
    );
    expect(result.ran).toBe(true);
    expect(result.actions[0].type).toBe("frontier_engine_run");
    expect(result.actions[0].result).toBe("success");
  });

  it("runs frontier engine on scheduled_tick event", async () => {
    mocks.mockRunFrontierEngine.mockResolvedValue(makeFrontierResult());
    const { runFrontierLayer } = await import("./frontierLayer");
    const result = await runFrontierLayer(
      { eventType: "scheduled_tick", payload: {} } as never,
      []
    );
    expect(result.ran).toBe(true);
    expect(result.actions[0].type).toBe("frontier_engine_run");
  });

  it("handles paper_discovered event — calls handlePaperDiscovered", async () => {
    mocks.mockHandlePaperDiscovered.mockResolvedValue({
      actions: [{ type: "hypothesis_created", description: "new hyp", priority: 60, result: "success" }],
    });
    const { runFrontierLayer } = await import("./frontierLayer");
    const result = await runFrontierLayer(
      { eventType: "paper_discovered", payload: { paperId: "arxiv:5678" } } as never,
      []
    );
    expect(result.ran).toBe(true);
    expect(result.actions[0].type).toBe("hypothesis_created");
  });

  it("records failed action when frontier engine throws", async () => {
    mocks.mockRunFrontierEngine.mockRejectedValue(new Error("engine error"));
    const { runFrontierLayer } = await import("./frontierLayer");
    const result = await runFrontierLayer(
      { eventType: "gap_closed", payload: {} } as never,
      []
    );
    expect(result.ran).toBe(true);
    expect(result.actions[0].result).toBe("failed");
    expect(result.actions[0].error).toContain("engine error");
  });
});
