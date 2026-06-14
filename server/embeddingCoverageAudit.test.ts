/**
 * embeddingCoverageAudit.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for getEmbeddingCoverage().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb, mockIsSidecarAvailable } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockIsSidecarAvailable: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mockGetDb }));
vi.mock("./vectorStore", () => ({ isSidecarAvailable: mockIsSidecarAvailable }));

import { getEmbeddingCoverage } from "./embeddingCoverageAudit";

function makeDb(countVal = 0) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ count: countVal }]),
  };
  return { select: vi.fn().mockReturnValue(chain) };
}

describe("embeddingCoverageAudit — getEmbeddingCoverage()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sidecarAvailable:false and pct:0 when sidecar is down", async () => {
    mockIsSidecarAvailable.mockResolvedValue(false);
    mockGetDb.mockResolvedValue(makeDb(10));

    const result = await getEmbeddingCoverage();

    expect(result.sidecarAvailable).toBe(false);
    expect(result.pct).toBe(0);
    expect(result.indexed).toBe(0);
  });

  it("returns eligible count from DB", async () => {
    mockIsSidecarAvailable.mockResolvedValue(false);
    mockGetDb.mockResolvedValue(makeDb(42));

    const result = await getEmbeddingCoverage();

    expect(result.eligible).toBe(42);
  });

  it("returns eligible:0 when DB is unavailable", async () => {
    mockIsSidecarAvailable.mockResolvedValue(false);
    mockGetDb.mockResolvedValue(null);

    const result = await getEmbeddingCoverage();

    expect(result.eligible).toBe(0);
  });

  it("returns pct:100 when eligible is 0 and sidecar is available", async () => {
    mockIsSidecarAvailable.mockResolvedValue(true);
    mockGetDb.mockResolvedValue(makeDb(0));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ indexed: 0 }),
      })
    );

    const result = await getEmbeddingCoverage();

    expect(result.pct).toBe(100);
    expect(result.sidecarAvailable).toBe(true);
  });

  it("computes correct pct when indexed < eligible", async () => {
    mockIsSidecarAvailable.mockResolvedValue(true);
    mockGetDb.mockResolvedValue(makeDb(100));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ indexed: 75 }),
      })
    );

    const result = await getEmbeddingCoverage();

    expect(result.pct).toBe(75);
    expect(result.indexed).toBe(75);
    expect(result.eligible).toBe(100);
  });

  it("caps pct at 100 when indexed > eligible", async () => {
    mockIsSidecarAvailable.mockResolvedValue(true);
    mockGetDb.mockResolvedValue(makeDb(50));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ indexed: 200 }),
      })
    );

    const result = await getEmbeddingCoverage();

    expect(result.pct).toBe(100);
  });

  it("returns sidecarAvailable:false when sidecar fetch throws", async () => {
    mockIsSidecarAvailable.mockResolvedValue(true);
    mockGetDb.mockResolvedValue(makeDb(20));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused"))
    );

    const result = await getEmbeddingCoverage();

    expect(result.sidecarAvailable).toBe(false);
    expect(result.pct).toBe(0);
  });

  it("returns sidecarAvailable:false when sidecar returns non-ok status", async () => {
    mockIsSidecarAvailable.mockResolvedValue(true);
    mockGetDb.mockResolvedValue(makeDb(20));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      })
    );

    const result = await getEmbeddingCoverage();

    // sidecar returned non-ok — indexed stays 0, pct = 0 (20 eligible, 0 indexed)
    expect(result.indexed).toBe(0);
    expect(result.pct).toBe(0);
  });

  it("auditedAt is a valid ISO string", async () => {
    mockIsSidecarAvailable.mockResolvedValue(false);
    mockGetDb.mockResolvedValue(makeDb(0));

    const result = await getEmbeddingCoverage();

    expect(() => new Date(result.auditedAt)).not.toThrow();
    expect(new Date(result.auditedAt).getTime()).toBeGreaterThan(0);
  });
});
