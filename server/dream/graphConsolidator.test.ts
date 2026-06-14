/**
 * graphConsolidator.test.ts
 * Unit tests for dream/graphConsolidator.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.mockGetDb }));

describe("runGraphConsolidation()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns zero-filled result when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { runGraphConsolidation } = await import("./graphConsolidator");
    const result = await runGraphConsolidation();
    expect(result.orphanedEntityCount).toBe(0);
    expect(result.duplicateEdgeCount).toBe(0);
    expect(result.staleConfidenceCount).toBe(0);
    expect(result.totalOptimizations).toBe(0);
    expect(result.recommendations).toHaveLength(0);
  });

  it("returns zero counts when DB has no issues", async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ cnt: 0 }]),
    };
    mocks.mockGetDb.mockResolvedValue(db);
    const { runGraphConsolidation } = await import("./graphConsolidator");
    const result = await runGraphConsolidation();
    expect(result.orphanedEntityCount).toBe(0);
    expect(result.duplicateEdgeCount).toBe(0);
    expect(result.recommendations).toHaveLength(0);
  });

  it("reports orphaned entities and adds recommendation", async () => {
    const db = {
      execute: vi.fn()
        .mockResolvedValueOnce([{ cnt: 5 }])  // orphan query
        .mockResolvedValueOnce([{ cnt: 0 }])  // duplicate query
        .mockResolvedValueOnce([{ cnt: 0 }]), // stale confidence query
    };
    mocks.mockGetDb.mockResolvedValue(db);
    const { runGraphConsolidation } = await import("./graphConsolidator");
    const result = await runGraphConsolidation();
    expect(result.orphanedEntityCount).toBe(5);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0]).toContain("orphaned");
  });

  it("reports duplicate edges and adds recommendation", async () => {
    const db = {
      execute: vi.fn()
        .mockResolvedValueOnce([{ cnt: 0 }])  // orphan
        .mockResolvedValueOnce([{ cnt: 3 }])  // duplicate
        .mockResolvedValueOnce([{ cnt: 0 }]), // stale
    };
    mocks.mockGetDb.mockResolvedValue(db);
    const { runGraphConsolidation } = await import("./graphConsolidator");
    const result = await runGraphConsolidation();
    expect(result.duplicateEdgeCount).toBe(3);
    expect(result.recommendations.some((r) => r.toLowerCase().includes("duplicate"))).toBe(true);
  });

  it("accumulates totalOptimizations from all issue counts", async () => {
    const db = {
      execute: vi.fn()
        .mockResolvedValueOnce([{ cnt: 2 }])  // orphan
        .mockResolvedValueOnce([{ cnt: 1 }])  // duplicate
        .mockResolvedValueOnce([{ cnt: 3 }]), // stale
    };
    mocks.mockGetDb.mockResolvedValue(db);
    const { runGraphConsolidation } = await import("./graphConsolidator");
    const result = await runGraphConsolidation();
    expect(result.totalOptimizations).toBe(6); // 2 + 1 + 3
  });

  it("handles DB execute errors gracefully and returns partial result", async () => {
    const db = {
      execute: vi.fn().mockRejectedValue(new Error("DB error")),
    };
    mocks.mockGetDb.mockResolvedValue(db);
    const { runGraphConsolidation } = await import("./graphConsolidator");
    // Should not throw
    const result = await runGraphConsolidation();
    expect(result).toBeDefined();
    expect(result.orphanedEntityCount).toBe(0);
  });
});
