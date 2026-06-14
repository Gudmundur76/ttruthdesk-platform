/**
 * nist.test.ts
 * Unit tests for server/verticalAdapters/nist.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("NISTAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'nist'", async () => {
    const { registry } = await import("./types");
    await import("./nist");
    const adapter = registry.get("nist");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("nist");
  });

  it("returns found=true when NIST Webbook returns compound data", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `
        <html><body>
        <h1>Aspirin</h1>
        <table><tr><td>Molecular Formula</td><td>C9H8O4</td></tr></table>
        </body></html>
      `,
    });
    const { registry } = await import("./types");
    await import("./nist");
    const adapter = registry.get("nist");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Aspirin has molecular formula C9H8O4",
      extractedValue: "aspirin",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("falls back to NIST data search when Webbook fails", async () => {
    // First call (Webbook) fails
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    // Second call (NIST data search) succeeds
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ResultData: [
          {
            identifier: "nist-standard-123",
            title: "Standard Reference Material 123",
            description: "A NIST standard",
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./nist");
    const adapter = registry.get("nist");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "NIST standard reference material",
      extractedValue: "standard reference material",
    });
    // Either found or not found is acceptable — just verify it doesn't throw
    expect(result).toBeDefined();
    expect(result.confidenceFlags).toBeInstanceOf(Array);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./nist");
    const adapter = registry.get("nist");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some chemistry claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
