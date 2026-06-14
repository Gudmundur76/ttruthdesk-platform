/**
 * convergenceGate.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for shouldConverge() — the gate that decides when the autonomous
 * loop should stop generating new work and converge.
 */
import { describe, it, expect } from "vitest";
import {
  shouldConverge,
  CONVERGE_THRESHOLD,
  HEALTHY_THRESHOLD,
  type ConvergenceInput,
} from "./convergenceGate";
import type { LoopAction } from "./loopOrchestrator";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeAction(priority: number, result: LoopAction["result"] = "success"): LoopAction {
  return { id: `act-${priority}`, priority, result } as LoopAction;
}

function makeInput(overrides: Partial<ConvergenceInput> = {}): ConvergenceInput {
  return {
    pendingActions: [],
    metaHealthScore: HEALTHY_THRESHOLD,
    pendingEventCount: 0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("convergenceGate — shouldConverge()", () => {
  it("returns converge:true when all four conditions are met", () => {
    const result = shouldConverge(makeInput());

    expect(result.converge).toBe(true);
    expect(result.reason).toBe("all_convergence_conditions_met");
    expect(result.conditions.noHighValueActions).toBe(true);
    expect(result.conditions.noUserFacingWork).toBe(true);
    expect(result.conditions.systemHealthy).toBe(true);
    expect(result.conditions.noNewEvents).toBe(true);
  });

  it("returns converge:false when there are high-value pending actions", () => {
    const result = shouldConverge(
      makeInput({ pendingActions: [makeAction(CONVERGE_THRESHOLD + 1)] })
    );

    expect(result.converge).toBe(false);
    expect(result.conditions.noHighValueActions).toBe(false);
    expect(result.reason).toContain("high_value_actions_pending");
  });

  it("returns converge:true when all actions are below CONVERGE_THRESHOLD", () => {
    const result = shouldConverge(
      makeInput({ pendingActions: [makeAction(CONVERGE_THRESHOLD - 1)] })
    );

    expect(result.converge).toBe(true);
    expect(result.conditions.noHighValueActions).toBe(true);
  });

  it("returns converge:false when health score is below HEALTHY_THRESHOLD", () => {
    const result = shouldConverge(makeInput({ metaHealthScore: HEALTHY_THRESHOLD - 1 }));

    expect(result.converge).toBe(false);
    expect(result.conditions.systemHealthy).toBe(false);
    expect(result.reason).toContain(`health_score_${HEALTHY_THRESHOLD - 1}_below_${HEALTHY_THRESHOLD}`);
  });

  it("returns converge:true when health score equals HEALTHY_THRESHOLD exactly", () => {
    const result = shouldConverge(makeInput({ metaHealthScore: HEALTHY_THRESHOLD }));

    expect(result.conditions.systemHealthy).toBe(true);
  });

  it("returns converge:false when there are pending events", () => {
    const result = shouldConverge(makeInput({ pendingEventCount: 3 }));

    expect(result.converge).toBe(false);
    expect(result.conditions.noNewEvents).toBe(false);
    expect(result.reason).toContain("3_events_in_queue");
  });

  it("returns converge:false when user-facing actions are pending (priority >= 50, non-skipped)", () => {
    const result = shouldConverge(
      makeInput({ pendingActions: [makeAction(55, "success")] })
    );

    expect(result.converge).toBe(false);
    expect(result.conditions.noUserFacingWork).toBe(false);
    expect(result.reason).toContain("user_facing_work_pending");
  });

  it("skipped actions do not count as user-facing work", () => {
    // A skipped action with priority >= 50 should NOT block convergence
    const result = shouldConverge(
      makeInput({ pendingActions: [makeAction(55, "skipped")] })
    );

    // noUserFacingWork should be true (skipped actions are excluded)
    expect(result.conditions.noUserFacingWork).toBe(true);
  });

  it("reason lists all failing conditions when multiple fail", () => {
    const result = shouldConverge(
      makeInput({
        pendingActions: [makeAction(CONVERGE_THRESHOLD + 5)],
        metaHealthScore: 10,
        pendingEventCount: 2,
      })
    );

    expect(result.converge).toBe(false);
    expect(result.reason).toContain("high_value_actions_pending");
    expect(result.reason).toContain("health_score_10_below_80");
    expect(result.reason).toContain("2_events_in_queue");
  });

  it("result always contains conditions object with all four keys", () => {
    const result = shouldConverge(makeInput());

    expect(result.conditions).toMatchObject({
      noHighValueActions: expect.any(Boolean),
      noUserFacingWork: expect.any(Boolean),
      systemHealthy: expect.any(Boolean),
      noNewEvents: expect.any(Boolean),
    });
  });

  it("empty pendingActions satisfies both noHighValueActions and noUserFacingWork", () => {
    const result = shouldConverge(makeInput({ pendingActions: [] }));

    expect(result.conditions.noHighValueActions).toBe(true);
    expect(result.conditions.noUserFacingWork).toBe(true);
  });
});
