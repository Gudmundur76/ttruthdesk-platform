/**
 * ssrn.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("ssrnAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'ssrn'", async () => {
    const { registry } = await import("./types");
    await import("./ssrn");
    expect(registry.get("ssrn")?.domainKey).toBe("ssrn");
  });

  it("returns found=true when CrossRef returns an SSRN DOI hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [
            {
              DOI: "10.2139/ssrn.1234567",
              title: ["Labor Market Dynamics"],
              author: [{ given: "John", family: "Smith" }],
              "container-title": ["SSRN"],
              published: { "date-parts": [[2023]] },
              abstract: "Labor market analysis.",
              URL: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1234567",
              score: 12.5,
              type: "posted-content",
            },
          ],
          "total-results": 1,
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./ssrn");
    const adapter = registry.get("ssrn");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Labor market dynamics in the US",
      extractedValue: "labor market dynamics",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("falls back to SemanticScholar when CrossRef returns no SSRN DOIs", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [{ DOI: "10.1000/xyz123", title: ["Other paper"] }],
          "total-results": 1,
        },
      }),
    });
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            paperId: "abc123",
            title: "Labor Market Paper",
            abstract: "Labor market dynamics analysis",
            year: 2022,
            authors: [{ name: "Jane Doe" }],
            externalIds: { SSRN: "4567890" },
            venue: "SSRN",
            url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4567890",
          },
        ],
        total: 1,
      }),
    });
    const { registry } = await import("./types");
    await import("./ssrn");
    const adapter = registry.get("ssrn");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Labor market dynamics",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
  });

  it("returns found=false when both CrossRef and SemanticScholar return no results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { items: [], "total-results": 0 } }),
    });
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0 }),
    });
    const { registry } = await import("./types");
    await import("./ssrn");
    const adapter = registry.get("ssrn");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Unknown obscure topic",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./ssrn");
    const adapter = registry.get("ssrn");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
