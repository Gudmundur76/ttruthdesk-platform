import { describe, it, expect, vi, beforeEach } from "vitest";
import { StageRegistry, globalStageRegistry } from "./stageRegistry";
import type { StageContext, StageResult } from "./stageRegistry";

function makeContext(overrides: Partial<StageContext> = {}): StageContext {
  return {
    documentId: 1,
    documentStatus: "complete",
    qualityTier: "verified",
    ...overrides,
  };
}

describe("StageRegistry", () => {
  it("registers stages and lists them in order", () => {
    const registry = new StageRegistry();
    registry.register({ id: 2, name: "B", fn: async () => ({ outcome: "PASS" }) });
    registry.register({ id: 1, name: "A", fn: async () => ({ outcome: "PASS" }) });
    const stages = registry.listStages();
    expect(stages[0].name).toBe("A");
    expect(stages[1].name).toBe("B");
  });

  it("throws if same id registered twice", () => {
    const registry = new StageRegistry();
    registry.register({ id: 1, name: "A", fn: async () => ({ outcome: "PASS" }) });
    expect(() => registry.register({ id: 1, name: "B", fn: async () => ({ outcome: "PASS" }) }))
      .toThrow("already registered");
  });

  it("executes stages in order and returns success", async () => {
    const registry = new StageRegistry();
    const order: number[] = [];
    registry.register({ id: 1, name: "S1", fn: async () => { order.push(1); return { outcome: "PASS" }; } });
    registry.register({ id: 2, name: "S2", fn: async () => { order.push(2); return { outcome: "PASS" }; } });
    const result = await registry.execute(makeContext());
    expect(result.success).toBe(true);
    expect(result.stagesRun).toBe(2);
    expect(order).toEqual([1, 2]);
  });

  it("aborts on fatal SKIP", async () => {
    const registry = new StageRegistry();
    registry.register({ id: 0, name: "Guard", fn: async () => ({ outcome: "SKIP", reason: "draft" }), fatal: true });
    registry.register({ id: 1, name: "S1", fn: async () => ({ outcome: "PASS" }) });
    const result = await registry.execute(makeContext({ documentStatus: "pending" }));
    expect(result.success).toBe(false);
    expect(result.abortedAt).toBe("Guard");
    expect(result.stagesRun).toBe(1);
  });

  it("aborts on non-fatal FAIL", async () => {
    const registry = new StageRegistry();
    registry.register({ id: 1, name: "S1", fn: async () => ({ outcome: "FAIL", reason: "error" }) });
    registry.register({ id: 2, name: "S2", fn: async () => ({ outcome: "PASS" }) });
    const result = await registry.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.stagesRun).toBe(1);
  });

  it("propagates data from stage to context", async () => {
    const registry = new StageRegistry();
    registry.register({ id: 1, name: "S1", fn: async () => ({ outcome: "PASS", data: { compositeScore: 0.9 } }) });
    registry.register({ id: 2, name: "S2", fn: async (ctx) => ({
      outcome: "PASS",
      data: { captured: ctx.compositeScore },
    }) });
    const ctx = makeContext();
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    const s2 = result.results.find(r => r.stage === "S2");
    expect(s2?.data?.captured).toBe(0.9);
  });

  it("handles thrown exceptions as FAIL", async () => {
    const registry = new StageRegistry();
    registry.register({ id: 1, name: "S1", fn: async () => { throw new Error("boom"); } });
    const result = await registry.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.results[0].outcome).toBe("FAIL");
    expect(result.results[0].reason).toContain("boom");
  });
});

describe("DraftGuard stage (globalStageRegistry stage 0)", () => {
  it("passes for complete documents", async () => {
    const stage = globalStageRegistry.getStage(0)!;
    const result = await stage.fn(makeContext({ documentStatus: "complete" }));
    expect(result.outcome).toBe("PASS");
  });

  it("skips for pending documents", async () => {
    const stage = globalStageRegistry.getStage(0)!;
    const result = await stage.fn(makeContext({ documentStatus: "pending" }));
    expect(result.outcome).toBe("SKIP");
  });

  it("is registered as fatal", () => {
    const stage = globalStageRegistry.getStage(0)!;
    expect(stage.fatal).toBe(true);
  });
});

describe("globalStageRegistry", () => {
  it("has 11 stages registered (0-10)", () => {
    expect(globalStageRegistry.listStages()).toHaveLength(11);
  });

  it("aborts pipeline for pending document", async () => {
    const ctx = makeContext({ documentStatus: "pending" });
    const result = await globalStageRegistry.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.abortedAt).toBe("DraftGuard");
  });
});
