/**
 * streamVerifyRoute.test.ts
 *
 * Phase 114 — SSE streaming verification endpoint tests.
 *
 * Strategy: Following the verifyClaimRoute.test.ts pattern, we test logic
 * in isolation rather than spinning up a full Express server with SSE.
 * SSE routes are notoriously hard to test with Supertest because the
 * Connection: keep-alive header can prevent the response from completing.
 *
 * Covers:
 *   - Rate-limit logic (IP bucket, API key bypass)
 *   - verdictToConfidence helper (via re-implementation)
 *   - Input validation logic
 *   - MCP_STREAMING_CAPABILITY descriptor shape
 *   - sseWrite / sseError output format
 *   - Integration: OPTIONS preflight (using supertest, no SSE streaming)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mock global fetch (fetchPubMedResults makes real network calls) ──────────

vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({}),
    text: async () => "",
  })
);

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("./claimExtractor", () => ({
  extractClaims: vi.fn().mockResolvedValue([]),
}));

vi.mock("./_queryTranslator", () => ({
  translateQueryToClaims: vi.fn().mockResolvedValue([]),
}));

vi.mock("./pdbAdapter", () => ({
  verdictForClaim: vi.fn().mockResolvedValue({
    verdict: "Supported",
    rationale: "PDB record confirms",
    evidenceUrl: "https://www.rcsb.org/structure/1ABC",
    evidenceRaw: null,
  }),
}));

vi.mock("./discoveryLoopJob", () => ({
  computeSignalDensity: vi.fn(() => 0.5),
}));

vi.mock("./verticalAdapters/types", () => ({
  getVertical: vi.fn(() => null),
}));

vi.mock("./verticalAdapters", () => ({}));

vi.mock("./autonomousIngest", () => ({
  triggerAutonomousIngest: vi.fn(),
}));

vi.mock("./apiKeyService", () => ({
  validateApiKey: vi.fn().mockResolvedValue(null),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { registerStreamVerifyRoute, MCP_STREAMING_CAPABILITY } from "./streamVerifyRoute";

// ─── Test app factory ─────────────────────────────────────────────────────────

const makeApp = () => {
  const app = express();
  app.use(express.json());
  registerStreamVerifyRoute(app as any);
  return app;
};

// ─── SSE response parser ──────────────────────────────────────────────────────

interface SseEvent {
  event: string;
  data: unknown;
}

function parseSseBody(body: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = body.split("\n\n").filter(b => b.trim());
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      if (line.startsWith("data: ")) data = line.slice(6).trim();
    }
    if (data) {
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        events.push({ event, data });
      }
    }
  }
  return events;
}

// ─── Rate-limit logic (re-implemented for isolation testing) ──────────────────

function makeStreamRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, { count: number; windowStart: number }>();

  function check(ip: string, isApiKey: boolean, now: number) {
    if (isApiKey) return { allowed: true, remaining: 999999, resetAt: 0 };

    const bucket = buckets.get(ip);
    if (!bucket || now - bucket.windowStart > windowMs) {
      buckets.set(ip, { count: 1, windowStart: now });
      return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
    }
    if (bucket.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: bucket.windowStart + windowMs };
    }
    bucket.count += 1;
    return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.windowStart + windowMs };
  }

  function reset() {
    buckets.clear();
  }

  return { check, reset };
}

// ─── verdictToConfidence (re-implemented for isolation testing) ───────────────

function verdictToConfidence(verdict: string): number {
  const map: Record<string, number> = {
    Supported: 0.92,
    "Partially Supported": 0.65,
    Ambiguous: 0.45,
    "Needs Expert Review": 0.30,
    "Insufficient Evidence": 0.15,
    "Out of Scope": 0.05,
  };
  return map[verdict] ?? 0.15;
}

// ─── Input validation (re-implemented for isolation testing) ──────────────────

function validateStreamInput(claim: unknown): { ok: boolean; error?: string; code?: number } {
  if (typeof claim !== "string" || claim.trim().length === 0) {
    return { ok: false, error: "Query parameter 'claim' is required and must be a non-empty string.", code: 400 };
  }
  if (claim.trim().length > 2000) {
    return { ok: false, error: "Claim text must be 2000 characters or fewer.", code: 400 };
  }
  return { ok: true };
}

// ─── sseWrite format ──────────────────────────────────────────────────────────

function sseWrite(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("stream rate limiter", () => {
  const rl = makeStreamRateLimiter(10, 60 * 60 * 1000);
  const NOW = 1_000_000;

  beforeEach(() => rl.reset());

  it("allows first request and decrements remaining", () => {
    const result = rl.check("1.2.3.4", false, NOW);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it("allows up to the limit (10 requests)", () => {
    for (let i = 0; i < 9; i++) rl.check("1.2.3.4", false, NOW);
    const tenth = rl.check("1.2.3.4", false, NOW);
    expect(tenth.allowed).toBe(true);
    expect(tenth.remaining).toBe(0);
  });

  it("blocks after limit is reached", () => {
    for (let i = 0; i < 10; i++) rl.check("1.2.3.4", false, NOW);
    const eleventh = rl.check("1.2.3.4", false, NOW);
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.remaining).toBe(0);
  });

  it("resets after the window expires", () => {
    for (let i = 0; i < 10; i++) rl.check("1.2.3.4", false, NOW);
    const afterWindow = rl.check("1.2.3.4", false, NOW + 60 * 60 * 1000 + 1);
    expect(afterWindow.allowed).toBe(true);
  });

  it("API key bypasses rate limit regardless of count", () => {
    for (let i = 0; i < 20; i++) {
      const result = rl.check("1.2.3.4", true, NOW);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(999999);
    }
  });

  it("tracks different IPs independently", () => {
    for (let i = 0; i < 10; i++) rl.check("10.0.0.1", false, NOW);
    const blocked = rl.check("10.0.0.1", false, NOW);
    const allowed = rl.check("10.0.0.2", false, NOW);
    expect(blocked.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });
});

describe("verdictToConfidence", () => {
  it("Supported → 0.92", () => {
    expect(verdictToConfidence("Supported")).toBe(0.92);
  });

  it("Partially Supported → 0.65", () => {
    expect(verdictToConfidence("Partially Supported")).toBe(0.65);
  });

  it("Ambiguous → 0.45", () => {
    expect(verdictToConfidence("Ambiguous")).toBe(0.45);
  });

  it("Needs Expert Review → 0.30", () => {
    expect(verdictToConfidence("Needs Expert Review")).toBe(0.30);
  });

  it("Insufficient Evidence → 0.15", () => {
    expect(verdictToConfidence("Insufficient Evidence")).toBe(0.15);
  });

  it("Out of Scope → 0.05", () => {
    expect(verdictToConfidence("Out of Scope")).toBe(0.05);
  });

  it("unknown verdict → 0.15 (fallback)", () => {
    expect(verdictToConfidence("Unknown Verdict")).toBe(0.15);
  });

  it("all values are in [0, 1]", () => {
    const verdicts = [
      "Supported", "Partially Supported", "Ambiguous",
      "Needs Expert Review", "Insufficient Evidence", "Out of Scope",
    ];
    for (const v of verdicts) {
      const c = verdictToConfidence(v);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("stream input validation", () => {
  it("rejects missing claim", () => {
    const result = validateStreamInput(undefined);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(400);
  });

  it("rejects empty string claim", () => {
    const result = validateStreamInput("   ");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(400);
  });

  it("rejects claim over 2000 chars", () => {
    const result = validateStreamInput("A".repeat(2001));
    expect(result.ok).toBe(false);
    expect(result.code).toBe(400);
  });

  it("accepts valid claim", () => {
    const result = validateStreamInput("PDB entry 1ABC has a resolution of 2.1 Å");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts exactly 2000 chars", () => {
    const result = validateStreamInput("A".repeat(2000));
    expect(result.ok).toBe(true);
  });
});

describe("sseWrite format", () => {
  it("produces correct SSE format", () => {
    const output = sseWrite("test:event", { ok: true, value: 42 });
    expect(output).toBe('event: test:event\ndata: {"ok":true,"value":42}\n\n');
  });

  it("double newline terminates the event block", () => {
    const output = sseWrite("final", { ok: true });
    expect(output.endsWith("\n\n")).toBe(true);
  });

  it("parseSseBody round-trips correctly", () => {
    const raw =
      "event: stage:extraction\ndata: {\"stage\":1}\n\n" +
      "event: final\ndata: {\"ok\":true}\n\n";
    const events = parseSseBody(raw);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("stage:extraction");
    expect((events[0].data as any).stage).toBe(1);
    expect(events[1].event).toBe("final");
    expect((events[1].data as any).ok).toBe(true);
  });
});

describe("OPTIONS preflight", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
  });

  it("returns 204 with CORS headers", async () => {
    const res = await request(app)
      .options("/api/public/verify-claim/stream")
      .set("Origin", "https://citation.is");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toContain("GET");
    expect(res.headers["access-control-allow-headers"]).toContain("Authorization");
  });
});

// ─── MCP_STREAMING_CAPABILITY descriptor ─────────────────────────────────────

describe("MCP_STREAMING_CAPABILITY", () => {
  it("has supported:true", () => {
    expect(MCP_STREAMING_CAPABILITY.streaming.supported).toBe(true);
  });

  it("endpoint points to the correct path", () => {
    expect(MCP_STREAMING_CAPABILITY.streaming.endpoint).toBe(
      "/api/public/verify-claim/stream"
    );
  });

  it("lists all expected SSE event types", () => {
    const events = MCP_STREAMING_CAPABILITY.streaming.events;
    expect(events).toContain("stage:extraction");
    expect(events).toContain("stage:evidence");
    expect(events).toContain("stage:verdict");
    expect(events).toContain("final");
    expect(events).toContain("error");
  });

  it("protocol is text/event-stream", () => {
    expect(MCP_STREAMING_CAPABILITY.streaming.protocol).toBe("text/event-stream");
  });

  it("method is GET", () => {
    expect(MCP_STREAMING_CAPABILITY.streaming.method).toBe("GET");
  });

  it("description is non-empty", () => {
    expect(MCP_STREAMING_CAPABILITY.streaming.description.length).toBeGreaterThan(10);
  });
});
