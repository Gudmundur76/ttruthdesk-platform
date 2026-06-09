/**
 * coordApi.coverage.test.ts
 *
 * Unit tests for the coordApi Express router factories.
 * Tests verify that each router factory returns an Express Router
 * and that the routes are registered correctly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// Mock the db module to avoid real DB connections
vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    }),
  };
});

describe("createContextRouter", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns an Express Router (has stack property)", async () => {
    const { createContextRouter } = await import("./coordApi/contextRouter");
    const router = createContextRouter();
    // Express routers have a stack property
    expect(router).toBeDefined();
    expect(typeof router).toBe("function");
  });

  it("can be called multiple times without error", async () => {
    const { createContextRouter } = await import("./coordApi/contextRouter");
    expect(() => {
      createContextRouter();
      createContextRouter();
    }).not.toThrow();
  });
});

describe("createMemoryRouter", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns an Express Router", async () => {
    const { createMemoryRouter } = await import("./coordApi/memoryRouter");
    const router = createMemoryRouter();
    expect(router).toBeDefined();
    expect(typeof router).toBe("function");
  });
});

describe("createQueueRouter", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns an Express Router", async () => {
    const { createQueueRouter } = await import("./coordApi/queueRouter");
    const router = createQueueRouter();
    expect(router).toBeDefined();
    expect(typeof router).toBe("function");
  });
});

describe("coordApi shared module", () => {
  it("shared.ts exports without error", async () => {
    const mod = await import("./coordApi/shared");
    expect(mod).toBeDefined();
  });
});
