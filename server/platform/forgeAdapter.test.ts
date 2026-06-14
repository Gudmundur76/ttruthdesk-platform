/**
 * forgeAdapter.test.ts
 * Unit tests for server/platform/forgeAdapter.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../_core/env", () => ({
  ENV: {
    forgeApiUrl: "https://forge.example.com",
    forgeApiKey: "test-key-123",
  },
}));
vi.mock("../logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("forgeAdapter", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getForgeAdapter returns an adapter instance", async () => {
    const { getForgeAdapter } = await import("./forgeAdapter");
    const adapter = getForgeAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.isAvailable).toBe("function");
    expect(typeof adapter.sendEmail).toBe("function");
  });

  it("setForgeAdapter replaces the singleton", async () => {
    const { getForgeAdapter, setForgeAdapter } = await import("./forgeAdapter");
    const mockAdapter = {
      isAvailable: () => true,
      sendEmail: vi.fn().mockResolvedValue({ ok: true }),
      getSecret: vi.fn().mockResolvedValue({ ok: true, value: "secret" }),
      setSecret: vi.fn().mockResolvedValue({ ok: true }),
    };
    setForgeAdapter(mockAdapter);
    const adapter = getForgeAdapter();
    expect(adapter.isAvailable()).toBe(true);
  });

  it("isAvailable returns true when env vars are set", async () => {
    const { getForgeAdapter } = await import("./forgeAdapter");
    const adapter = getForgeAdapter();
    expect(adapter.isAvailable()).toBe(true);
  });

  it("sendEmail calls the Forge API endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const { getForgeAdapter } = await import("./forgeAdapter");
    const adapter = getForgeAdapter();
    const result = await adapter.sendEmail({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });
    expect(mockFetch).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("sendEmail returns error when fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { getForgeAdapter } = await import("./forgeAdapter");
    const adapter = getForgeAdapter();
    const result = await adapter.sendEmail({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
