/**
 * eur_lex.test.ts
 * Unit tests for server/verticalAdapters/eur_lex.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mocks.mockFetch);

describe("eurLexAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'eur_lex'", async () => {
    const { registry } = await import("./types");
    await import("./eur_lex");
    const adapter = registry.get("eur_lex");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("eur_lex");
  });

  it("returns found=true when SPARQL returns a binding for CELEX number", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: {
          bindings: [
            {
              s: {
                value: "http://publications.europa.eu/resource/celex/2016R0679",
              },
              title: { value: "General Data Protection Regulation" },
              url: {
                value:
                  "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:2016R0679",
              },
              type: { value: "Regulation" },
            },
          ],
        },
      }),
    });
    const { registry } = await import("./types");
    await import("./eur_lex");
    const adapter = registry.get("eur_lex");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "According to 2016R0679, GDPR requires consent",
      extractedValue: "2016R0679",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
  });

  it("returns found=false when SPARQL returns no bindings", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    });
    // Falls back to text search
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: { bindings: [] } }),
    });
    const { registry } = await import("./types");
    await import("./eur_lex");
    const adapter = registry.get("eur_lex");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "CELEX 99999R9999 requires something",
      extractedValue: "99999R9999",
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./eur_lex");
    const adapter = registry.get("eur_lex");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "CELEX 32016R0679 requires consent",
      extractedValue: "32016R0679",
    });
    expect(result.found).toBe(false);
  });
});
