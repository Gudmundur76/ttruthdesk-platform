/**
 * who_iris.test.ts
 * Unit tests for server/verticalAdapters/who_iris.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("whoIrisAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'who_iris'", async () => {
    const { registry } = await import("./types");
    await import("./who_iris");
    expect(registry.get("who_iris")?.domainKey).toBe("who_iris");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _embedded: {
          searchResult: {
            _embedded: {
              objects: [
                {
                  indexableObject: {
                    handle: "10665/337001",
                    metadata: {
                      "dc.title": [
                        { value: "WHO guidelines on physical activity" },
                      ],
                      "dc.description.abstract": [
                        {
                          value:
                            "Adults should do at least 150 minutes of moderate-intensity physical activity.",
                        },
                      ],
                      "dc.identifier.uri": [
                        { value: "https://iris.who.int/handle/10665/337001" },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./who_iris");
    const adapter = registry.get("who_iris");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "WHO recommends 150 minutes of moderate physical activity per week",
      extractedValue: "WHO physical activity recommendation",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _embedded: { searchResult: { _embedded: { objects: [] } } },
      }),
    });
    const { registry } = await import("./types");
    await import("./who_iris");
    const adapter = registry.get("who_iris");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "WHO recommends 150 minutes of moderate physical activity per week",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./who_iris");
    const adapter = registry.get("who_iris");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "WHO recommends 150 minutes of moderate physical activity per week",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./who_iris");
    const adapter = registry.get("who_iris");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "WHO recommends 150 minutes of moderate physical activity per week",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
