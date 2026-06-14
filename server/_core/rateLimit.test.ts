/**
 * server/_core/rateLimit.test.ts — Sprint 0 Fix 1
 *
 * Unit tests for the DB-backed persistent rate limiter.
 * All DB calls are mocked — no real database required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { checkRateLimit, type RateLimitResult } from "./rateLimit";
import { getDb } from "../db";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeDb(selectRows: unknown[] = []) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(selectRows),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onDuplicateKeyUpdate: vi.fn().mockResolvedValue([{ insertId: 1 }]),
    then: undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkRateLimit", () => {
  it("allows first request (no existing bucket)", async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb([]) as never);
    const result: RateLimitResult = await checkRateLimit(
      "1.2.3.4",
      "anon",
      10,
      3600_000
    );
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it("allows request when count is below limit", async () => {
    const now = Date.now();
    vi.mocked(getDb).mockResolvedValue(
      makeDb([
        { key: "1.2.3.4", tier: "anon", count: 5, resetAt: now + 3600_000 },
      ]) as never
    );
    const result = await checkRateLimit("1.2.3.4", "anon", 10, 3600_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("rejects request when count equals limit", async () => {
    const now = Date.now();
    vi.mocked(getDb).mockResolvedValue(
      makeDb([
        { key: "1.2.3.4", tier: "anon", count: 10, resetAt: now + 3600_000 },
      ]) as never
    );
    const result = await checkRateLimit("1.2.3.4", "anon", 10, 3600_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets bucket when resetAt is in the past", async () => {
    vi.mocked(getDb).mockResolvedValue(
      makeDb([
        { key: "1.2.3.4", tier: "anon", count: 10, resetAt: Date.now() - 1 },
      ]) as never
    );
    const result = await checkRateLimit("1.2.3.4", "anon", 10, 3600_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it("falls back to allowed:true when DB is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    const result = await checkRateLimit("1.2.3.4", "anon", 10, 3600_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });

  it("falls back to allowed:true when DB throws", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("DB connection failed"));
    const result = await checkRateLimit("1.2.3.4", "anon", 10, 3600_000);
    expect(result.allowed).toBe(true);
  });

  it("returns a resetAt timestamp in the future for new buckets", async () => {
    vi.mocked(getDb).mockResolvedValue(makeDb([]) as never);
    const before = Date.now();
    const result = await checkRateLimit("5.6.7.8", "api", 100, 60_000);
    expect(result.resetAt).toBeGreaterThan(before);
    expect(result.resetAt).toBeLessThanOrEqual(before + 60_000 + 100);
  });
});
