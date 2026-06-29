/**
 * us_code.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("usCodeAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'us_code'", async () => {
    const { registry } = await import("./types");
    await import("./us_code");
    expect(registry.get("us_code")?.domainKey).toBe("us_code");
  });

  it("returns found=true when OLRC returns a valid JSON result", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        results: [
          {
            identifier: "42 USC 1983",
            label: "Civil action for deprivation of rights",
            content: "Every person who, under color of any statute...",
            url: "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42-section1983",
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./us_code");
    const adapter = registry.get("us_code");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "The Clean Air Act requires EPA to set air quality standards",
      extractedValue: "Clean Air Act EPA air quality standards",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=true even when response is non-JSON (structured reference fallback)", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "text/html" },
      text: async () => "<html>US Code search results</html>",
    });
    const { registry } = await import("./types");
    await import("./us_code");
    const adapter = registry.get("us_code");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "The Clean Air Act requires EPA to set air quality standards",
      extractedValue: null,
    });
    // Non-JSON triggers structured reference fallback → found:true
    expect(result.found).toBe(true);
  });

  it("returns found=true with structured reference when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const { registry } = await import("./types");
    await import("./us_code");
    const adapter = registry.get("us_code");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "US federal law claim",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("us_code_reference");
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./us_code");
    const adapter = registry.get("us_code");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "US federal law claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
