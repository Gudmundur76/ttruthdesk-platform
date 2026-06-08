/**
 * frictionLayer.test.ts — imports from the real module.
 */
import { describe, it, expect } from "vitest";
import { runFrictionGate } from "./frictionLayer";
import type { LoopEvent } from "../eventBus";

function makeEvent(eventType: LoopEvent["eventType"], payload: Record<string, unknown>): LoopEvent {
  return { id: 1, eventType, payload, status: "pending", entryLayer: 0, loopRunId: null,
    skipReason: null, attempts: 0, errorMessage: null, createdAt: new Date(), processedAt: null };
}

describe("runFrictionGate", () => {
  it("rejects events with empty payload", async () => {
    const r = await runFrictionGate(makeEvent("document_submitted", {}));
    expect(r.shouldProcess).toBe(false); expect(r.reason).toBe("empty_payload");
  });
  it("rejects document_submitted without documentId or claimText", async () => {
    const r = await runFrictionGate(makeEvent("document_submitted", { other: "data" }));
    expect(r.shouldProcess).toBe(false); expect(r.reason).toBe("missing_document_id");
  });
  it("accepts document_submitted with documentId", async () => {
    const r = await runFrictionGate(makeEvent("document_submitted", { documentId: 42 }));
    expect(r.shouldProcess).toBe(true); expect(r.actions).toHaveLength(1);
    expect(r.actions[0].type).toBe("friction_check");
  });
  it("accepts document_submitted with claimText longer than 5 chars", async () => {
    const r = await runFrictionGate(makeEvent("document_submitted", { claimText: "Lysozyme has 1.8 Angstrom resolution" }));
    expect(r.shouldProcess).toBe(true);
  });
  it("rejects document_submitted with claimText <= 5 chars", async () => {
    const r = await runFrictionGate(makeEvent("document_submitted", { claimText: "Hi" }));
    expect(r.shouldProcess).toBe(false); expect(r.reason).toBe("missing_document_id");
  });
  it("rejects verdict_complete without claimId", async () => {
    const r = await runFrictionGate(makeEvent("verdict_complete", { verdict: "Supported" }));
    expect(r.shouldProcess).toBe(false); expect(r.reason).toBe("missing_claim_id_or_verdict");
  });
  it("rejects verdict_complete without verdict", async () => {
    const r = await runFrictionGate(makeEvent("verdict_complete", { claimId: 1 }));
    expect(r.shouldProcess).toBe(false); expect(r.reason).toBe("missing_claim_id_or_verdict");
  });
  it("accepts verdict_complete with both claimId and verdict", async () => {
    const r = await runFrictionGate(makeEvent("verdict_complete", { claimId: 1, verdict: "Supported" }));
    expect(r.shouldProcess).toBe(true); expect(r.actions[0].priority).toBe(10);
  });
  it("rejects contradiction_found without claimId", async () => {
    const r = await runFrictionGate(makeEvent("contradiction_found", { other: "data" }));
    expect(r.shouldProcess).toBe(false); expect(r.reason).toBe("missing_claim_id");
  });
  it("accepts contradiction_found with claimId and sets priority 60", async () => {
    const r = await runFrictionGate(makeEvent("contradiction_found", { claimId: 5 }));
    expect(r.shouldProcess).toBe(true); expect(r.actions[0].priority).toBe(60);
  });
  it("always accepts scheduled_tick with any non-empty payload", async () => {
    const r = await runFrictionGate(makeEvent("scheduled_tick", { tick: 1 }));
    expect(r.shouldProcess).toBe(true); expect(r.actions[0].priority).toBe(5);
  });
  it("passes through unknown event types with any non-empty payload", async () => {
    const r = await runFrictionGate(makeEvent("paper_discovered", { paperId: "PMC123" }));
    expect(r.shouldProcess).toBe(true); expect(r.actions).toHaveLength(1);
  });
  it("always returns an actions array", async () => {
    const r = await runFrictionGate(makeEvent("document_submitted", {}));
    expect(Array.isArray(r.actions)).toBe(true);
  });
});
