/**
 * openfda_maude.test.ts
 * Unit tests for server/verticalAdapters/openfda_maude.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("openfdaMaudeAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'openfda_maude'", async () => {
    const { registry } = await import("./types");
    await import("./openfda_maude");
    expect(registry.get("openfda_maude")?.domainKey).toBe("openfda_maude");
  });

  it("returns found=true when API returns a valid hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            mdr_report_key: "12345678",
            date_received: "2022-06-15",
            device: [
              { brand_name: "MiniMed 770G", generic_name: "INSULIN PUMP" },
            ],
            patient: [{ sequence_number_outcome: ["INJURY"] }],
            event_type: "IN",
          },
        ],
        meta: { results: { total: 1 } },
      }),
    });
    const { registry } = await import("./types");
    await import("./openfda_maude");
    const adapter = registry.get("openfda_maude");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Insulin pump malfunction caused patient injury in 2022",
      extractedValue: "insulin pump malfunction 2022",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when API returns empty results", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], meta: { results: { total: 0 } } }),
    });
    const { registry } = await import("./types");
    await import("./openfda_maude");
    const adapter = registry.get("openfda_maude");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Insulin pump malfunction caused patient injury in 2022",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { registry } = await import("./types");
    await import("./openfda_maude");
    const adapter = registry.get("openfda_maude");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Insulin pump malfunction caused patient injury in 2022",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./openfda_maude");
    const adapter = registry.get("openfda_maude");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Insulin pump malfunction caused patient injury in 2022",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
