/**
 * eventBus.test.ts — imports from the real module.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EVENT_ENTRY_LAYERS, scheduleDrain } from "./eventBus";
import type { LoopEventType } from "./eventBus";

describe("EVENT_ENTRY_LAYERS", () => {
  it("contains all 31 expected event types", () => {
    const expected: LoopEventType[] = [
      "document_submitted",
      "paper_discovered",
      "source_data_changed",
      "verdict_complete",
      "contradiction_found",
      "gap_closed",
      "source_status_change",
      "system_health_change",
      "hypothesis_resolved",
      "manual_review_complete",
      "scheduled_tick",
      "loop_action_complete",
      "dream_pattern_detected",
      "confidence_review_needed",
      "dream_session_complete",
      "source_version_changed",
      "coverage_gap",
      "system_capability_required",
      "frontier_search_requested",
      "frontier_result_received",
      "dream_hypothesis_generated",
      "dream_cycle_started",
      "code_drift_detected",
      "stub_escalated",
      "pipeline_invariant_violated",
      "self_prompt_triggered",
      "authority_violation",
      "layer_telemetry_recorded",
      "pipeline_stage_complete",
      "convergence_gate_opened",
      "dream_queue_processed",
    ];
    for (const type of expected)
      expect(EVENT_ENTRY_LAYERS).toHaveProperty(type);
    expect(Object.keys(EVENT_ENTRY_LAYERS)).toHaveLength(expected.length);
  });
  it("all entry layer values are non-negative integers in range 0-5", () => {
    for (const layer of Object.values(EVENT_ENTRY_LAYERS)) {
      expect(typeof layer).toBe("number");
      expect(Number.isInteger(layer)).toBe(true);
      expect(layer).toBeGreaterThanOrEqual(0);
      expect(layer).toBeLessThanOrEqual(5);
    }
  });
  it("document_submitted enters at layer 0", () => {
    expect(EVENT_ENTRY_LAYERS.document_submitted).toBe(0);
  });
  it("source_data_changed enters at layer 1", () => {
    expect(EVENT_ENTRY_LAYERS.source_data_changed).toBe(1);
  });
  it("verdict_complete enters at layer 2", () => {
    expect(EVENT_ENTRY_LAYERS.verdict_complete).toBe(2);
  });
  it("system_health_change enters at layer 4", () => {
    expect(EVENT_ENTRY_LAYERS.system_health_change).toBe(4);
  });
  it("scheduled_tick enters at layer 0", () => {
    expect(EVENT_ENTRY_LAYERS.scheduled_tick).toBe(0);
  });
});

describe("scheduleDrain", () => {
  afterEach(() => vi.restoreAllMocks());
  it("is a function that can be called without throwing", () => {
    expect(() => scheduleDrain()).not.toThrow();
  });
  it("calls setImmediate to schedule the drain asynchronously", () => {
    const spy = vi.spyOn(global, "setImmediate");
    scheduleDrain();
    expect(spy).toHaveBeenCalledOnce();
  });
  it("can be called multiple times without throwing", () => {
    expect(() => {
      scheduleDrain();
      scheduleDrain();
      scheduleDrain();
    }).not.toThrow();
  });
});
