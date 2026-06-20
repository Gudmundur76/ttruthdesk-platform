/**
 * telemetryEndpoint.test.ts
 *
 * Unit tests for server/telemetryEndpoint.ts
 * Covers: rate limiting, GET /api/telemetry/summary, GET /api/telemetry/events
 *
 * WIRE_IT.md — ttruthdesk → self-direct integration
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks before any imports ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(
  overrides: Partial<{
    query: Record<string, string>;
    headers: Record<string, string>;
    socket: { remoteAddress: string };
  }> = {}
) {
  return {
    query: overrides.query ?? {},
    headers: overrides.headers ?? {},
    socket: overrides.socket ?? { remoteAddress: "127.0.0.1" },
  };
}

function makeRes() {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._body = body;
      return res;
    },
  };
  return res;
}

// ─── Rate Limit ───────────────────────────────────────────────────────────────

describe("checkRateLimit()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows the first request from a new IP", async () => {
    const { checkRateLimit } = await import("./telemetryEndpoint");
    const result = checkRateLimit("1.2.3.4");
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSec).toBe(0);
  });

  it("allows up to RATE_LIMIT_MAX requests in a window", async () => {
    const { checkRateLimit, RATE_LIMIT_MAX } = await import("./telemetryEndpoint");
    const ip = "10.0.0.2";
    for (let i = 0; i < RATE_LIMIT_MAX - 1; i++) {
      expect(checkRateLimit(ip).allowed).toBe(true);
    }
  });

  it("blocks requests after RATE_LIMIT_MAX is exceeded", async () => {
    const { checkRateLimit, RATE_LIMIT_MAX } = await import("./telemetryEndpoint");
    const ip = "10.0.0.3";
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit(ip);
    }
    const blocked = checkRateLimit(ip);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("treats different IPs independently", async () => {
    const { checkRateLimit, RATE_LIMIT_MAX } = await import("./telemetryEndpoint");
    const ipA = "10.0.1.1";
    const ipB = "10.0.1.2";
    // Exhaust ipA
    for (let i = 0; i < RATE_LIMIT_MAX; i++) checkRateLimit(ipA);
    expect(checkRateLimit(ipA).allowed).toBe(false);
    // ipB should still be allowed
    expect(checkRateLimit(ipB).allowed).toBe(true);
  });
});

// ─── GET /api/telemetry/summary ───────────────────────────────────────────────

describe("handleTelemetrySummary()", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.mockGetDb.mockReset();
  });

  it("returns 503 when database is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { registerTelemetryRoutes } = await import("./telemetryEndpoint");
    const app = { get: vi.fn() } as unknown as import("express").Express;
    registerTelemetryRoutes(app);
    // Extract the summary handler
    const summaryHandler = (app.get as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "/api/telemetry/summary"
    )?.[1] as (req: unknown, res: unknown) => Promise<void>;
    const req = makeReq();
    const res = makeRes();
    await summaryHandler(req, res);
    expect(res._status).toBe(503);
    expect((res._body as { ok: boolean }).ok).toBe(false);
  });

  it("returns ok:true with correct shape when db returns empty data", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    mocks.mockGetDb.mockResolvedValue(mockDb);

    const { registerTelemetryRoutes } = await import("./telemetryEndpoint");
    const app = { get: vi.fn() } as unknown as import("express").Express;
    registerTelemetryRoutes(app);
    const summaryHandler = (app.get as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "/api/telemetry/summary"
    )?.[1] as (req: unknown, res: unknown) => Promise<void>;

    const req = makeReq();
    const res = makeRes();
    await summaryHandler(req, res);

    expect(res._status).toBe(200);
    const body = res._body as {
      ok: boolean;
      summary: {
        verifications: { total: number; averageConfidence: number };
        events: { totalPublished: number };
        layers: { runs: number };
        calibration: { totalAdapters: number };
      };
    };
    expect(body.ok).toBe(true);
    expect(body.summary.verifications.total).toBe(0);
    expect(body.summary.verifications.averageConfidence).toBe(0);
    expect(body.summary.events.totalPublished).toBe(0);
    expect(body.summary.layers.runs).toBe(0);
    expect(body.summary.calibration.totalAdapters).toBe(72);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const { registerTelemetryRoutes, RATE_LIMIT_MAX } = await import(
      "./telemetryEndpoint"
    );
    const app = { get: vi.fn() } as unknown as import("express").Express;
    registerTelemetryRoutes(app);
    const summaryHandler = (app.get as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "/api/telemetry/summary"
    )?.[1] as (req: unknown, res: unknown) => Promise<void>;

    const ip = "99.99.99.99";
    const req = makeReq({ socket: { remoteAddress: ip } });

    // Exhaust rate limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const r = makeRes();
      await summaryHandler(req, r);
    }
    const blockedRes = makeRes();
    await summaryHandler(req, blockedRes);
    expect(blockedRes._status).toBe(429);
    expect((blockedRes._body as { ok: boolean }).ok).toBe(false);
  });

  it("returns 500 on unexpected database error", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockRejectedValue(new Error("DB connection lost")),
    };
    mocks.mockGetDb.mockResolvedValue(mockDb);

    const { registerTelemetryRoutes } = await import("./telemetryEndpoint");
    const app = { get: vi.fn() } as unknown as import("express").Express;
    registerTelemetryRoutes(app);
    const summaryHandler = (app.get as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "/api/telemetry/summary"
    )?.[1] as (req: unknown, res: unknown) => Promise<void>;

    const req = makeReq({ socket: { remoteAddress: "11.11.11.11" } });
    const res = makeRes();
    await summaryHandler(req, res);
    expect(res._status).toBe(500);
    expect((res._body as { ok: boolean }).ok).toBe(false);
  });
});

// ─── GET /api/telemetry/events ────────────────────────────────────────────────

describe("handleTelemetryEvents()", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.mockGetDb.mockReset();
  });

  it("returns 503 when database is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { registerTelemetryRoutes } = await import("./telemetryEndpoint");
    const app = { get: vi.fn() } as unknown as import("express").Express;
    registerTelemetryRoutes(app);
    const eventsHandler = (app.get as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "/api/telemetry/events"
    )?.[1] as (req: unknown, res: unknown) => Promise<void>;
    const req = makeReq();
    const res = makeRes();
    await eventsHandler(req, res);
    expect(res._status).toBe(503);
    expect((res._body as { ok: boolean }).ok).toBe(false);
  });

  it("returns ok:true with empty events array when db returns nothing", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mocks.mockGetDb.mockResolvedValue(mockDb);

    const { registerTelemetryRoutes } = await import("./telemetryEndpoint");
    const app = { get: vi.fn() } as unknown as import("express").Express;
    registerTelemetryRoutes(app);
    const eventsHandler = (app.get as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "/api/telemetry/events"
    )?.[1] as (req: unknown, res: unknown) => Promise<void>;

    const req = makeReq();
    const res = makeRes();
    await eventsHandler(req, res);
    expect(res._status).toBe(200);
    const body = res._body as { ok: boolean; events: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(0);
  });

  it("caps limit at 200 regardless of query param", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mocks.mockGetDb.mockResolvedValue(mockDb);

    const { registerTelemetryRoutes } = await import("./telemetryEndpoint");
    const app = { get: vi.fn() } as unknown as import("express").Express;
    registerTelemetryRoutes(app);
    const eventsHandler = (app.get as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "/api/telemetry/events"
    )?.[1] as (req: unknown, res: unknown) => Promise<void>;

    const req = makeReq({ query: { limit: "9999" } });
    const res = makeRes();
    await eventsHandler(req, res);
    // The mock's limit() should have been called with 200 (the cap)
    expect(mockDb.limit).toHaveBeenCalledWith(200);
  });

  it("returns 500 on unexpected database error", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error("timeout")),
    };
    mocks.mockGetDb.mockResolvedValue(mockDb);

    const { registerTelemetryRoutes } = await import("./telemetryEndpoint");
    const app = { get: vi.fn() } as unknown as import("express").Express;
    registerTelemetryRoutes(app);
    const eventsHandler = (app.get as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === "/api/telemetry/events"
    )?.[1] as (req: unknown, res: unknown) => Promise<void>;

    const req = makeReq({ socket: { remoteAddress: "22.22.22.22" } });
    const res = makeRes();
    await eventsHandler(req, res);
    expect(res._status).toBe(500);
    expect((res._body as { ok: boolean }).ok).toBe(false);
  });
});

// ─── registerTelemetryRoutes ──────────────────────────────────────────────────

describe("registerTelemetryRoutes()", () => {
  it("registers both /api/telemetry/summary and /api/telemetry/events", async () => {
    vi.resetModules();
    const { registerTelemetryRoutes } = await import("./telemetryEndpoint");
    const app = { get: vi.fn() } as unknown as import("express").Express;
    registerTelemetryRoutes(app);
    const registeredPaths = (app.get as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0]
    );
    expect(registeredPaths).toContain("/api/telemetry/summary");
    expect(registeredPaths).toContain("/api/telemetry/events");
  });
});
