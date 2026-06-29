/**
 * apa_psycarticles.test.ts
 * Unit tests for server/verticalAdapters/apa_psycarticles.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("apaPsycarticlesAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'apa_psycarticles'", async () => {
    const { registry } = await import("./types");
    await import("./apa_psycarticles");
    expect(registry.get("apa_psycarticles")?.domainKey).toBe(
      "apa_psycarticles"
    );
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          items: [
            {
              DOI: "10.1037/a0012345",
              title: ["CBT for Depression"],
              author: [{ given: "Alice", family: "Brown" }],
              "container-title": [
                "Journal of Consulting and Clinical Psychology",
              ],
              published: { "date-parts": [[2022]] },
              abstract: "CBT is effective for depression.",
              URL: "https://doi.org/10.1037/a0012345",
              score: 15.2,
            },
          ],
          "total-results": 1,
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./apa_psycarticles");
    const adapter = registry.get("apa_psycarticles");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Cognitive behavioral therapy is effective for treating depression",
      extractedValue: "CBT depression treatment",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: { items: [], "total-results": 0 } }),
    });
    const { registry } = await import("./types");
    await import("./apa_psycarticles");
    const adapter = registry.get("apa_psycarticles");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Cognitive behavioral therapy is effective for treating depression",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./apa_psycarticles");
    const adapter = registry.get("apa_psycarticles");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Cognitive behavioral therapy is effective for treating depression",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./apa_psycarticles");
    const adapter = registry.get("apa_psycarticles");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "Cognitive behavioral therapy is effective for treating depression",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
