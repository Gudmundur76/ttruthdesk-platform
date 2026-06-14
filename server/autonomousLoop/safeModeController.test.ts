/**
 * safeModeController.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Safe Mode Controller — manages autonomous loop halting
 * when health score drops below critical thresholds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────
const { mockGetDb, mockNotifyOwner } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockNotifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("../db", () => ({ getDb: mockGetDb }));
vi.mock("../_core/notification", () => ({ notifyOwner: mockNotifyOwner }));
vi.mock("../../drizzle/schema", () => ({
  loopConfig: { id: "id", safeMode: "safeMode" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => `eq(${String(col)},${String(val)})`),
}));

import {
  getSafeModeStatus,
  enterSafeMode,
  exitSafeMode,
  evaluateHealthAndTriggerSafeMode,
  HALT_THRESHOLD,
  SAFE_MODE_THRESHOLD,
} from "./safeModeController";

// ─── DB mock helpers ──────────────────────────────────────────────────────────
function makeDbChain(selectRows: unknown[] = []) {
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(selectRows),
    update: vi.fn().mockReturnValue(updateChain),
    _updateChain: updateChain,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("safeModeController — getSafeModeStatus()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns active:false when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    const status = await getSafeModeStatus();

    expect(status.active).toBe(false);
  });

  it("returns active:false when no config row exists", async () => {
    mockGetDb.mockResolvedValue(makeDbChain([]));

    const status = await getSafeModeStatus();

    expect(status.active).toBe(false);
  });

  it("returns active:true with reason when safe mode is on", async () => {
    const triggeredAt = new Date("2025-01-01T00:00:00Z");
    mockGetDb.mockResolvedValue(
      makeDbChain([{ id: 1, safeMode: true, safeModeReason: "low health", safeModeTriggeredAt: triggeredAt }])
    );

    const status = await getSafeModeStatus();

    expect(status.active).toBe(true);
    expect(status.reason).toBe("low health");
    expect(status.triggeredAt).toEqual(triggeredAt);
  });

  it("returns active:false when safeMode is false in config", async () => {
    mockGetDb.mockResolvedValue(
      makeDbChain([{ id: 1, safeMode: false, safeModeReason: null, safeModeTriggeredAt: null }])
    );

    const status = await getSafeModeStatus();

    expect(status.active).toBe(false);
  });
});

describe("safeModeController — enterSafeMode()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates the DB with safeMode:true and the reason", async () => {
    const db = makeDbChain();
    mockGetDb.mockResolvedValue(db);

    await enterSafeMode("health score 35 below threshold");

    expect(db.update).toHaveBeenCalled();
    expect(db._updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ safeMode: true, safeModeReason: "health score 35 below threshold" })
    );
  });

  it("fires notifyOwner with an alert title", async () => {
    const db = makeDbChain();
    mockGetDb.mockResolvedValue(db);

    await enterSafeMode("test reason");

    expect(mockNotifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("Safe Mode") })
    );
  });

  it("does nothing when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    await expect(enterSafeMode("no db")).resolves.toBeUndefined();
    expect(mockNotifyOwner).not.toHaveBeenCalled();
  });
});

describe("safeModeController — exitSafeMode()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates DB with safeMode:false and clears reason/triggeredAt", async () => {
    const db = makeDbChain();
    mockGetDb.mockResolvedValue(db);

    await exitSafeMode();

    expect(db._updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ safeMode: false, safeModeReason: null, safeModeTriggeredAt: null })
    );
  });

  it("does nothing when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);

    await expect(exitSafeMode()).resolves.toBeUndefined();
  });
});

describe("safeModeController — evaluateHealthAndTriggerSafeMode()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("triggers safe mode and returns true when score is below SAFE_MODE_THRESHOLD", async () => {
    const db = makeDbChain();
    mockGetDb.mockResolvedValue(db);

    const triggered = await evaluateHealthAndTriggerSafeMode(SAFE_MODE_THRESHOLD - 1);

    expect(triggered).toBe(true);
    expect(db._updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ safeMode: true })
    );
  });

  it("does NOT trigger safe mode when score equals SAFE_MODE_THRESHOLD", async () => {
    const triggered = await evaluateHealthAndTriggerSafeMode(SAFE_MODE_THRESHOLD);

    expect(triggered).toBe(false);
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("does NOT trigger safe mode when score is above SAFE_MODE_THRESHOLD", async () => {
    const triggered = await evaluateHealthAndTriggerSafeMode(HALT_THRESHOLD);

    expect(triggered).toBe(false);
  });

  it("returns false for a healthy score", async () => {
    const triggered = await evaluateHealthAndTriggerSafeMode(95);

    expect(triggered).toBe(false);
  });

  it("safe mode reason includes the health score and threshold", async () => {
    const db = makeDbChain();
    mockGetDb.mockResolvedValue(db);

    await evaluateHealthAndTriggerSafeMode(25);

    const setCall = db._updateChain.set.mock.calls[0][0];
    expect(setCall.safeModeReason).toContain("25");
    expect(setCall.safeModeReason).toContain(String(SAFE_MODE_THRESHOLD));
  });
});

describe("safeModeController — constants", () => {
  it("HALT_THRESHOLD is 60", () => expect(HALT_THRESHOLD).toBe(60));
  it("SAFE_MODE_THRESHOLD is 40", () => expect(SAFE_MODE_THRESHOLD).toBe(40));
  it("HALT_THRESHOLD > SAFE_MODE_THRESHOLD", () =>
    expect(HALT_THRESHOLD).toBeGreaterThan(SAFE_MODE_THRESHOLD));
});
