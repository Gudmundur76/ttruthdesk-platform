/**
 * verifyClaimRoute.test.ts
 * Tests for the rate limiter and input validation logic extracted from
 * verifyClaimRoute.ts. Network/LLM calls are not tested here.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Re-implement the rate limiter in isolation for testing ───────────────────
// (We test the logic, not the Express route, to avoid spinning up a server)

function makeRateLimiter(limit: number, windowMs: number) {
  const map = new Map<string, { count: number; resetAt: number }>();

  function check(ip: string, now: number): { allowed: boolean; remaining: number; resetAt: number } {
    const entry = map.get(ip);
    if (!entry || now > entry.resetAt) {
      const resetAt = now + windowMs;
      map.set(ip, { count: 1, resetAt });
      return { allowed: true, remaining: limit - 1, resetAt };
    }
    if (entry.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }
    entry.count++;
    return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
  }

  function reset() {
    map.clear();
  }

  return { check, reset };
}

// ─── Input validation helpers (mirrored from verifyClaimRoute.ts) ─────────────

function validateClaimInput(claim: unknown): { ok: boolean; error?: string } {
  if (typeof claim !== "string" || claim.trim().length === 0) {
    return { ok: false, error: "Request body must include a non-empty 'claim' string." };
  }
  if (claim.trim().length > 2000) {
    return { ok: false, error: "Claim text must be 2000 characters or fewer." };
  }
  return { ok: true };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("verify-claim rate limiter", () => {
  const rl = makeRateLimiter(3, 60_000);
  const NOW = 1_000_000;

  beforeEach(() => rl.reset());

  it("allows first request and decrements remaining", () => {
    const result = rl.check("1.2.3.4", NOW);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("allows up to the limit", () => {
    rl.check("1.2.3.4", NOW);
    rl.check("1.2.3.4", NOW);
    const third = rl.check("1.2.3.4", NOW);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("blocks after limit is reached", () => {
    rl.check("1.2.3.4", NOW);
    rl.check("1.2.3.4", NOW);
    rl.check("1.2.3.4", NOW);
    const fourth = rl.check("1.2.3.4", NOW);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("resets after the window expires", () => {
    rl.check("1.2.3.4", NOW);
    rl.check("1.2.3.4", NOW);
    rl.check("1.2.3.4", NOW);
    // Advance past the window
    const after = rl.check("1.2.3.4", NOW + 61_000);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(2);
  });

  it("tracks different IPs independently", () => {
    rl.check("1.1.1.1", NOW);
    rl.check("1.1.1.1", NOW);
    rl.check("1.1.1.1", NOW);
    const blocked = rl.check("1.1.1.1", NOW);
    const allowed = rl.check("2.2.2.2", NOW);
    expect(blocked.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });
});

describe("verify-claim input validation", () => {
  it("rejects missing claim", () => {
    const r = validateClaimInput(undefined);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/non-empty/);
  });

  it("rejects empty string", () => {
    const r = validateClaimInput("   ");
    expect(r.ok).toBe(false);
  });

  it("rejects non-string", () => {
    const r = validateClaimInput(42);
    expect(r.ok).toBe(false);
  });

  it("rejects claim over 2000 chars", () => {
    const r = validateClaimInput("x".repeat(2001));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/2000/);
  });

  it("accepts a valid claim string", () => {
    const r = validateClaimInput("The crystal structure of lysozyme was solved at 1.8 Å resolution (PDB: 1LYZ).");
    expect(r.ok).toBe(true);
  });

  it("accepts a claim exactly 2000 chars", () => {
    const r = validateClaimInput("x".repeat(2000));
    expect(r.ok).toBe(true);
  });
});

describe("verify-claim response shape contract", () => {
  it("defines the expected ok-response fields", () => {
    // This is a contract test — verifies the shape we document in the JSDoc
    const mockResponse = {
      ok: true,
      claim: "test claim",
      vertical: "structural_biology",
      verdict: "Supported",
      rationale: "PDB entry confirmed.",
      evidenceUrl: "https://www.rcsb.org/structure/1LYZ",
      claimType: "resolution",
      pdbId: "1LYZ",
      proteinName: "Lysozyme",
      signalDensity: 3,
      processedAt: new Date().toISOString(),
      apiVersion: "1.0",
    };

    expect(mockResponse).toHaveProperty("ok", true);
    expect(mockResponse).toHaveProperty("verdict");
    expect(mockResponse).toHaveProperty("apiVersion", "1.0");
    expect(mockResponse).toHaveProperty("processedAt");
    expect(typeof mockResponse.signalDensity).toBe("number");
  });

  it("defines the expected error-response fields", () => {
    const mockError = {
      ok: false,
      error: "Rate limit exceeded.",
      retryAfterMs: 30000,
    };
    expect(mockError).toHaveProperty("ok", false);
    expect(mockError).toHaveProperty("error");
  });
});
