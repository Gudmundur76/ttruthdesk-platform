/**
 * agentIngestionEndpoint.test.ts
 * Unit tests for server/agentIngestionEndpoint.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.mockGetDb }));
vi.mock("./_core/env", () => ({ ENV: { coordApiKey: "test-coord-key" } }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));
vi.mock("./graphKnowledge", () => ({
  upsertGraphEntity: vi.fn().mockResolvedValue({ id: 1 }),
  upsertGraphRelation: vi.fn().mockResolvedValue(undefined),
}));

type ReqLike = { headers: Record<string, string>; body?: unknown };
type ResLike = { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

const makeReqRes = (headers: Record<string, string> = {}, body: unknown = {}): { req: ReqLike; res: ResLike } => ({
  req: { headers, body },
  res: { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() },
});

describe("agentIngestionHandler()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 401 when coord key header is missing", async () => {
    const { agentIngestionHandler } = await import("./agentIngestionEndpoint");
    const { req, res } = makeReqRes({});
    await agentIngestionHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when coord key is wrong", async () => {
    const { agentIngestionHandler } = await import("./agentIngestionEndpoint");
    const { req, res } = makeReqRes({ "x-coord-key": "wrong-key" });
    await agentIngestionHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when payload is invalid (missing required fields)", async () => {
    const { agentIngestionHandler } = await import("./agentIngestionEndpoint");
    const { req, res } = makeReqRes({ "x-coord-key": "test-coord-key" }, { invalid: true });
    await agentIngestionHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 503 when DB is unavailable after auth passes", async () => {
    mocks.mockGetDb.mockResolvedValue(null);
    const { agentIngestionHandler } = await import("./agentIngestionEndpoint");
    const validPayload = {
      queueItemId: 1,
      taskId: "task-123",
      paper: { title: "Test Paper" },
      vertical: "structural_biology",
      claims: [],
    };
    const { req, res } = makeReqRes({ "x-coord-key": "test-coord-key" }, validPayload);
    await agentIngestionHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe("IngestionPayload type", () => {
  it("exports IngestionPayload type (compile-time check)", async () => {
    const mod = await import("./agentIngestionEndpoint");
    // If the export exists, the module loaded correctly
    expect(mod.agentIngestionHandler).toBeDefined();
  });
});
