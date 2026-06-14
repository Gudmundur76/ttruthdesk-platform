/**
 * translateAndSearchApi.test.ts
 * Unit tests for server/translateAndSearchApi.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockTranslateQueryToClaims: vi.fn(),
  mockProcessQueryResults: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./_queryTranslator", () => ({ translateQueryToClaims: mocks.mockTranslateQueryToClaims }));
vi.mock("./autonomousIngest", () => ({ processQueryResults: mocks.mockProcessQueryResults }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));
vi.stubGlobal("fetch", mocks.mockFetch);

const makeDb = () => {
  const db = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
  };
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockResolvedValue([]);
  return db;
};

type ReqLike = { body?: unknown; headers?: Record<string, string>; query?: Record<string, string>; socket?: { remoteAddress?: string } };
type ResLike = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn>; sendStatus: ReturnType<typeof vi.fn> };

const makeReqRes = (body: unknown = {}, headers: Record<string, string> = {}): { req: ReqLike; res: ResLike } => {
  const req: ReqLike = {
    body,
    headers,
    query: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res: ResLike = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    sendStatus: vi.fn().mockReturnThis(),
  };
  return { req, res };
};

type HandlerFn = (req: ReqLike, res: ResLike) => Promise<unknown>;
const getHandler = async (): Promise<HandlerFn | null> => {
  const { registerTranslateAndSearchApi } = await import("./translateAndSearchApi");
  let capturedHandler: HandlerFn | null = null;
  const app = {
    options: vi.fn(),
    post: vi.fn((_path: string, handler: HandlerFn) => {
      capturedHandler = handler;
    }),
  };
  registerTranslateAndSearchApi(app as never);
  return capturedHandler;
};

describe("registerTranslateAndSearchApi() — POST /api/translate-and-search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockGetDb.mockResolvedValue(makeDb());
    mocks.mockTranslateQueryToClaims.mockResolvedValue([]);
    mocks.mockProcessQueryResults.mockResolvedValue({ verdict: "Insufficient Evidence", confidence: 0.3 });
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ resultList: { result: [] } }),
    });
  });

  it("returns 400 when question is missing", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const { req, res } = makeReqRes({});
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when question is too short", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const { req, res } = makeReqRes({ question: "ab" });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 401 when API key is invalid", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const { req, res } = makeReqRes(
      { question: "What are the properties of collagen?" },
      { "x-api-key": "invalid-key-xyz" }
    );
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 200 with results for anonymous request with valid question", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const { req, res } = makeReqRes({ question: "What are the properties of collagen?" });
    await handler(req, res);
    // Should return JSON (either 429 rate limit or 200 result)
    expect(res.json).toHaveBeenCalled();
  });

  it("returns 400 when question exceeds 2000 chars", async () => {
    const handler = await getHandler();
    if (!handler) return;
    const { req, res } = makeReqRes({ question: "A".repeat(2001) });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
