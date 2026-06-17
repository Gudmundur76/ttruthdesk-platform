/**
 * mcpSseEndpoint.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the GET /mcp SSE endpoint (MCP 2024-11-05 transport handshake).
 *
 * The MCP 2024-11-05 SSE transport spec requires:
 *   1. Server opens an SSE stream (Content-Type: text/event-stream)
 *   2. Server immediately sends an `endpoint` event with the POST URI
 *   3. Server keeps the connection alive with heartbeat comments
 *
 * Without the `endpoint` event, MCP clients (Claude, Cursor, Goose) never
 * complete the handshake and time out.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";

// ── Minimal mocks so we can register the route without a real DB ─────────────
vi.mock("./db", () => ({
  getPaginatedPublicClaims: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  getVerifiedClaimsForPublicApi: vi.fn().mockResolvedValue([]),
  getClaimById: vi.fn().mockResolvedValue(null),
  getSourceVersion: vi.fn().mockResolvedValue(null),
  getAllClaimIndexRows: vi.fn().mockResolvedValue([]),
  getClaimWithDocument: vi.fn().mockResolvedValue(null),
}));
vi.mock("./mcpServer", () => ({
  registerMcpServer: vi.fn(),
}));
vi.mock("./logger", () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Build a minimal Express app with just the /mcp GET route ─────────────────
function buildTestApp(): express.Express {
  const app = express();

  // Replicate the minimal setup from index.ts needed for the /mcp route
  const SITE_ORIGIN = "http://localhost:3000";
  const MCP_TOOLS: unknown[] = []; // empty — we only test the handshake

  app.get("/mcp", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const origin =
      ((req.headers["x-forwarded-proto"] as string | undefined)
        ? `${req.headers["x-forwarded-proto"]}://${req.headers["host"]}`
        : null) ?? SITE_ORIGIN;
    res.write(`event: endpoint\ndata: ${origin}/mcp\n\n`);

    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 15_000);
    res.on("close", () => clearInterval(heartbeat));
  });

  // Silence unused-variable warning
  void MCP_TOOLS;

  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collect the first N bytes from an HTTP response stream. */
function collectBytes(res: http.IncomingMessage, maxMs = 500): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => resolve(buf), maxMs);
    res.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
    });
    res.on("end", () => {
      clearTimeout(timer);
      resolve(buf);
    });
    res.on("error", err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("GET /mcp — MCP 2024-11-05 SSE handshake", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(
    () =>
      new Promise<void>(resolve => {
        const app = buildTestApp();
        server = http.createServer(app);
        server.listen(0, "127.0.0.1", () => {
          const port = (server.address() as AddressInfo).port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      })
  );

  afterAll(
    () =>
      new Promise<void>(resolve => {
        // Force-close keep-alive connections so server.close() resolves promptly.
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close(() => resolve());
      }),
    5_000 // 5s timeout for the hook
  );

  it("responds with Content-Type text/event-stream", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`${baseUrl}/mcp`, res => {
        expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
        res.destroy();
        resolve();
      });
      req.on("error", reject);
    });
  });

  it("sends an `endpoint` event as the first SSE event", async () => {
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(`${baseUrl}/mcp`, res => {
        collectBytes(res, 300).then(resolve).catch(reject);
      });
      req.on("error", reject);
    });

    // The first event must be `event: endpoint`
    expect(body).toMatch(/^event: endpoint\r?\n/);
  });

  it("endpoint event data contains the /mcp POST URI", async () => {
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(`${baseUrl}/mcp`, res => {
        collectBytes(res, 300).then(resolve).catch(reject);
      });
      req.on("error", reject);
    });

    // data line must end with /mcp
    expect(body).toMatch(/data: .+\/mcp\r?\n/);
  });

  it("endpoint event data is a valid absolute URL", async () => {
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(`${baseUrl}/mcp`, res => {
        collectBytes(res, 300).then(resolve).catch(reject);
      });
      req.on("error", reject);
    });

    const match = body.match(/data: (.+)\/mcp/);
    expect(match).not.toBeNull();
    const url = match![1] + "/mcp";
    expect(() => new URL(url)).not.toThrow();
  });

  it("uses x-forwarded-proto header to build the origin when present", async () => {
    const body = await new Promise<string>((resolve, reject) => {
      const options = {
        hostname: "127.0.0.1",
        port: (server.address() as AddressInfo).port,
        path: "/mcp",
        headers: {
          "x-forwarded-proto": "https",
          host: "citation.is",
        },
      };
      const req = http.get(options, res => {
        collectBytes(res, 300).then(resolve).catch(reject);
      });
      req.on("error", reject);
    });

    expect(body).toMatch(/data: https:\/\/citation\.is\/mcp/);
  });

  it("does NOT send a data event before the endpoint event", async () => {
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(`${baseUrl}/mcp`, res => {
        collectBytes(res, 300).then(resolve).catch(reject);
      });
      req.on("error", reject);
    });

    // The first line must be `event:` not `data:`
    const firstLine = body.split(/\r?\n/)[0];
    expect(firstLine).toMatch(/^event:/);
    expect(firstLine).not.toMatch(/^data:/);
  });

  it("sends CORS header Access-Control-Allow-Origin: *", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`${baseUrl}/mcp`, res => {
        expect(res.headers["access-control-allow-origin"]).toBe("*");
        res.destroy();
        resolve();
      });
      req.on("error", reject);
    });
  });
});
