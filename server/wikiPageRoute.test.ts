/**
 * wikiPageRoute.test.ts
 * Unit tests for server/wikiPageRoute.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("registerWikiPageRoute()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("registers middleware and routes on the express app", async () => {
    const { registerWikiPageRoute } = await import("./wikiPageRoute");
    const app = { get: vi.fn(), use: vi.fn() };
    registerWikiPageRoute(app as never);
    // registerWikiPageRoute uses app.use for middleware
    expect(app.use).toHaveBeenCalled();
  });

  it("registers at least one route or middleware", async () => {
    const { registerWikiPageRoute } = await import("./wikiPageRoute");
    const app = { get: vi.fn(), use: vi.fn() };
    registerWikiPageRoute(app as never);
    const totalCalls = vi.mocked(app.get).mock.calls.length + vi.mocked(app.use).mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(1);
  });
});
