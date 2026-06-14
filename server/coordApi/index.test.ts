/**
 * coordApi/index.test.ts
 * Unit tests for server/coordApi/index.ts
 * Tests that createCoordRouter mounts all sub-routers with auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  coordAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  createQueueRouter: vi.fn(() => {
    const r = { use: vi.fn(), get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
    return r;
  }),
  createTasksRouter: vi.fn(() => {
    const r = { use: vi.fn(), get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
    return r;
  }),
  createContextRouter: vi.fn(() => {
    const r = { use: vi.fn(), get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
    return r;
  }),
  createMemoryRouter: vi.fn(() => {
    const r = { use: vi.fn(), get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
    return r;
  }),
  routerUse: vi.fn(),
}));

vi.mock("./shared", () => ({ coordAuth: mocks.coordAuth }));
vi.mock("./queueRouter", () => ({ createQueueRouter: mocks.createQueueRouter }));
vi.mock("./tasksRouter", () => ({ createTasksRouter: mocks.createTasksRouter }));
vi.mock("./contextRouter", () => ({ createContextRouter: mocks.createContextRouter }));
vi.mock("./memoryRouter", () => ({ createMemoryRouter: mocks.createMemoryRouter }));
vi.mock("express", () => {
  const routerInstance = { use: mocks.routerUse };
  return { Router: vi.fn(() => routerInstance) };
});

describe("createCoordRouter()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns a router with auth and all four sub-routers mounted", async () => {
    const { createCoordRouter } = await import("./index");
    const router = createCoordRouter();

    // Auth middleware applied first
    expect(mocks.routerUse).toHaveBeenCalledWith(mocks.coordAuth);

    // All four sub-routers mounted
    expect(mocks.createQueueRouter).toHaveBeenCalledOnce();
    expect(mocks.createTasksRouter).toHaveBeenCalledOnce();
    expect(mocks.createContextRouter).toHaveBeenCalledOnce();
    expect(mocks.createMemoryRouter).toHaveBeenCalledOnce();

    // Mounted at correct paths
    expect(mocks.routerUse).toHaveBeenCalledWith("/queue", expect.anything());
    expect(mocks.routerUse).toHaveBeenCalledWith("/tasks", expect.anything());
    expect(mocks.routerUse).toHaveBeenCalledWith("/context", expect.anything());
    expect(mocks.routerUse).toHaveBeenCalledWith("/memory", expect.anything());

    expect(router).toBeDefined();
  });

  it("calls createCoordRouter twice independently", async () => {
    const { createCoordRouter } = await import("./index");
    createCoordRouter();
    createCoordRouter();
    // Each call creates fresh sub-routers
    expect(mocks.createQueueRouter).toHaveBeenCalledTimes(2);
    expect(mocks.createTasksRouter).toHaveBeenCalledTimes(2);
  });
});
