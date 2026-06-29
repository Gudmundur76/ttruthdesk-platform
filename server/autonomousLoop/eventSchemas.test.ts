/**
 * eventSchemas.test.ts
 * Unit tests for autonomousLoop/eventSchemas.ts
 *
 * PRD-MASTER FR-MASTER-03: Event envelope + Zod payload schema validation
 */
import { describe, it, expect } from "vitest";
import {
  createEnvelope,
  validateEventPayload,
  EVENT_PAYLOAD_SCHEMAS,
  DEFAULT_TTL_MS,
  SourceLayerEnum,
  type ExtendedLoopEventType,
} from "./eventSchemas";

// ─── createEnvelope ───────────────────────────────────────────────────────────

describe("createEnvelope()", () => {
  it("returns an envelope with all required fields", () => {
    const env = createEnvelope("L1_TRUTH");
    expect(env.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(env.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(env.sourceLayer).toBe("L1_TRUTH");
    expect(typeof env.ttl).toBe("number");
    expect(env.ttl).toBeGreaterThan(Date.now());
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("generates unique eventIds on each call", () => {
    const a = createEnvelope("SYSTEM");
    const b = createEnvelope("SYSTEM");
    expect(a.eventId).not.toBe(b.eventId);
  });

  it("uses provided correlationId when given", () => {
    const corrId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const env = createEnvelope("ORCHESTRATOR", corrId);
    expect(env.correlationId).toBe(corrId);
  });

  it("generates a new correlationId when not provided", () => {
    const env = createEnvelope("API");
    expect(env.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("sets TTL to approximately now + DEFAULT_TTL_MS", () => {
    const before = Date.now();
    const env = createEnvelope("L5_DREAM");
    const after = Date.now();
    expect(env.ttl).toBeGreaterThanOrEqual(before + DEFAULT_TTL_MS);
    expect(env.ttl).toBeLessThanOrEqual(after + DEFAULT_TTL_MS + 100);
  });
});

// ─── DEFAULT_TTL_MS ───────────────────────────────────────────────────────────

describe("DEFAULT_TTL_MS", () => {
  it("is 7 days in milliseconds", () => {
    expect(DEFAULT_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

// ─── SourceLayerEnum ──────────────────────────────────────────────────────────

describe("SourceLayerEnum", () => {
  it("accepts all valid source layers", () => {
    const validLayers = [
      "L0_FRICTION",
      "L1_TRUTH",
      "L2_SELF_PROMPT",
      "L3_FRONTIER",
      "L4_META",
      "L5_DREAM",
      "ORCHESTRATOR",
      "SYSTEM",
      "API",
    ];
    for (const layer of validLayers) {
      expect(SourceLayerEnum.safeParse(layer).success, `${layer} should be valid`).toBe(true);
    }
  });

  it("rejects unknown source layers", () => {
    expect(SourceLayerEnum.safeParse("L6_UNKNOWN").success).toBe(false);
    expect(SourceLayerEnum.safeParse("").success).toBe(false);
  });
});

// ─── EVENT_PAYLOAD_SCHEMAS ────────────────────────────────────────────────────

describe("EVENT_PAYLOAD_SCHEMAS", () => {
  it("has an entry for every ExtendedLoopEventType", () => {
    const expectedTypes: ExtendedLoopEventType[] = [
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
      "frontier_directive",
      "frontier_complete",
      "dream_session_request",
      "dream_session_approved",
      "dream_complete",
    ];
    for (const type of expectedTypes) {
      expect(EVENT_PAYLOAD_SCHEMAS[type], `Missing schema for ${type}`).toBeDefined();
    }
  });
});

// ─── validateEventPayload ─────────────────────────────────────────────────────

describe("validateEventPayload()", () => {
  it("passes for a valid document_submitted payload", () => {
    expect(() =>
      validateEventPayload("document_submitted", { documentId: 42 })
    ).not.toThrow();
  });

  it("throws SCHEMA_VALIDATION_ERROR for invalid document_submitted payload", () => {
    expect(() =>
      validateEventPayload("document_submitted", { documentId: -1 })
    ).toThrow("SCHEMA_VALIDATION_ERROR");
  });

  it("passes for a valid verdict_complete payload", () => {
    expect(() =>
      validateEventPayload("verdict_complete", {
        claimId: 1,
        documentId: 2,
        verdict: "Supported",
        confidenceScore: 0.85,
      })
    ).not.toThrow();
  });

  it("throws for verdict_complete missing required claimId", () => {
    expect(() =>
      validateEventPayload("verdict_complete", {
        documentId: 2,
        verdict: "Supported",
      })
    ).toThrow("SCHEMA_VALIDATION_ERROR");
  });

  it("passes for a valid system_health_change payload", () => {
    expect(() =>
      validateEventPayload("system_health_change", {
        component: "db",
        newStatus: "degraded",
      })
    ).not.toThrow();
  });

  it("passes for a valid dream_pattern_detected payload", () => {
    expect(() =>
      validateEventPayload("dream_pattern_detected", {
        patternType: "convergence",
        strength: 0.7,
      })
    ).not.toThrow();
  });

  it("throws for dream_pattern_detected missing required patternType", () => {
    expect(() =>
      validateEventPayload("dream_pattern_detected", { strength: 0.5 })
    ).toThrow("SCHEMA_VALIDATION_ERROR");
  });

  it("passes for a valid paper_discovered payload with optional fields", () => {
    expect(() =>
      validateEventPayload("paper_discovered", {
        title: "HIV Protease Inhibitor Study",
        pmid: "12345678",
        source: "pubmed",
      })
    ).not.toThrow();
  });

  it("passes for scheduled_tick with empty payload (all fields optional)", () => {
    expect(() =>
      validateEventPayload("scheduled_tick", {})
    ).not.toThrow();
  });

  it("passes for a valid frontier_directive payload", () => {
    expect(() =>
      validateEventPayload("frontier_directive", {
        directiveId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        triggerReason: "gap_detected",
        targetGapIds: ["gap-1", "gap-2"],
      })
    ).not.toThrow();
  });

  it("throws for frontier_directive with invalid triggerReason", () => {
    expect(() =>
      validateEventPayload("frontier_directive", {
        directiveId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        triggerReason: "unknown_reason",
        targetGapIds: [],
      })
    ).toThrow("SCHEMA_VALIDATION_ERROR");
  });

  it("passes for a valid coverage_gap payload", () => {
    expect(() =>
      validateEventPayload("coverage_gap", {
        gapId: "gap-xyz",
        gapType: "missing_evidence",
        priority: 5,
      })
    ).not.toThrow();
  });

  it("throws for coverage_gap with out-of-range priority", () => {
    expect(() =>
      validateEventPayload("coverage_gap", {
        gapId: "gap-xyz",
        priority: 11,
      })
    ).toThrow("SCHEMA_VALIDATION_ERROR");
  });

  it("throws for confidence_review_needed with out-of-range currentConfidence", () => {
    expect(() =>
      validateEventPayload("confidence_review_needed", {
        claimId: 1,
        currentConfidence: 1.5,
      })
    ).toThrow("SCHEMA_VALIDATION_ERROR");
  });
});
