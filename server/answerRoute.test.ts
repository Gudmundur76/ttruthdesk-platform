/**
 * answerRoute.test.ts
 * Unit tests for server/answerRoute.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockInvokeLLM: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.mockInvokeLLM }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("checkAnonRateLimit()", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows first request from a new IP", async () => {
    const { checkAnonRateLimit } = await import("./answerRoute");
    const result = checkAnonRateLimit("192.168.1.1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  it("tracks request count per IP", async () => {
    const { checkAnonRateLimit } = await import("./answerRoute");
    const ip = "10.0.0.1";
    const first = checkAnonRateLimit(ip);
    const second = checkAnonRateLimit(ip);
    expect(first.allowed).toBe(true);
    expect(second.remaining).toBeLessThan(first.remaining);
  });

  it("blocks requests after rate limit is exceeded", async () => {
    const { checkAnonRateLimit, ANON_RATE_LIMIT } = await import("./answerRoute");
    const ip = "172.16.0.1";
    // Exhaust the rate limit
    for (let i = 0; i < ANON_RATE_LIMIT; i++) {
      checkAnonRateLimit(ip);
    }
    const blocked = checkAnonRateLimit(ip);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("returns a future resetAt timestamp", async () => {
    const { checkAnonRateLimit } = await import("./answerRoute");
    const before = Date.now();
    const result = checkAnonRateLimit("203.0.113.1");
    expect(result.resetAt).toBeGreaterThan(before);
  });

  it("treats different IPs independently", async () => {
    const { checkAnonRateLimit, ANON_RATE_LIMIT } = await import("./answerRoute");
    const ip1 = "1.2.3.4";
    const ip2 = "5.6.7.8";
    // Exhaust ip1
    for (let i = 0; i < ANON_RATE_LIMIT; i++) {
      checkAnonRateLimit(ip1);
    }
    const blockedIp1 = checkAnonRateLimit(ip1);
    const allowedIp2 = checkAnonRateLimit(ip2);
    expect(blockedIp1.allowed).toBe(false);
    expect(allowedIp2.allowed).toBe(true);
  });
});

describe("ANON_RATE_LIMIT and ANON_WINDOW_MS constants", () => {
  it("ANON_RATE_LIMIT is a positive integer", async () => {
    const { ANON_RATE_LIMIT } = await import("./answerRoute");
    expect(ANON_RATE_LIMIT).toBeGreaterThan(0);
    expect(Number.isInteger(ANON_RATE_LIMIT)).toBe(true);
  });

  it("ANON_WINDOW_MS is a positive number representing at least 1 minute", async () => {
    const { ANON_WINDOW_MS } = await import("./answerRoute");
    expect(ANON_WINDOW_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("registerAnswerRoute()", () => {
  it("registers a POST route on the express app", async () => {
    const { registerAnswerRoute } = await import("./answerRoute");
    const app = { post: vi.fn(), options: vi.fn() };
    registerAnswerRoute(app as never);
    expect(app.post).toHaveBeenCalled();
  });
});
