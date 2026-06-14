/**
 * storageAdapter.test.ts
 * Unit tests for server/platform/storageAdapter.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockStoragePut: vi.fn(),
  mockStorageGet: vi.fn(),
}));

vi.mock("../storage", () => ({
  storagePut: mocks.mockStoragePut,
  storageGet: mocks.mockStorageGet,
}));
vi.mock("../logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("storageAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("getStorageAdapter returns an adapter instance", async () => {
    const { getStorageAdapter } = await import("./storageAdapter");
    const adapter = getStorageAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.put).toBe("function");
    expect(typeof adapter.get).toBe("function");
  });

  it("setStorageAdapter replaces the singleton", async () => {
    const { getStorageAdapter, setStorageAdapter } = await import("./storageAdapter");
    const mockAdapter = {
      put: vi.fn().mockResolvedValue({ key: "test-key", url: "/manus-storage/test-key" }),
      get: vi.fn().mockResolvedValue({ key: "test-key", url: "/manus-storage/test-key" }),
      isAvailable: vi.fn().mockReturnValue(true),
    };
    setStorageAdapter(mockAdapter as never);
    const adapter = getStorageAdapter();
    const result = await adapter.put("test-key", Buffer.from("data"), "text/plain");
    expect(result.key).toBe("test-key");
  });

  it("put delegates to storagePut", async () => {
    mocks.mockStoragePut.mockResolvedValueOnce({
      key: "uploads/file.png",
      url: "/manus-storage/uploads/file.png",
    });

    const { getStorageAdapter } = await import("./storageAdapter");
    const adapter = getStorageAdapter();
    const result = await adapter.put("uploads/file.png", Buffer.from("png-data"), "image/png");

    expect(mocks.mockStoragePut).toHaveBeenCalledWith(
      "uploads/file.png",
      expect.any(Buffer),
      "image/png"
    );
    expect(result.key).toBe("uploads/file.png");
    expect(result.url).toBe("/manus-storage/uploads/file.png");
  });

  it("get delegates to storageGet", async () => {
    mocks.mockStorageGet.mockResolvedValueOnce({
      key: "uploads/file.png",
      url: "/manus-storage/uploads/file.png",
    });

    const { getStorageAdapter } = await import("./storageAdapter");
    const adapter = getStorageAdapter();
    const result = await adapter.get("uploads/file.png");

    expect(mocks.mockStorageGet).toHaveBeenCalledWith("uploads/file.png");
    expect(result.url).toBe("/manus-storage/uploads/file.png");
  });
});
