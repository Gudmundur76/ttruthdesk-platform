/**
 * notificationAdapter.test.ts
 * Unit tests for server/platform/notificationAdapter.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockNotifyOwner: vi.fn(),
}));

vi.mock("../_core/notification", () => ({ notifyOwner: mocks.mockNotifyOwner }));
vi.mock("../logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("notificationAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("getNotificationAdapter returns an adapter instance", async () => {
    const { getNotificationAdapter } = await import("./notificationAdapter");
    const adapter = getNotificationAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.notify).toBe("function");
  });

  it("setNotificationAdapter replaces the singleton", async () => {
    const { getNotificationAdapter, setNotificationAdapter } = await import("./notificationAdapter");
    const mockAdapter = {
      notify: vi.fn().mockResolvedValue(true),
      isAvailable: vi.fn().mockReturnValue(true),
    };
    setNotificationAdapter(mockAdapter as never);
    const adapter = getNotificationAdapter();
    const result = await adapter.notify({ title: "Test", content: "Hello" });
    expect(result).toBe(true);
    expect(mockAdapter.notify).toHaveBeenCalledWith({ title: "Test", content: "Hello" });
  });

  it("notify delegates to notifyOwner and returns true on success", async () => {
    mocks.mockNotifyOwner.mockResolvedValueOnce(true);

    const { getNotificationAdapter } = await import("./notificationAdapter");
    const adapter = getNotificationAdapter();
    const result = await adapter.notify({ title: "Alert", content: "Something happened" });

    expect(mocks.mockNotifyOwner).toHaveBeenCalledWith({
      title: "Alert",
      content: "Something happened",
    });
    expect(result).toBe(true);
  });

  it("notify returns false when notifyOwner throws", async () => {
    mocks.mockNotifyOwner.mockRejectedValueOnce(new Error("Forge unavailable"));

    const { getNotificationAdapter } = await import("./notificationAdapter");
    const adapter = getNotificationAdapter();
    const result = await adapter.notify({ title: "Alert", content: "Something happened" });
    expect(result).toBe(false);
  });

  it("notify returns false when notifyOwner returns false", async () => {
    mocks.mockNotifyOwner.mockResolvedValueOnce(false);

    const { getNotificationAdapter } = await import("./notificationAdapter");
    const adapter = getNotificationAdapter();
    const result = await adapter.notify({ title: "Quiet", content: "No-op" });
    expect(result).toBe(false);
  });
});
