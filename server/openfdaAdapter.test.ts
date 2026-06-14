/**
 * openfdaAdapter.test.ts
 * Unit tests for server/openfdaAdapter.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const makeCountResponse = (reactions: Array<{ term: string; count: number }> = []) => ({
  ok: true,
  json: vi.fn().mockResolvedValue({ results: reactions }),
});

const makeTotalResponse = (total: number) => ({
  ok: true,
  json: vi.fn().mockResolvedValue({ meta: { results: { total } } }),
});

describe("searchFdaAdverseEvents()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns found:true with counts when API returns results", async () => {
    mockFetch
      .mockResolvedValueOnce(makeCountResponse([
        { term: "NAUSEA", count: 100 },
        { term: "VOMITING", count: 80 },
      ]))
      .mockResolvedValueOnce(makeTotalResponse(500));
    const { searchFdaAdverseEvents } = await import("./openfdaAdapter");
    const result = await searchFdaAdverseEvents("collagen");
    expect(result.found).toBe(true);
    expect(result.totalEvents).toBe(500);
    expect(result.topReactions).toContain("NAUSEA");
    expect(result.error).toBeNull();
  });

  it("returns found:false when total is 0", async () => {
    mockFetch
      .mockResolvedValueOnce(makeCountResponse([]))
      .mockResolvedValueOnce(makeTotalResponse(0));
    const { searchFdaAdverseEvents } = await import("./openfdaAdapter");
    const result = await searchFdaAdverseEvents("obscure compound");
    expect(result.found).toBe(false);
    expect(result.totalEvents).toBe(0);
  });

  it("estimates seriousEvents as ~60% of total", async () => {
    mockFetch
      .mockResolvedValueOnce(makeCountResponse([]))
      .mockResolvedValueOnce(makeTotalResponse(1000));
    const { searchFdaAdverseEvents } = await import("./openfdaAdapter");
    const result = await searchFdaAdverseEvents("test compound");
    expect(result.seriousEvents).toBe(600);
  });

  it("returns error when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const { searchFdaAdverseEvents } = await import("./openfdaAdapter");
    const result = await searchFdaAdverseEvents("collagen");
    expect(result.found).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("handles non-OK count response gracefully", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce(makeTotalResponse(100));
    const { searchFdaAdverseEvents } = await import("./openfdaAdapter");
    const result = await searchFdaAdverseEvents("test");
    expect(result.topReactions).toHaveLength(0);
    expect(result.totalEvents).toBe(100);
  });
});

describe("interpretFdaSignals()", () => {
  it("returns zero delta when no events found", async () => {
    const { interpretFdaSignals } = await import("./openfdaAdapter");
    const result = interpretFdaSignals(
      { found: false, totalEvents: 0, seriousEvents: 0, topReactions: [], sourceUrl: "", error: null },
      true
    );
    expect(result.confidenceDelta).toBe(0);
    expect(result.flags[0]).toContain("No FDA adverse event reports");
  });

  it("returns -0.20 delta for safety claim with >10k events", async () => {
    const { interpretFdaSignals } = await import("./openfdaAdapter");
    const result = interpretFdaSignals(
      { found: true, totalEvents: 15000, seriousEvents: 9000, topReactions: ["NAUSEA"], sourceUrl: "", error: null },
      true
    );
    expect(result.confidenceDelta).toBe(-0.20);
    expect(result.flags.some((f) => f.includes("High adverse event"))).toBe(true);
  });

  it("returns -0.10 delta for safety claim with 1k-10k events", async () => {
    const { interpretFdaSignals } = await import("./openfdaAdapter");
    const result = interpretFdaSignals(
      { found: true, totalEvents: 5000, seriousEvents: 3000, topReactions: [], sourceUrl: "", error: null },
      true
    );
    expect(result.confidenceDelta).toBe(-0.10);
  });

  it("returns +0.05 delta for safety claim with <1k events", async () => {
    const { interpretFdaSignals } = await import("./openfdaAdapter");
    const result = interpretFdaSignals(
      { found: true, totalEvents: 200, seriousEvents: 120, topReactions: [], sourceUrl: "", error: null },
      true
    );
    expect(result.confidenceDelta).toBe(0.05);
  });

  it("returns 0 delta for non-safety claim regardless of event count", async () => {
    const { interpretFdaSignals } = await import("./openfdaAdapter");
    const result = interpretFdaSignals(
      { found: true, totalEvents: 50000, seriousEvents: 30000, topReactions: [], sourceUrl: "", error: null },
      false // not a safety claim
    );
    expect(result.confidenceDelta).toBe(0);
  });
});
