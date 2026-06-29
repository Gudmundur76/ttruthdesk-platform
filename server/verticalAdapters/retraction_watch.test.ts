/**
 * retraction_watch.test.ts
 * Unit tests for server/verticalAdapters/retraction_watch.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("retractionWatchAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'retraction_watch'", async () => {
    const { registry } = await import("./types");
    await import("./retraction_watch");
    expect(registry.get("retraction_watch")?.domainKey).toBe(
      "retraction_watch"
    );
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          OriginalPaperDOI: "10.1016/S0140-6736(20)31180-6",
          RetractionDOI: "10.1016/S0140-6736(20)31324-6",
          Title:
            "Hydroxychloroquine or chloroquine with or without a macrolide",
          Author: "Mehra MR",
          Journal: "The Lancet",
          RetractionDate: "2020-06-04",
          Reason: "Data concerns",
        },
      ],
    });
    const { registry } = await import("./types");
    await import("./retraction_watch");
    const adapter = registry.get("retraction_watch");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "The Surgisphere COVID-19 study was retracted due to data fraud",
      extractedValue: "Surgisphere COVID-19 retraction",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    const { registry } = await import("./types");
    await import("./retraction_watch");
    const adapter = registry.get("retraction_watch");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "The Surgisphere COVID-19 study was retracted due to data fraud",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./retraction_watch");
    const adapter = registry.get("retraction_watch");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "The Surgisphere COVID-19 study was retracted due to data fraud",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./retraction_watch");
    const adapter = registry.get("retraction_watch");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "The Surgisphere COVID-19 study was retracted due to data fraud",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
