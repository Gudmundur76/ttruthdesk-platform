/**
 * ipcc.test.ts
 * Unit tests for server/verticalAdapters/ipcc.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("ipccAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'ipcc'", async () => {
    const { registry } = await import("./types");
    await import("./ipcc");
    const adapter = registry.get("ipcc");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("ipcc");
  });

  it("returns found=true when CrossRef resolves an IPCC DOI (AR6 WG1 ref)", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          DOI: "10.1017/9781009157896",
          title: ["Climate Change 2021: The Physical Science Basis"],
          published: { "date-parts": [[2021]] },
          publisher: "Cambridge University Press",
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./ipcc");
    const adapter = registry.get("ipcc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to IPCC AR6 WG1, global temperatures have risen",
      extractedValue: "AR6 WG1",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.9);
  });

  it("returns found=false when CrossRef returns HTTP error for IPCC DOI", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    const { registry } = await import("./types");
    await import("./ipcc");
    const adapter = registry.get("ipcc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to IPCC AR6 WG1, temperatures rose",
      extractedValue: "AR6 WG1",
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when no IPCC report reference is found", async () => {
    const { registry } = await import("./types");
    await import("./ipcc");
    const adapter = registry.get("ipcc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some random climate claim without IPCC reference",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./ipcc");
    const adapter = registry.get("ipcc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "IPCC AR6 WG1 states global warming is occurring",
      extractedValue: "AR6 WG1",
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
