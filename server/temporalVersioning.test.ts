/**
 * temporalVersioning.test.ts
 *
 * Phase 118 — Temporal Claim Versioning
 * RED tests: all must fail before implementation.
 *
 * Tests cover:
 *   1. isClaimStale()        — detects claims older than threshold
 *   2. buildTemporalWindow() — derives validFrom/validUntil from evidence dates
 *   3. filterByDate()        — filters a list of claims to those valid at a given date
 *   4. MCP tool descriptor   — verify_claim_at_date appears in the tool list
 *   5. verdictAtDate()       — returns correct verdict for a claim at a given date
 */

import { describe, it, expect, vi } from "vitest";

// ── 1. isClaimStale ──────────────────────────────────────────────────────────
describe("isClaimStale", () => {
  it("returns true when claim was verified more than staleDays ago", async () => {
    const { isClaimStale } = await import("./temporalVersioning");
    const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000); // 400 days ago
    expect(isClaimStale(oldDate, 365)).toBe(true);
  });

  it("returns false when claim was verified within staleDays", async () => {
    const { isClaimStale } = await import("./temporalVersioning");
    const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    expect(isClaimStale(recentDate, 365)).toBe(false);
  });

  it("uses 365 days as default threshold", async () => {
    const { isClaimStale } = await import("./temporalVersioning");
    const borderDate = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
    expect(isClaimStale(borderDate)).toBe(true);
  });

  it("returns false for a claim verified today", async () => {
    const { isClaimStale } = await import("./temporalVersioning");
    expect(isClaimStale(new Date())).toBe(false);
  });
});

// ── 2. buildTemporalWindow ───────────────────────────────────────────────────
describe("buildTemporalWindow", () => {
  it("sets validFrom to the earliest evidence year", async () => {
    const { buildTemporalWindow } = await import("./temporalVersioning");
    const window = buildTemporalWindow([2018, 2021, 2015]);
    expect(window.validFrom.getFullYear()).toBe(2015);
  });

  it("sets validUntil to null when no expiry signal is present", async () => {
    const { buildTemporalWindow } = await import("./temporalVersioning");
    const window = buildTemporalWindow([2020, 2022]);
    expect(window.validUntil).toBeNull();
  });

  it("sets validUntil when a retraction year is provided", async () => {
    const { buildTemporalWindow } = await import("./temporalVersioning");
    const window = buildTemporalWindow([2018, 2020], 2023);
    expect(window.validUntil).not.toBeNull();
    expect(window.validUntil!.getFullYear()).toBe(2023);
  });

  it("returns validFrom as current year when no evidence years provided", async () => {
    const { buildTemporalWindow } = await import("./temporalVersioning");
    const window = buildTemporalWindow([]);
    expect(window.validFrom.getFullYear()).toBe(new Date().getFullYear());
  });
});

// ── 3. filterByDate ──────────────────────────────────────────────────────────
describe("filterByDate", () => {
  it("includes claims where queryDate is within validFrom–validUntil", async () => {
    const { filterByDate } = await import("./temporalVersioning");
    const claims = [
      { id: 1, validFrom: new Date("2018-01-01"), validUntil: new Date("2022-12-31") },
      { id: 2, validFrom: new Date("2020-01-01"), validUntil: null },
    ];
    const result = filterByDate(claims, new Date("2021-06-01"));
    expect(result.map(c => c.id)).toEqual([1, 2]);
  });

  it("excludes claims where queryDate is before validFrom", async () => {
    const { filterByDate } = await import("./temporalVersioning");
    const claims = [
      { id: 1, validFrom: new Date("2020-01-01"), validUntil: null },
    ];
    const result = filterByDate(claims, new Date("2019-01-01"));
    expect(result).toHaveLength(0);
  });

  it("excludes claims where queryDate is after validUntil", async () => {
    const { filterByDate } = await import("./temporalVersioning");
    const claims = [
      { id: 1, validFrom: new Date("2018-01-01"), validUntil: new Date("2020-12-31") },
    ];
    const result = filterByDate(claims, new Date("2021-06-01"));
    expect(result).toHaveLength(0);
  });

  it("returns all claims when queryDate is null (no filter)", async () => {
    const { filterByDate } = await import("./temporalVersioning");
    const claims = [
      { id: 1, validFrom: new Date("2018-01-01"), validUntil: null },
      { id: 2, validFrom: new Date("2020-01-01"), validUntil: new Date("2022-12-31") },
    ];
    const result = filterByDate(claims, null);
    expect(result).toHaveLength(2);
  });
});

// ── 4. verdictAtDate ─────────────────────────────────────────────────────────
describe("verdictAtDate", () => {
  it("returns the claim verdict when queryDate is within the validity window", async () => {
    const { verdictAtDate } = await import("./temporalVersioning");
    const claim = {
      id: 1,
      verdict: "Supported" as const,
      validFrom: new Date("2018-01-01"),
      validUntil: null,
      claimText: "Protein X folds into beta-sheet structure",
    };
    const result = verdictAtDate(claim, new Date("2022-01-01"));
    expect(result.verdict).toBe("Supported");
    expect(result.temporallyValid).toBe(true);
  });

  it("returns stale verdict with temporallyValid=false when queryDate is after validUntil", async () => {
    const { verdictAtDate } = await import("./temporalVersioning");
    const claim = {
      id: 1,
      verdict: "Supported" as const,
      validFrom: new Date("2018-01-01"),
      validUntil: new Date("2020-12-31"),
      claimText: "Protein X folds into beta-sheet structure",
    };
    const result = verdictAtDate(claim, new Date("2023-01-01"));
    expect(result.temporallyValid).toBe(false);
    expect(result.staleSince).toBeDefined();
  });

  it("returns temporallyValid=false with reason when queryDate is before validFrom", async () => {
    const { verdictAtDate } = await import("./temporalVersioning");
    const claim = {
      id: 1,
      verdict: "Supported" as const,
      validFrom: new Date("2022-01-01"),
      validUntil: null,
      claimText: "Protein X folds into beta-sheet structure",
    };
    const result = verdictAtDate(claim, new Date("2019-01-01"));
    expect(result.temporallyValid).toBe(false);
    expect(result.reason).toContain("before");
  });
});

// ── 5. MCP tool descriptor ───────────────────────────────────────────────────
describe("MCP tool descriptor", () => {
  it("TOOLS_MANIFEST includes verify_claim_at_date", async () => {
    const { TOOLS_MANIFEST } = await import("./temporalVersioning");
    const tool = TOOLS_MANIFEST.find((t: { name: string }) => t.name === "verify_claim_at_date");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("date");
    expect(tool!.inputSchema.properties).toHaveProperty("claim");
    expect(tool!.inputSchema.properties).toHaveProperty("query_date");
  });

  it("verify_claim_at_date tool has required fields claim and query_date", async () => {
    const { TOOLS_MANIFEST } = await import("./temporalVersioning");
    const tool = TOOLS_MANIFEST.find((t: { name: string }) => t.name === "verify_claim_at_date");
    expect(tool!.inputSchema.required).toContain("claim");
    expect(tool!.inputSchema.required).toContain("query_date");
  });
});
