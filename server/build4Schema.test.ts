/**
 * build4Schema.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies that the 5 new schema tables added in Build 4 are properly defined
 * in drizzle/schema.ts and have the expected columns.
 *
 * Build 4 — closes DB audit gap (event_log, convergence_states,
 * preflight_scans, preflight_assumptions, preflight_constraints MISSING).
 */
import { describe, it, expect } from "vitest";
import {
  eventLog,
  convergenceStates,
  preflightScans,
  preflightAssumptions,
  preflightConstraints,
} from "../drizzle/schema";

describe("Build 4 — new schema tables", () => {
  describe("event_log table", () => {
    it("is defined (exported from schema)", () => {
      expect(eventLog).toBeDefined();
    });

    it("has all required columns", () => {
      const columns = Object.keys(eventLog);
      expect(columns).toContain("id");
      expect(columns).toContain("eventType");
      expect(columns).toContain("outcome");
      expect(columns).toContain("createdAt");
    });
  });

  describe("convergence_states table", () => {
    it("is defined (exported from schema)", () => {
      expect(convergenceStates).toBeDefined();
    });

    it("has all required columns", () => {
      const columns = Object.keys(convergenceStates);
      expect(columns).toContain("id");
      expect(columns).toContain("converged");
      expect(columns).toContain("pendingEvents");
      expect(columns).toContain("createdAt");
    });
  });

  describe("preflight_scans table", () => {
    it("is defined (exported from schema)", () => {
      expect(preflightScans).toBeDefined();
    });

    it("has all required columns", () => {
      const columns = Object.keys(preflightScans);
      expect(columns).toContain("id");
      expect(columns).toContain("inputHash");
      expect(columns).toContain("recommendedAction");
      expect(columns).toContain("cacheHit");
      expect(columns).toContain("assumptionCount");
      expect(columns).toContain("constraintCount");
    });
  });

  describe("preflight_assumptions table", () => {
    it("is defined (exported from schema)", () => {
      expect(preflightAssumptions).toBeDefined();
    });

    it("has all required columns", () => {
      const columns = Object.keys(preflightAssumptions);
      expect(columns).toContain("id");
      expect(columns).toContain("scanId");
      expect(columns).toContain("assumptionType");
      expect(columns).toContain("assumptionText");
      expect(columns).toContain("highRisk");
    });
  });

  describe("preflight_constraints table", () => {
    it("is defined (exported from schema)", () => {
      expect(preflightConstraints).toBeDefined();
    });

    it("has all required columns", () => {
      const columns = Object.keys(preflightConstraints);
      expect(columns).toContain("id");
      expect(columns).toContain("scanId");
      expect(columns).toContain("constraintType");
      expect(columns).toContain("constraintText");
      expect(columns).toContain("isHard");
    });
  });
});
