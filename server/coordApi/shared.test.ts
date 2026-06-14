/**
 * coordApi/shared.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for coordApi/shared.ts — coordAuth, minutesAgo, requireDb.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mockGetDb }));

// Mock ENV so we can control COORD_API_KEY
const { mockEnv } = vi.hoisted(() => ({ mockEnv: { coordApiKey: "test-secret-key" } }));
vi.mock("../_core/env", () => ({ ENV: mockEnv }));

import { coordAuth, minutesAgo, requireDb } from "./shared";

// ─── Helper: build minimal Express-like req/res/next ─────────────────────────
function makeReqRes(headers: Record<string, string> = {}) {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const req = { headers } as unknown as Parameters<typeof coordAuth>[0];
  const next = vi.fn();
  return { req, res, next };
}

// ─── coordAuth ────────────────────────────────────────────────────────────────
describe("coordApi/shared — coordAuth()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls next() when the correct key is provided", () => {
    const { req, res, next } = makeReqRes({ "x-coord-key": "test-secret-key" });
    coordAuth(req, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when X-Coord-Key header is missing", () => {
    const { req, res, next } = makeReqRes({});
    coordAuth(req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when X-Coord-Key header is wrong", () => {
    const { req, res, next } = makeReqRes({ "x-coord-key": "wrong-key" });
    coordAuth(req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 503 when COORD_API_KEY is not configured", () => {
    mockEnv.coordApiKey = undefined as unknown as string;
    const { req, res, next } = makeReqRes({ "x-coord-key": "any-key" });
    coordAuth(req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
    // restore
    mockEnv.coordApiKey = "test-secret-key";
  });
});

// ─── minutesAgo ───────────────────────────────────────────────────────────────
describe("coordApi/shared — minutesAgo()", () => {
  it("returns a Date approximately n minutes in the past", () => {
    const before = Date.now();
    const result = minutesAgo(5);
    const after = Date.now();
    const diff = before - result.getTime();
    // Should be between 4.9 and 5.1 minutes ago
    expect(diff).toBeGreaterThanOrEqual(5 * 60_000 - 100);
    expect(diff).toBeLessThanOrEqual(5 * 60_000 + (after - before) + 100);
  });

  it("returns a Date for 0 minutes ago (approximately now)", () => {
    const before = Date.now();
    const result = minutesAgo(0);
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before - 10);
    expect(result.getTime()).toBeLessThanOrEqual(after + 10);
  });

  it("returns a Date instance", () => {
    expect(minutesAgo(10)).toBeInstanceOf(Date);
  });
});

// ─── requireDb ────────────────────────────────────────────────────────────────
describe("coordApi/shared — requireDb()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the DB instance when available", async () => {
    const mockDb = { select: vi.fn() };
    mockGetDb.mockResolvedValue(mockDb);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const result = await requireDb(res as never);
    expect(result).toBe(mockDb);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns null and sends 503 when DB is unavailable", async () => {
    mockGetDb.mockResolvedValue(null);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const result = await requireDb(res as never);
    expect(result).toBeNull();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
