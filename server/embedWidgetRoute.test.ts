/**
 * Tests for embedWidgetRoute.ts
 *
 * Validates the widget JS structure, badge data JSON endpoint,
 * and query endpoint behaviour without hitting the real DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock dependencies ────────────────────────────────────────────────────────

vi.mock("./db", () => ({ getClaimById: vi.fn(), getDb: vi.fn() }));
vi.mock("./claimSimilarityEngine", () => ({ findSimilarClaims: vi.fn() }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    query: {},
    protocol: "https",
    get: (h: string) => (h === "host" ? "test.example.com" : undefined),
    ...overrides,
  } as never;
}

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown;
  return {
    setHeader: (k: string, v: string) => { headers[k] = v; },
    status: (code: number) => { statusCode = code; return { json: (b: unknown) => { body = b; } }; },
    json: (b: unknown) => { body = b; },
    send: (b: unknown) => { body = b; },
    _headers: headers,
    _status: () => statusCode,
    _body: () => body,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("widget.js endpoint", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("returns JavaScript content-type", async () => {
    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    const setHeader = vi.fn();
    const res = { setHeader, send: vi.fn() } as never;
    routes["/embed/widget.js"](makeReq(), res);
    expect(setHeader).toHaveBeenCalledWith("Content-Type", "application/javascript; charset=utf-8");
  });

  it("sets CORS header to *", async () => {
    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      send: vi.fn(),
    } as never;
    routes["/embed/widget.js"](makeReq(), res);
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("widget JS contains data-truthdesk-claim selector", async () => {
    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    let sentBody = "";
    const res = {
      setHeader: vi.fn(),
      send: (b: string) => { sentBody = b; },
    } as never;
    routes["/embed/widget.js"](makeReq(), res);
    expect(sentBody).toContain("data-truthdesk-claim");
  });

  it("widget JS contains data-truthdesk-query selector", async () => {
    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    let sentBody = "";
    const res = {
      setHeader: vi.fn(),
      send: (b: string) => { sentBody = b; },
    } as never;
    routes["/embed/widget.js"](makeReq(), res);
    expect(sentBody).toContain("data-truthdesk-query");
  });

  it("widget JS embeds the correct origin", async () => {
    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    let sentBody = "";
    const res = {
      setHeader: vi.fn(),
      send: (b: string) => { sentBody = b; },
    } as never;
    routes["/embed/widget.js"](makeReq({ protocol: "https", get: (h: string) => h === "host" ? "mysite.com" : undefined }), res);
    expect(sentBody).toContain("https://mysite.com");
  });
});

describe("badge-data/:claimId endpoint", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("returns 400 for non-numeric claim ID", async () => {
    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    const res = makeRes();
    await routes["/embed/badge-data/:claimId"](makeReq({ params: { claimId: "abc" } }), res);
    expect(res._status()).toBe(400);
  });

  it("returns 404 when claim not found", async () => {
    const { getClaimById } = await import("./db");
    vi.mocked(getClaimById).mockResolvedValue(null as never);

    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    const res = makeRes();
    await routes["/embed/badge-data/:claimId"](makeReq({ params: { claimId: "999" } }), res);
    expect(res._status()).toBe(404);
  });

  it("returns claim data with CORS header when found", async () => {
    const { getClaimById } = await import("./db");
    vi.mocked(getClaimById).mockResolvedValue({
      id: 42,
      verdict: "Supported",
      verdictRationale: "Strong RCT evidence",
      claimText: "Whey protein increases muscle mass",
      confidenceScore: 0.85,
    } as never);

    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    const headers: Record<string, string> = {};
    let body: unknown;
    const res = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      json: (b: unknown) => { body = b; },
    } as never;
    await routes["/embed/badge-data/:claimId"](makeReq({ params: { claimId: "42" } }), res);
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(body).toMatchObject({ claimId: 42, verdict: "Supported", confidenceScore: 0.85 });
  });
});

describe("badge-data/query endpoint", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("returns 400 for short query", async () => {
    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    const res = makeRes();
    await routes["/embed/badge-data/query"](makeReq({ query: { q: "hi" } }), res);
    expect(res._status()).toBe(400);
  });

  it("returns found:false when no similar claims", async () => {
    const { findSimilarClaims } = await import("./claimSimilarityEngine");
    vi.mocked(findSimilarClaims).mockResolvedValue([]);

    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    let body: unknown;
    const res = {
      setHeader: vi.fn(),
      json: (b: unknown) => { body = b; },
    } as never;
    await routes["/embed/badge-data/query"](makeReq({ query: { q: "whey protein muscle mass" } }), res);
    expect(body).toMatchObject({ found: false });
  });

  it("returns claim data with similarity when match found", async () => {
    const { findSimilarClaims } = await import("./claimSimilarityEngine");
    vi.mocked(findSimilarClaims).mockResolvedValue([{ claimId: 7, similarity: 0.82, claimText: "whey protein increases muscle", documentId: 1, documentTitle: "Study A", verdict: "Supported", confidenceScore: 0.9 }]);

    const { getClaimById } = await import("./db");
    vi.mocked(getClaimById).mockResolvedValue({ id: 7, verdict: "Supported", verdictRationale: "RCT", claimText: "whey protein increases muscle", confidenceScore: 0.9 } as never);

    const { registerEmbedWidgetRoutes } = await import("./embedWidgetRoute");
    const routes: Record<string, (req: unknown, res: unknown) => void> = {};
    const app = { get: (path: string, handler: (req: unknown, res: unknown) => void) => { routes[path] = handler; } } as never;
    registerEmbedWidgetRoutes(app);

    let body: unknown;
    const res = {
      setHeader: vi.fn(),
      json: (b: unknown) => { body = b; },
    } as never;
    await routes["/embed/badge-data/query"](makeReq({ query: { q: "whey protein muscle mass" } }), res);
    expect(body).toMatchObject({ found: true, similarity: 0.82, claimId: 7, verdict: "Supported" });
  });
});
