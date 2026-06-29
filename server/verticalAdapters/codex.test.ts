/**
 * codex.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("codexAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'codex'", async () => {
    const { registry } = await import("./types");
    await import("./codex");
    expect(registry.get("codex")?.domainKey).toBe("codex");
  });

  it("returns found=true when CODEX returns a valid document hit", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        documents: [
          {
            id: "CXS-192-2019",
            title:
              "Standard for Infant Formula and Formulas for Special Medical Purposes Intended for Infants",
            type: "Standard",
            url: "https://www.fao.org/fao-who-codexalimentarius/sh-proxy/en/?lnk=1&url=https%3A%2F%2Fworkspace.fao.org%2Fsites%2Fcodex%2FStandards%2FCXS%20192-1995%2FCXS_192e.pdf",
          },
        ],
      }),
    });
    const { registry } = await import("./types");
    await import("./codex");
    const adapter = registry.get("codex");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText:
        "CODEX standard for infant formula requires minimum protein content",
      extractedValue: "infant formula protein standard",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=true even when response is non-JSON (structured reference fallback)", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "text/html" },
      text: async () => "<html>CODEX standards page</html>",
    });
    const { registry } = await import("./types");
    await import("./codex");
    const adapter = registry.get("codex");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "CODEX Alimentarius food safety standard",
      extractedValue: null,
    });
    // Non-JSON response triggers structured reference fallback which returns found:true
    expect(result.found).toBe(true);
  });

  it("returns found=true with standards reference when API returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const { registry } = await import("./types");
    await import("./codex");
    const adapter = registry.get("codex");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "CODEX food standard",
      extractedValue: null,
    });
    expect(result.found).toBe(true);
    expect(result.confidenceFlags).toContain("codex_standards_reference");
  });

  it("returns found=false when fetch throws (network error)", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("network error"));
    const { registry } = await import("./types");
    await import("./codex");
    const adapter = registry.get("codex");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "CODEX food standard",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });
});
