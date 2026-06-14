/**
 * platform/index.test.ts
 * Unit tests for server/platform/index.ts and adapter injection
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IForgeAdapter, IStorageAdapter, INotificationAdapter, ILLMAdapter } from "./types";

const makeMockForge = (): IForgeAdapter => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
  setSecret: vi.fn().mockResolvedValue({ ok: true }),
  isAvailable: vi.fn().mockReturnValue(true),
});

const makeMockStorage = (): IStorageAdapter => ({
  put: vi.fn().mockResolvedValue({ key: "test-key", url: "/manus-storage/test-key" }),
  get: vi.fn().mockResolvedValue({ key: "test-key", url: "/manus-storage/test-key" }),
  isAvailable: vi.fn().mockReturnValue(true),
});

const makeMockNotification = (): INotificationAdapter => ({
  notify: vi.fn().mockResolvedValue(true),
  isAvailable: vi.fn().mockReturnValue(true),
});

const makeMockLLM = (): ILLMAdapter => ({
  complete: vi.fn().mockResolvedValue({ content: "test", model: "test-model", promptTokens: 10, completionTokens: 5 }),
  defaultModel: vi.fn().mockReturnValue("test-model"),
  isAvailable: vi.fn().mockReturnValue(true),
});

describe("platform adapter injection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("setForgeAdapter() injects a mock and getForgeAdapter() returns it", async () => {
    const { getForgeAdapter, setForgeAdapter } = await import("./forgeAdapter");
    const mock = makeMockForge();
    setForgeAdapter(mock);
    const adapter = getForgeAdapter();
    expect(adapter).toBe(mock);
    expect(adapter.isAvailable()).toBe(true);
  });

  it("setStorageAdapter() injects a mock and getStorageAdapter() returns it", async () => {
    const { getStorageAdapter, setStorageAdapter } = await import("./storageAdapter");
    const mock = makeMockStorage();
    setStorageAdapter(mock);
    const adapter = getStorageAdapter();
    expect(adapter).toBe(mock);
    expect(adapter.isAvailable()).toBe(true);
  });

  it("setNotificationAdapter() injects a mock and getNotificationAdapter() returns it", async () => {
    const { getNotificationAdapter, setNotificationAdapter } = await import("./notificationAdapter");
    const mock = makeMockNotification();
    setNotificationAdapter(mock);
    const adapter = getNotificationAdapter();
    expect(adapter).toBe(mock);
    expect(adapter.isAvailable()).toBe(true);
  });

  it("setLLMAdapter() injects a mock and getLLMAdapter() returns it", async () => {
    const { getLLMAdapter, setLLMAdapter } = await import("./llmAdapter");
    const mock = makeMockLLM();
    setLLMAdapter(mock);
    const adapter = getLLMAdapter();
    expect(adapter).toBe(mock);
    expect(adapter.defaultModel()).toBe("test-model");
  });

  it("mock forge adapter can send email", async () => {
    const { getForgeAdapter, setForgeAdapter } = await import("./forgeAdapter");
    const mock = makeMockForge();
    setForgeAdapter(mock);
    const result = await getForgeAdapter().sendEmail({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });
    expect(result.ok).toBe(true);
  });

  it("mock storage adapter can put and get files", async () => {
    const { getStorageAdapter, setStorageAdapter } = await import("./storageAdapter");
    const mock = makeMockStorage();
    setStorageAdapter(mock);
    const putResult = await getStorageAdapter().put("test-key", Buffer.from("data"), "text/plain");
    expect(putResult.key).toBe("test-key");
    const getResult = await getStorageAdapter().get("test-key");
    expect(getResult.url).toContain("test-key");
  });

  it("mock notification adapter can notify", async () => {
    const { getNotificationAdapter, setNotificationAdapter } = await import("./notificationAdapter");
    const mock = makeMockNotification();
    setNotificationAdapter(mock);
    const result = await getNotificationAdapter().notify({ title: "Test", content: "Test content" });
    expect(result).toBe(true);
  });
});
