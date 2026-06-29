/**
 * entryPointContracts.test.ts
 * Unit tests for autonomousLoop/entryPointContracts.ts
 *
 * PRD-MASTER Phase 3: Layer entry-point contracts
 */
import { describe, it, expect } from "vitest";
import {
  LAYER_CONTRACTS,
  getLayerContract,
  layerAcceptsEvent,
  validateLayerContracts,
} from "./entryPointContracts";

describe("LAYER_CONTRACTS", () => {
  it("defines all 6 autonomous loop layers (L0–L5)", () => {
    expect(Object.keys(LAYER_CONTRACTS)).toHaveLength(6);
    for (const id of ["L0", "L1", "L2", "L3", "L4", "L5"]) {
      expect(LAYER_CONTRACTS[id], `Missing contract for ${id}`).toBeDefined();
    }
  });

  it("every contract has a non-empty layerId matching its key", () => {
    for (const [id, contract] of Object.entries(LAYER_CONTRACTS)) {
      expect(contract.layerId).toBe(id);
    }
  });

  it("every contract has a non-empty name", () => {
    for (const [id, contract] of Object.entries(LAYER_CONTRACTS)) {
      expect(contract.name, `${id} has no name`).toBeTruthy();
    }
  });

  it("every contract accepts at least one event", () => {
    for (const [id, contract] of Object.entries(LAYER_CONTRACTS)) {
      expect(
        contract.acceptedEvents.length,
        `${id} accepts no events`
      ).toBeGreaterThan(0);
    }
  });

  it("every contract emits at least one event", () => {
    for (const [id, contract] of Object.entries(LAYER_CONTRACTS)) {
      expect(
        contract.emittedEvents.length,
        `${id} emits no events`
      ).toBeGreaterThan(0);
    }
  });

  it("every contract has a positive maxDurationMs", () => {
    for (const [id, contract] of Object.entries(LAYER_CONTRACTS)) {
      expect(
        contract.maxDurationMs,
        `${id} has invalid maxDurationMs`
      ).toBeGreaterThan(0);
    }
  });

  it("L5 (DreamLayer) has the longest maxDurationMs (300s)", () => {
    expect(LAYER_CONTRACTS["L5"].maxDurationMs).toBe(300_000);
  });

  it("L0 (FrictionLayer) is not parallel-safe", () => {
    expect(LAYER_CONTRACTS["L0"].parallelSafe).toBe(false);
  });

  it("L1 (TruthLayer) is parallel-safe", () => {
    expect(LAYER_CONTRACTS["L1"].parallelSafe).toBe(true);
  });

  it("L4 (MetaAgentLayer) accepts stub_escalated event", () => {
    expect(LAYER_CONTRACTS["L4"].acceptedEvents).toContain("stub_escalated");
  });

  it("L1 (TruthLayer) requires documentId context", () => {
    expect(LAYER_CONTRACTS["L1"].requiredContext).toContain("documentId");
  });

  it("L5 (DreamLayer) accepts dream_pattern_detected and dream_cycle_started", () => {
    expect(LAYER_CONTRACTS["L5"].acceptedEvents).toContain("dream_pattern_detected");
    expect(LAYER_CONTRACTS["L5"].acceptedEvents).toContain("dream_cycle_started");
  });
});

describe("getLayerContract()", () => {
  it("returns the correct contract for a known layer", () => {
    const contract = getLayerContract("L3");
    expect(contract).toBeDefined();
    expect(contract!.name).toBe("FrontierLayer");
  });

  it("returns undefined for an unknown layer", () => {
    const contract = getLayerContract("L99");
    expect(contract).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    const contract = getLayerContract("");
    expect(contract).toBeUndefined();
  });
});

describe("layerAcceptsEvent()", () => {
  it("returns true when the layer accepts the event", () => {
    expect(layerAcceptsEvent("L0", "document_submitted")).toBe(true);
    expect(layerAcceptsEvent("L1", "paper_discovered")).toBe(true);
    expect(layerAcceptsEvent("L2", "verdict_complete")).toBe(true);
    expect(layerAcceptsEvent("L3", "frontier_search_requested")).toBe(true);
    expect(layerAcceptsEvent("L4", "system_health_change")).toBe(true);
    expect(layerAcceptsEvent("L5", "dream_cycle_started")).toBe(true);
  });

  it("returns false when the layer does not accept the event", () => {
    expect(layerAcceptsEvent("L0", "dream_cycle_started")).toBe(false);
    expect(layerAcceptsEvent("L5", "document_submitted")).toBe(false);
  });

  it("returns false for an unknown layer", () => {
    expect(layerAcceptsEvent("L99", "document_submitted")).toBe(false);
  });
});

describe("validateLayerContracts()", () => {
  it("returns valid: true for the production LAYER_CONTRACTS", () => {
    const result = validateLayerContracts();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
