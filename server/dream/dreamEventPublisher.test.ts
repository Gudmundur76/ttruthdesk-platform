/**
 * dreamEventPublisher.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for L5 DreamEvent publisher — wake protocol, DreamEvent classification,
 * priority weights, and dream_event_queue writer.
 *
 * Covers T059-T065:
 *   T059: getDreamPriorityWeight returns correct weights
 *   T060: alert and recalibrate have highest priority weight
 *   T061: consolidate has lowest priority weight
 *   T062: executeWakeProtocol returns WakeProtocolResult
 *   T063: wake protocol with null inputs returns empty events
 *   T064: wake protocol classifies consolidation finding into DreamEvent
 *   T065: wake protocol aggregateRiskLevel is low when no high-priority events
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: mockGetDb }));

import {
  getDreamPriorityWeight,
  executeWakeProtocol,
  type WakeProtocolInput,
} from "./dreamEventPublisher";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeDb() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue([]);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.values = vi.fn().mockResolvedValue([{ insertId: 1 }]);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.execute = vi.fn().mockResolvedValue([[]]);
  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
    execute: vi.fn().mockResolvedValue([[]]),
  };
}

// ─── T059-T061: Priority weight tests ────────────────────────────────────────

describe("dreamEventPublisher — getDreamPriorityWeight (T059-T061)", () => {
  it("T059: returns a number for all known priority levels", () => {
    expect(typeof getDreamPriorityWeight("recalibrate")).toBe("number");
    expect(typeof getDreamPriorityWeight("alert")).toBe("number");
    expect(typeof getDreamPriorityWeight("hypothesize")).toBe("number");
    expect(typeof getDreamPriorityWeight("consolidate")).toBe("number");
  });

  it("T060: alert and recalibrate have the highest priority weight", () => {
    const alertWeight = getDreamPriorityWeight("alert");
    const recalibrateWeight = getDreamPriorityWeight("recalibrate");
    const hypothesizeWeight = getDreamPriorityWeight("hypothesize");
    const consolidateWeight = getDreamPriorityWeight("consolidate");
    expect(alertWeight).toBeGreaterThanOrEqual(hypothesizeWeight);
    expect(recalibrateWeight).toBeGreaterThanOrEqual(hypothesizeWeight);
    expect(alertWeight).toBeGreaterThanOrEqual(consolidateWeight);
    expect(recalibrateWeight).toBeGreaterThanOrEqual(consolidateWeight);
  });

  it("T061: consolidate has the lowest priority weight", () => {
    const consolidateWeight = getDreamPriorityWeight("consolidate");
    expect(consolidateWeight).toBeLessThanOrEqual(getDreamPriorityWeight("hypothesize"));
    expect(consolidateWeight).toBeLessThanOrEqual(getDreamPriorityWeight("alert"));
    expect(consolidateWeight).toBeLessThanOrEqual(getDreamPriorityWeight("recalibrate"));
  });

  it("returns fallback weight for unknown priority", () => {
    const weight = getDreamPriorityWeight("unknown_priority");
    expect(typeof weight).toBe("number");
    expect(weight).toBeGreaterThan(0);
  });
});

// ─── T062-T065: Wake protocol tests ──────────────────────────────────────────

describe("dreamEventPublisher — executeWakeProtocol (T062-T065)", () => {
  beforeEach(() => {
    mockGetDb.mockResolvedValue(makeDb());
  });

  const baseInput: WakeProtocolInput = {
    sessionId: 42,
    consolidation: null,
    patterns: null,
    hypotheses: null,
    recalibration: null,
    simulation: null,
  };

  it("T062: returns a WakeProtocolResult with required fields", async () => {
    const result = await executeWakeProtocol(baseInput);
    expect(result).toHaveProperty("eventsPublished");
    expect(result).toHaveProperty("aggregateRiskLevel");
    expect(result).toHaveProperty("recommendedFollowUpActions");
    expect(Array.isArray(result.eventsPublished)).toBe(true);
    expect(Array.isArray(result.recommendedFollowUpActions)).toBe(true);
  });

  it("T063: wake protocol with all null inputs returns empty eventsPublished", async () => {
    const result = await executeWakeProtocol(baseInput);
    expect(result.eventsPublished).toHaveLength(0);
  });

  it("T064: wake protocol classifies consolidation finding into a DreamEvent", async () => {
    const input: WakeProtocolInput = {
      ...baseInput,
      consolidation: {
        orphanedEntityCount: 10,
        duplicateEdgeCount: 5,
        staleConfidenceCount: 2,
        totalOptimizations: 3,
        recommendations: [],
      },
    };
    const result = await executeWakeProtocol(input);
    expect(result.eventsPublished.length).toBeGreaterThan(0);
    const event = result.eventsPublished[0];
    expect(event).toHaveProperty("dreamPriority");
    expect(event).toHaveProperty("evidenceStrength");
    expect(event).toHaveProperty("dreamOrigin");
    expect(event.dreamOrigin).toBe(true);
    expect(event).toHaveProperty("cycleNumber");
  });

  it("T065: aggregateRiskLevel is low when no high-priority events", async () => {
    const result = await executeWakeProtocol(baseInput);
    expect(result.aggregateRiskLevel).toBe("low");
  });

  it("aggregateRiskLevel is high when simulation finds high-impact contradictions", async () => {
    // simulationStrength returns 0.85 when highRiskCount >= 2
    // highRiskCount counts scenarios where impactedClaimCount > 20 OR impactedEntityCount > 10
    const input: WakeProtocolInput = {
      ...baseInput,
      simulation: {
        scenarios: [
          { scenario: "Claim A contradicts Claim B", impactedClaimCount: 25, impactedEntityCount: 3, recommendation: "Review" },
          { scenario: "Claim C contradicts Claim D", impactedClaimCount: 30, impactedEntityCount: 2, recommendation: "Review" },
        ],
        totalSimulated: 2,
      },
    };
    const result = await executeWakeProtocol(input);
    // With 2 high-impact scenarios (impactedClaimCount > 20), simStrength = 0.85 → high
    expect(result.aggregateRiskLevel).toBe("high");
  });

  it("DreamEvent has evidenceStrength between 0 and 1", async () => {
    const input: WakeProtocolInput = {
      ...baseInput,
      patterns: {
        patterns: [
          { type: "contradiction_cluster", description: "Dense contradiction cluster", urgency: "high", entityIds: [1, 2, 3], evidence: "3 contradicting claims" },
          { type: "temporal_drift", description: "Temporal drift detected", urgency: "medium", entityIds: [4, 5], evidence: "Stale data" },
          { type: "evidence_desert", description: "Evidence desert", urgency: "low", entityIds: [6], evidence: "No supporting evidence" },
        ],
        totalFound: 3,
      },
    };
    const result = await executeWakeProtocol(input);
    for (const event of result.eventsPublished) {
      expect(event.evidenceStrength).toBeGreaterThanOrEqual(0);
      expect(event.evidenceStrength).toBeLessThanOrEqual(1);
    }
  });

  it("DreamEvent has sessionId matching input", async () => {
    const input: WakeProtocolInput = {
      ...baseInput,
      consolidation: {
        orphanedEntityCount: 5,
        duplicateEdgeCount: 2,
        staleConfidenceCount: 1,
        totalOptimizations: 0,
        recommendations: [],
      },
    };
    const result = await executeWakeProtocol(input);
    for (const event of result.eventsPublished) {
      expect(event.sessionId).toBe(42);
    }
  });
});
