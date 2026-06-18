/**
 * routingTable.test.ts — Tests for PRD-MASTER Phase 2 routing table.
 */
import { describe, it, expect } from "vitest";
import {
  ROUTING_TABLE,
  getRoute,
  getEventsForLayer,
  validateRoutingTable,
} from "./routingTable";

describe("ROUTING_TABLE", () => {
  it("contains all 31 LoopEventType entries", () => {
    expect(Object.keys(ROUTING_TABLE)).toHaveLength(31);
  });

  it("every entry has at least one layer", () => {
    for (const [type, entry] of Object.entries(ROUTING_TABLE)) {
      expect(entry.layers.length, `${type} has no layers`).toBeGreaterThan(0);
    }
  });

  it("every entry has a valid priority (1-5)", () => {
    for (const [type, entry] of Object.entries(ROUTING_TABLE)) {
      expect([1, 2, 3, 4, 5], `${type} has invalid priority`).toContain(entry.priority);
    }
  });

  it("every entry has a description", () => {
    for (const [type, entry] of Object.entries(ROUTING_TABLE)) {
      expect(entry.description, `${type} has no description`).toBeTruthy();
    }
  });

  it("coverage_gap routes through L2 and L3", () => {
    expect(ROUTING_TABLE["coverage_gap"].layers).toContain("L2");
    expect(ROUTING_TABLE["coverage_gap"].layers).toContain("L3");
  });

  it("system_health_change has priority 1 (highest)", () => {
    expect(ROUTING_TABLE["system_health_change"].priority).toBe(1);
  });

  it("dream_session_complete has priority 5 (lowest)", () => {
    expect(ROUTING_TABLE["dream_session_complete"].priority).toBe(5);
  });
});

describe("getRoute", () => {
  it("returns the correct route for a known event type", () => {
    const route = getRoute("document_submitted");
    expect(route).toBeDefined();
    expect(route!.layers).toContain("L0");
  });

  it("returns undefined for an unknown event type", () => {
    const route = getRoute("unknown_event" as never);
    expect(route).toBeUndefined();
  });
});

describe("getEventsForLayer", () => {
  it("returns events for L0", () => {
    const events = getEventsForLayer("L0");
    expect(events).toContain("document_submitted");
    expect(events).toContain("scheduled_tick");
  });

  it("returns events for L4", () => {
    const events = getEventsForLayer("L4");
    expect(events).toContain("system_health_change");
    expect(events).toContain("system_capability_required");
  });

  it("returns empty array for unknown layer", () => {
    const events = getEventsForLayer("L99");
    expect(events).toHaveLength(0);
  });
});

describe("validateRoutingTable", () => {
  it("returns valid: true for the production routing table", () => {
    const result = validateRoutingTable();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
