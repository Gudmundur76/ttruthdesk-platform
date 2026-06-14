/**
 * ietf_rfc.test.ts
 * Unit tests for server/verticalAdapters/ietf_rfc.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("IETF_RFC_ADAPTER", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'ietf_rfc'", async () => {
    const { registry } = await import("./types");
    await import("./ietf_rfc");
    const adapter = registry.get("ietf_rfc");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("ietf_rfc");
  });

  it("returns found=false when no RFC number in claimText", async () => {
    const { registry } = await import("./types");
    await import("./ietf_rfc");
    const adapter = registry.get("ietf_rfc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "HTTP is a stateless protocol",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_rfc_number_found");
  });

  it("returns found=true when RFC editor returns items", async () => {
    // First fetch: rfc-editor.org
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            doc_id: "2616",
            current_status: "Proposed Standard",
            title: "Hypertext Transfer Protocol -- HTTP/1.1",
          },
        ],
      }),
    });
    // Second fetch: semantic scholar
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ citationCount: 5000 }],
      }),
    });
    const { registry } = await import("./types");
    await import("./ietf_rfc");
    const adapter = registry.get("ietf_rfc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to RFC 2616, HTTP is stateless",
      extractedValue: "2616",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when RFC editor returns no items", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    });
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });
    const { registry } = await import("./types");
    await import("./ietf_rfc");
    const adapter = registry.get("ietf_rfc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to RFC 99999, some protocol works",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./ietf_rfc");
    const adapter = registry.get("ietf_rfc");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to RFC 2616, HTTP is stateless",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
