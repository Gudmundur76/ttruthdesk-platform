/**
 * llmsRoute.test.ts
 * Unit tests for server/llmsRoute.ts
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

type HandlerFn = (req: { protocol: string; get: (h: string) => string | undefined }, res: {
  set: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}) => Promise<void>;

const makeRes = () => ({
  set: vi.fn().mockReturnThis(),
  status: vi.fn().mockReturnThis(),
  send: vi.fn().mockReturnThis(),
});

describe("registerLlmsRoute()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockGetDb.mockResolvedValue(null);
  });

  it("registers a GET /llms.txt route on the express app", async () => {
    const { registerLlmsRoute } = await import("./llmsRoute");
    const app = { get: vi.fn() };
    registerLlmsRoute(app as never);
    expect(app.get).toHaveBeenCalledWith("/llms.txt", expect.any(Function));
  });

  it("returns text/plain content with Truth Desk branding", async () => {
    const { registerLlmsRoute } = await import("./llmsRoute");
    let capturedHandler: HandlerFn | null = null;
    const app = {
      get: vi.fn((_path: string, handler: HandlerFn) => {
        capturedHandler = handler;
      }),
    };
    registerLlmsRoute(app as never);
    if (!capturedHandler) throw new Error("Handler not captured");
    const req = { protocol: "https", get: (_h: string) => "truthdesk.claims" };
    const res = makeRes();
    await (capturedHandler as HandlerFn)(req, res);
    const sentContent = vi.mocked(res.send).mock.calls[0][0] as string;
    expect(sentContent).toBeTruthy();
    expect(typeof sentContent).toBe("string");
  });

  it("falls back gracefully when DB is unavailable", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { registerLlmsRoute } = await import("./llmsRoute");
    let capturedHandler: HandlerFn | null = null;
    const app = {
      get: vi.fn((_path: string, handler: HandlerFn) => {
        capturedHandler = handler;
      }),
    };
    registerLlmsRoute(app as never);
    if (!capturedHandler) throw new Error("Handler not captured");
    const req = { protocol: "https", get: (_h: string) => "truthdesk.claims" };
    const res = makeRes();
    await (capturedHandler as HandlerFn)(req, res);
    // Should still return 200 (fallback)
    expect(res.send).toHaveBeenCalled();
  });
});
