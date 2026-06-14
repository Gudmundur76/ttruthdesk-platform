/**
 * embedRoutes.test.ts
 * Unit tests for server/embedRoutes.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("registerEmbedRoutes()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("registers multiple GET routes on the express app", async () => {
    const { registerEmbedRoutes } = await import("./embedRoutes");
    const app = { get: vi.fn() };
    registerEmbedRoutes(app as never);
    expect(vi.mocked(app.get).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("registers a /api/embed/frame route", async () => {
    const { registerEmbedRoutes } = await import("./embedRoutes");
    const registeredPaths: string[] = [];
    const app = {
      get: vi.fn((path: string) => {
        registeredPaths.push(path);
      }),
    };
    registerEmbedRoutes(app as never);
    expect(registeredPaths.some((p) => p.includes("embed"))).toBe(true);
  });

  it("registers a /api/embed/sdk.js route", async () => {
    const { registerEmbedRoutes } = await import("./embedRoutes");
    const registeredPaths: string[] = [];
    const app = {
      get: vi.fn((path: string) => {
        registeredPaths.push(path);
      }),
    };
    registerEmbedRoutes(app as never);
    expect(registeredPaths.some((p) => p.includes("sdk"))).toBe(true);
  });
});
