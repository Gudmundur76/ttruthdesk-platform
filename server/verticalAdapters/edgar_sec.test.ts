/**
 * edgar_sec.test.ts
 * Unit tests for server/verticalAdapters/edgar_sec.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

describe("edgarSecAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'edgar_sec'", async () => {
    const { registry } = await import("./types");
    await import("./edgar_sec");
    const adapter = registry.get("edgar_sec");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("edgar_sec");
  });

  it("returns found=true when SEC search returns hits", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hits: {
          hits: [
            {
              _id: "0001234567-23-000001",
              _source: {
                fileNumber: "001-12345",
                link: "https://www.sec.gov/Archives/edgar/data/1234567/000123456723000001/",
                cik: "1234567",
                accessionNumber: "0001234567-23-000001",
                companyName: "Test Corp",
                formType: "10-K",
              },
            },
          ],
          total: { value: 1 },
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./edgar_sec");
    const adapter = registry.get("edgar_sec");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Test Corp reported revenue of $1 billion in 2022",
      extractedValue: "Test Corp revenue 2022",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when SEC search returns no hits", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hits: { hits: [], total: { value: 0 } },
      }),
    });
    const { registry } = await import("./types");
    await import("./edgar_sec");
    const adapter = registry.get("edgar_sec");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Unknown company reported some financial data",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found=false when SEC search returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });
    const { registry } = await import("./types");
    await import("./edgar_sec");
    const adapter = registry.get("edgar_sec");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some financial claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./edgar_sec");
    const adapter = registry.get("edgar_sec");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some financial claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
