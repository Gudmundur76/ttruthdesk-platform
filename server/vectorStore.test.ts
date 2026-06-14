/**
 * vectorStore.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for vectorStore.ts — isSidecarAvailable, searchClaims, indexClaim
 *
 * NOTE: vectorStore.ts has module-level cache (_sidecarAvailable, _lastHealthCheck)
 * with a 30s TTL. Each test must bypass the cache by using vi.resetModules() or
 * by testing the behaviour directly (the cache is an implementation detail).
 * We isolate by using vi.isolateModules for each test group.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// We stub fetch globally — vectorStore reads it at call time
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.mock("./db", () => ({ getDb: vi.fn() }));

describe("vectorStore module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("isSidecarAvailable returns true when /health responds ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const { isSidecarAvailable } = await import("./vectorStore");
    const result = await isSidecarAvailable();
    expect(result).toBe(true);
  });

  it("isSidecarAvailable returns false when /health responds not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const { isSidecarAvailable } = await import("./vectorStore");
    const result = await isSidecarAvailable();
    expect(result).toBe(false);
  });

  it("isSidecarAvailable returns false when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { isSidecarAvailable } = await import("./vectorStore");
    const result = await isSidecarAvailable();
    expect(result).toBe(false);
  });

  it("indexClaim silently no-ops when sidecar is unavailable", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const { indexClaim } = await import("./vectorStore");
    await indexClaim(1, "test claim text");
    // Only the health check fetch should have been called
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("indexClaim posts to /index when sidecar is available", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })  // health
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // index
    const { indexClaim } = await import("./vectorStore");
    await indexClaim(42, "protein folding claim");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [indexUrl, indexOpts] = mockFetch.mock.calls[1];
    expect(indexUrl).toContain("/index");
    expect(indexOpts.method).toBe("POST");
    const body = JSON.parse(indexOpts.body);
    expect(body.items[0]).toMatchObject({ id: 42, text: "protein folding claim" });
  });

  it("indexClaim silently swallows errors from the index POST", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      .mockRejectedValueOnce(new Error("timeout"));
    const { indexClaim } = await import("./vectorStore");
    await expect(indexClaim(1, "text")).resolves.toBeUndefined();
  });

  it("searchClaims falls back to fulltext when sidecar is unavailable and DB is null", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { searchClaims } = await import("./vectorStore");
    const hits = await searchClaims({ query: "protein" });
    expect(hits).toEqual([]);
  });

  it("searchClaims returns fulltext hits when sidecar unavailable and DB has rows", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 1,
          claimText: "protein claim",
          verdict: "supported",
          documentId: 10,
          documentTitle: "Paper A",
          verticalDomain: "proteomics",
        },
      ]),
    };
    const { getDb } = await import("./db");
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
    const { searchClaims } = await import("./vectorStore");
    const hits = await searchClaims({ query: "protein" });
    expect(Array.isArray(hits)).toBe(true);
    expect(hits[0].source).toBe("fulltext");
  });
});
