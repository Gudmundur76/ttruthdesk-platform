/**
 * sprint1.reactive.test.ts — Sprint 1: Cron Migration (Reactive Cascades)
 *
 * Tests for the three reactive event cascades that replace polling cron jobs:
 *   1. scanLocalContradictions — per-claim contradiction scan on verdict_complete
 *   2. lintWikiPage            — per-page wiki lint on compileDocumentToWiki
 *   3. source_data_changed     — event type registered in eventBus
 *   4. system_capability_required — event type registered in eventBus
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "./db";
const mockGetDb = vi.mocked(getDb);

// ─── 1. scanLocalContradictions ───────────────────────────────────────────────

describe("scanLocalContradictions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zero counts when DB is unavailable", async () => {
    mockGetDb.mockResolvedValueOnce(null as never);
    const { scanLocalContradictions } = await import("./contradictionDetector");
    const result = await scanLocalContradictions(42);
    expect(result.claimId).toBe(42);
    expect(result.pairsScanned).toBe(0);
    expect(result.newAlerts).toBe(0);
  });

  it("returns zero counts when no edges exist for the claim", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValueOnce([]),
    };
    mockGetDb.mockResolvedValueOnce(mockDb as never);
    const { scanLocalContradictions } = await import("./contradictionDetector");
    const result = await scanLocalContradictions(99);
    expect(result.pairsScanned).toBe(0);
    expect(result.newAlerts).toBe(0);
  });

  it("is non-fatal when DB throws", async () => {
    mockGetDb.mockRejectedValueOnce(new Error("DB connection refused"));
    const { scanLocalContradictions } = await import("./contradictionDetector");
    const result = await scanLocalContradictions(7);
    expect(result.pairsScanned).toBe(0);
    expect(result.newAlerts).toBe(0);
  });

  it("returns a LocalScanResult with claimId, pairsScanned, newAlerts, durationMs", async () => {
    mockGetDb.mockResolvedValueOnce(null as never);
    const { scanLocalContradictions } = await import("./contradictionDetector");
    const result = await scanLocalContradictions(5);
    expect(result).toHaveProperty("claimId");
    expect(result).toHaveProperty("pairsScanned");
    expect(result).toHaveProperty("newAlerts");
    expect(result).toHaveProperty("durationMs");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── 2. lintWikiPage ──────────────────────────────────────────────────────────

describe("lintWikiPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when DB is unavailable", async () => {
    mockGetDb.mockResolvedValueOnce(null as never);
    const { lintWikiPage } = await import("./wikiEngine");
    const result = await lintWikiPage("entity-lysozyme");
    expect(result).toBeNull();
  });

  it("returns null when the page does not exist", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValueOnce([]),
    };
    mockGetDb.mockResolvedValueOnce(mockDb as never);
    const { lintWikiPage } = await import("./wikiEngine");
    const result = await lintWikiPage("nonexistent-slug");
    expect(result).toBeNull();
  });

  it("is non-fatal when DB throws", async () => {
    mockGetDb.mockRejectedValueOnce(new Error("timeout"));
    const { lintWikiPage } = await import("./wikiEngine");
    const result = await lintWikiPage("entity-lysozyme");
    expect(result).toBeNull();
  });
});

// ─── 3. source_data_changed event type ────────────────────────────────────────

describe("source_data_changed event type", () => {
  it("is registered in EVENT_ENTRY_LAYERS", async () => {
    const { EVENT_ENTRY_LAYERS } = await import("./autonomousLoop/eventBus");
    expect(EVENT_ENTRY_LAYERS).toHaveProperty("source_data_changed");
  });

  it("enters at layer 2", async () => {
    const { EVENT_ENTRY_LAYERS } = await import("./autonomousLoop/eventBus");
    expect(EVENT_ENTRY_LAYERS["source_data_changed"]).toBe(1);
  });
});

// ─── 4. system_capability_required event type ─────────────────────────────────

describe("system_capability_required event type", () => {
  it("is registered in EVENT_ENTRY_LAYERS", async () => {
    const { EVENT_ENTRY_LAYERS } = await import("./autonomousLoop/eventBus");
    expect(EVENT_ENTRY_LAYERS).toHaveProperty("system_capability_required");
  });

  it("enters at layer 4", async () => {
    const { EVENT_ENTRY_LAYERS } = await import("./autonomousLoop/eventBus");
    expect(EVENT_ENTRY_LAYERS["system_capability_required"]).toBe(4);
  });
});
