/**
 * hostingerWebhook.test.ts
 * Unit tests for server/hostingerWebhook.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const mocks = vi.hoisted(() => ({
  mockPublishEvent: vi.fn(),
}));

vi.mock("./autonomousLoop/eventBus", () => ({ publishEvent: mocks.mockPublishEvent }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

const WEBHOOK_SECRET = "test-secret-key";

const makeSignature = (body: string, secret: string) =>
  "sha256=" + crypto.createHmac("sha256", secret).update(Buffer.from(body)).digest("hex");

const makeBody = (overrides: Partial<{
  eventType: string;
  origin: string;
  timestamp: string;
  query: string;
  pmid: string;
  paperTitle: string;
}> = {}) => ({
  eventType: "search_query",
  origin: "https://laxey.is",
  timestamp: new Date().toISOString(),
  query: "collagen structure",
  ...overrides,
});

const makeReqRes = (bodyStr: string, secret: string, overrideHeaders: Record<string, string> = {}) => {
  const rawBody = Buffer.from(bodyStr);
  const req = {
    body: rawBody,
    ip: "127.0.0.1",
    headers: {
      "x-truthdesk-signature": makeSignature(bodyStr, secret),
      "content-type": "application/json",
      ...overrideHeaders,
    },
  };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return { req, res };
};

describe("registerHostingerWebhookRoute() — webhook handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.HOSTINGER_WEBHOOK_SECRET = WEBHOOK_SECRET;
    mocks.mockPublishEvent.mockResolvedValue(42);
  });

  afterEach(() => {
    delete process.env.HOSTINGER_WEBHOOK_SECRET;
    delete process.env.HOSTINGER_ALLOWED_ORIGINS;
  });

  type ReqLike = { body: Buffer; ip: string; headers: Record<string, string> };
  type ResLike = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  const getHandler = async (): Promise<((req: ReqLike, res: ResLike) => Promise<void>) | null> => {
    const { registerHostingerWebhookRoute } = await import("./hostingerWebhook");
    let capturedHandler: ((req: ReqLike, res: ResLike) => Promise<void>) | null = null;
    const app = {
      post: vi.fn((_path: string, handler: (req: ReqLike, res: ResLike) => Promise<void>) => {
        capturedHandler = handler;
      }),
    };
    registerHostingerWebhookRoute(app as never);
    return capturedHandler;
  };

  it("returns 401 when signature is invalid", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const bodyStr = JSON.stringify(makeBody());
    const { req, res } = makeReqRes(bodyStr, "wrong-secret");
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when no secret is configured", async () => {
    delete process.env.HOSTINGER_WEBHOOK_SECRET;
    const handler = await getHandler();
    if (!handler) return;
    const bodyStr = JSON.stringify(makeBody());
    const { req, res } = makeReqRes(bodyStr, WEBHOOK_SECRET);
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 403 when origin is not in allowed list", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const body = makeBody({ origin: "https://evil.example.com" });
    const bodyStr = JSON.stringify(body);
    const { req, res } = makeReqRes(bodyStr, WEBHOOK_SECRET);
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 400 when timestamp is too old", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const body = makeBody({ timestamp: oldTimestamp });
    const bodyStr = JSON.stringify(body);
    const { req, res } = makeReqRes(bodyStr, WEBHOOK_SECRET);
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns received:true and loopTriggered:true for search_query event", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const bodyStr = JSON.stringify(makeBody({ eventType: "search_query", query: "collagen" }));
    const { req, res } = makeReqRes(bodyStr, WEBHOOK_SECRET);
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      loopTriggered: true,
      eventType: "search_query",
    }));
  });

  it("returns received:true and loopTriggered:false for page_view event", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const bodyStr = JSON.stringify(makeBody({ eventType: "page_view" }));
    const { req, res } = makeReqRes(bodyStr, WEBHOOK_SECRET);
    await handler(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      received: true,
      loopTriggered: false,
    }));
  });

  it("returns 400 when body is invalid JSON", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const rawBody = Buffer.from("not-json");
    const req = {
      body: rawBody,
      ip: "127.0.0.1",
      headers: {
        "x-truthdesk-signature": makeSignature("not-json", WEBHOOK_SECRET),
      },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
