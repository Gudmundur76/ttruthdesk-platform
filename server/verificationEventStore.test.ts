/**
 * verificationEventStore.test.ts
 *
 * Tests for the in-memory verification.completed event store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  verificationEventStore,
  type VerificationCompletedEvent,
} from "./verificationEventStore";

function makeEvent(
  overrides: Partial<VerificationCompletedEvent> = {}
): VerificationCompletedEvent {
  return {
    inputId: "test-input-id",
    verdict: "Supported",
    adapter: "pubmed",
    confidence: 0.9,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("verificationEventStore", () => {
  beforeEach(() => {
    verificationEventStore.clear();
  });

  it("stores a pushed event", () => {
    verificationEventStore.push(makeEvent());
    expect(verificationEventStore.getAll()).toHaveLength(1);
  });

  it("getSummary counts verdicts correctly", () => {
    verificationEventStore.push(makeEvent({ verdict: "Supported" }));
    verificationEventStore.push(makeEvent({ verdict: "Partially Supported" }));
    verificationEventStore.push(makeEvent({ verdict: "Contradicted" }));
    verificationEventStore.push(makeEvent({ verdict: "Ambiguous" }));
    verificationEventStore.push(
      makeEvent({ verdict: "Insufficient Evidence" })
    );
    verificationEventStore.push(makeEvent({ verdict: "Out of Scope" }));

    const summary = verificationEventStore.getSummary();
    expect(summary.totalVerifications).toBe(6);
    expect(summary.supportedCount).toBe(2);
    expect(summary.contradictedCount).toBe(1);
    expect(summary.ambiguousCount).toBe(1);
    expect(summary.insufficientEvidenceCount).toBe(1);
    expect(summary.otherCount).toBe(1);
  });

  it("getSummary computes avgConfidence", () => {
    verificationEventStore.push(makeEvent({ confidence: 0.8 }));
    verificationEventStore.push(makeEvent({ confidence: 0.6 }));
    const summary = verificationEventStore.getSummary();
    expect(summary.avgConfidence).toBeCloseTo(0.7, 5);
  });

  it("getSummary returns lastVerifiedAt from most recent event", () => {
    const ts = "2026-06-20T10:00:00.000Z";
    verificationEventStore.push(
      makeEvent({ timestamp: "2026-06-20T09:00:00.000Z" })
    );
    verificationEventStore.push(makeEvent({ timestamp: ts }));
    const summary = verificationEventStore.getSummary();
    expect(summary.lastVerifiedAt).toBe(ts);
  });

  it("getSummary returns empty summary when no events", () => {
    const summary = verificationEventStore.getSummary();
    expect(summary.totalVerifications).toBe(0);
    expect(summary.lastVerifiedAt).toBeNull();
    expect(summary.avgConfidence).toBe(0);
  });

  it("getSummary respects windowMs and excludes old events", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    verificationEventStore.push(makeEvent({ timestamp: old }));
    verificationEventStore.push(
      makeEvent({ timestamp: new Date().toISOString() })
    );
    // 24h window — old event excluded
    const summary = verificationEventStore.getSummary(24 * 60 * 60 * 1000);
    expect(summary.totalVerifications).toBe(1);
  });

  it("recentEvents is capped at 50", () => {
    for (let i = 0; i < 60; i++) {
      verificationEventStore.push(makeEvent());
    }
    const summary = verificationEventStore.getSummary();
    expect(summary.recentEvents.length).toBeLessThanOrEqual(50);
  });
});
