/**
 * verticalAdapters/types.test.ts
 * Unit tests for server/verticalAdapters/types.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import { registry, registerVertical, getVertical, listVerticals } from "./types";
import type { VerticalAdapter, EvidenceResult } from "./types";

const makeAdapter = (domainKey: string): VerticalAdapter => ({
  domainKey,
  displayName: `Test ${domainKey}`,
  description: `Test adapter for ${domainKey}`,
  claimExtractorPrompt: "Extract claims",
  discoverySearchTerms: ["term1", "term2"],
  lookupEvidence: async (_claim): Promise<EvidenceResult> => ({
    found: true,
    sourceId: "src-1",
    sourceUrl: "https://example.com",
    evidenceRaw: { test: true },
    confidenceScore: 0.9,
    confidenceFlags: [],
  }),
});

describe("verticalAdapters registry", () => {
  beforeEach(() => {
    // Clean up any test adapters added in previous tests
    registry.delete("test_domain_a");
    registry.delete("test_domain_b");
    registry.delete("test_domain_c");
  });

  it("registerVertical() adds adapter to registry", () => {
    const adapter = makeAdapter("test_domain_a");
    registerVertical(adapter);
    expect(registry.has("test_domain_a")).toBe(true);
  });

  it("getVertical() returns the registered adapter", () => {
    const adapter = makeAdapter("test_domain_b");
    registerVertical(adapter);
    const retrieved = getVertical("test_domain_b");
    expect(retrieved).toBe(adapter);
    expect(retrieved?.domainKey).toBe("test_domain_b");
  });

  it("getVertical() returns undefined for unknown domain", () => {
    expect(getVertical("nonexistent_domain_xyz")).toBeUndefined();
  });

  it("listVerticals() returns all registered adapters", () => {
    const adapter = makeAdapter("test_domain_c");
    registerVertical(adapter);
    const all = listVerticals();
    expect(all.some((a) => a.domainKey === "test_domain_c")).toBe(true);
  });

  it("EvidenceResult has correct shape", async () => {
    const adapter = makeAdapter("test_domain_a");
    registerVertical(adapter);
    const result = await adapter.lookupEvidence({ claimText: "test claim", extractedValue: null });
    expect(result).toMatchObject({
      found: expect.any(Boolean),
      confidenceScore: expect.any(Number),
      confidenceFlags: expect.any(Array),
    });
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("VerticalAdapter has required fields", () => {
    const adapter = makeAdapter("test_domain_a");
    expect(adapter.domainKey).toBeDefined();
    expect(adapter.displayName).toBeDefined();
    expect(adapter.description).toBeDefined();
    expect(adapter.claimExtractorPrompt).toBeDefined();
    expect(adapter.discoverySearchTerms).toBeInstanceOf(Array);
    expect(typeof adapter.lookupEvidence).toBe("function");
  });
});
