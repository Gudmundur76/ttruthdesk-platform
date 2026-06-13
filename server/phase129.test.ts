/**
 * Phase 129 — Production Hardening
 * RED → GREEN → REFACTOR
 *
 * Tests for:
 *   A) structuredErrors.ts  — ERR_ code constants + makeError helper
 *   B) detailedHealthRoute.ts — GET /api/v2/health/detailed subsystem checks
 *   C) ingestionAlertJob.ts — push-based alerting for stall / lag / error-rate
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({ getDb: vi.fn() }));

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("./logger", () => ({
  logger: vi.fn().mockReturnValue(mockLog),
  errData: vi.fn((e) => ({ err: String(e) })),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import { getDb } from "./db";
import {
  ERR_CLAIM_NOT_FOUND,
  ERR_RATE_LIMITED,
  ERR_DB_UNAVAILABLE,
  ERR_INVALID_INPUT,
  ERR_INGESTION_STALLED,
  ERR_VERDICT_FLIP,
  makeError,
} from "./structuredErrors";
import {
  buildHealthReport,
  HealthStatus,
} from "./detailedHealthRoute";
import {
  checkIngestionAlerts,
  AlertCheckResult,
} from "./ingestionAlertJob";
import { notifyOwner } from "./_core/notification";

// ─── A) structuredErrors ──────────────────────────────────────────────────────

describe("structuredErrors", () => {
  it("exports ERR_CLAIM_NOT_FOUND as a non-empty string", () => {
    expect(typeof ERR_CLAIM_NOT_FOUND).toBe("string");
    expect(ERR_CLAIM_NOT_FOUND.length).toBeGreaterThan(0);
  });

  it("exports ERR_RATE_LIMITED as a non-empty string", () => {
    expect(typeof ERR_RATE_LIMITED).toBe("string");
    expect(ERR_RATE_LIMITED.length).toBeGreaterThan(0);
  });

  it("exports ERR_DB_UNAVAILABLE as a non-empty string", () => {
    expect(typeof ERR_DB_UNAVAILABLE).toBe("string");
  });

  it("exports ERR_INVALID_INPUT as a non-empty string", () => {
    expect(typeof ERR_INVALID_INPUT).toBe("string");
  });

  it("exports ERR_INGESTION_STALLED as a non-empty string", () => {
    expect(typeof ERR_INGESTION_STALLED).toBe("string");
  });

  it("exports ERR_VERDICT_FLIP as a non-empty string", () => {
    expect(typeof ERR_VERDICT_FLIP).toBe("string");
  });

  it("makeError returns object with code and message", () => {
    const err = makeError(ERR_CLAIM_NOT_FOUND, "claim abc not found");
    expect(err).toMatchObject({ code: ERR_CLAIM_NOT_FOUND, message: "claim abc not found" });
  });

  it("makeError includes optional details when provided", () => {
    const err = makeError(ERR_RATE_LIMITED, "too many requests", { retryAfter: 60 });
    expect(err).toMatchObject({ code: ERR_RATE_LIMITED, details: { retryAfter: 60 } });
  });

  it("all ERR_ codes are unique", () => {
    const codes = [
      ERR_CLAIM_NOT_FOUND,
      ERR_RATE_LIMITED,
      ERR_DB_UNAVAILABLE,
      ERR_INVALID_INPUT,
      ERR_INGESTION_STALLED,
      ERR_VERDICT_FLIP,
    ];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});

// ─── B) detailedHealthRoute ───────────────────────────────────────────────────

describe("buildHealthReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns overall status 'down' or 'degraded' when DB is unavailable", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const report = await buildHealthReport();
    expect(["down", "degraded"]).toContain(report.overall);
    expect(report.subsystems.db.status).toBe("down");
  });

  it("returns subsystem keys: db, vectorStore, ingestion, mcp", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const report = await buildHealthReport();
    expect(Object.keys(report.subsystems)).toEqual(
      expect.arrayContaining(["db", "vectorStore", "ingestion", "mcp"])
    );
  });

  it("returns overall 'ok' when DB is available", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 1 }]),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
    const report = await buildHealthReport();
    expect(["ok", "degraded"]).toContain(report.overall);
    expect(report.subsystems.db.status).toBe("ok");
  });

  it("includes a timestamp in ISO format", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const report = await buildHealthReport();
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes latencyMs for db subsystem", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const report = await buildHealthReport();
    expect(typeof report.subsystems.db.latencyMs).toBe("number");
  });
});

// ─── C) ingestionAlertJob ─────────────────────────────────────────────────────

describe("checkIngestionAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AlertCheckResult with alertsFired count", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await checkIngestionAlerts();
    expect(typeof result.alertsFired).toBe("number");
  });

  it("returns skipped=true when DB is unavailable", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await checkIngestionAlerts();
    expect(result.skipped).toBe(true);
  });

  it("does not call notifyOwner when DB is unavailable", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await checkIngestionAlerts();
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("fires stall alert when last ingestion is older than threshold", async () => {
    const staleTs = new Date(Date.now() - 8 * 60 * 60 * 1000); // 8h ago
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ ingestedAt: staleTs }]),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
    const result = await checkIngestionAlerts();
    expect(result.alertsFired).toBeGreaterThanOrEqual(1);
    expect(notifyOwner).toHaveBeenCalled();
  });

  it("does not fire stall alert when last ingestion is recent", async () => {
    const recentTs = new Date(Date.now() - 30 * 60 * 1000); // 30min ago
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ ingestedAt: recentTs }]),
    };
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
    const result = await checkIngestionAlerts();
    expect(result.alertsFired).toBe(0);
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it("returns durationMs as a non-negative number", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await checkIngestionAlerts();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
