/**
 * sitemapRoute.test.ts
 * Unit tests for server/sitemapRoute.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetCompletedPublicPapers: vi.fn(),
  mockGetPublicGraphEntities: vi.fn(),
  mockGetPublicClaims: vi.fn(),
}));

vi.mock("./db", () => ({
  getCompletedPublicPapers: mocks.mockGetCompletedPublicPapers,
  getAllGraphEntities: mocks.mockGetPublicGraphEntities,
  getVerifiedClaimsForSitemap: mocks.mockGetPublicClaims,
}));
vi.mock("./wikiCompiler", () => ({ slugify: (s: string) => s.toLowerCase().replace(/\s+/g, "-") }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

type ReqLike = { headers: Record<string, string>; protocol?: string };
type ResLike = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

const makeReqRes = (headers: Record<string, string> = {}): { req: ReqLike; res: ResLike } => ({
  req: { headers, protocol: "https" },
  res: {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  },
});

type SitemapHandlerFn = (req: ReqLike, res: ResLike) => Promise<void>;

describe("registerSitemapRoute()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockGetCompletedPublicPapers.mockResolvedValue([]);
    mocks.mockGetPublicGraphEntities.mockResolvedValue([]);
    mocks.mockGetPublicClaims.mockResolvedValue([]);
  });

  it("registers a GET /sitemap.xml route on the express app", async () => {
    const { registerSitemapRoute } = await import("./sitemapRoute");
    const app = { get: vi.fn() };
    registerSitemapRoute(app as never);
    expect(app.get).toHaveBeenCalledWith("/sitemap.xml", expect.any(Function));
  });

  it("returns XML with static pages when no dynamic content exists", async () => {
    const { registerSitemapRoute } = await import("./sitemapRoute");
    let capturedHandler: SitemapHandlerFn | null = null;
    const app = {
      get: vi.fn((_path: string, handler: SitemapHandlerFn) => {
        capturedHandler = handler;
      }),
    };
    registerSitemapRoute(app as never);
    if (!capturedHandler) throw new Error("Handler not captured");
    const { req, res } = makeReqRes({ host: "truthdesk.claims" });
    await (capturedHandler as SitemapHandlerFn)(req, res);
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ "Content-Type": expect.stringContaining("application/xml") }));
    const xmlContent = vi.mocked(res.send).mock.calls[0][0] as string;
    expect(xmlContent).toContain("<?xml");
    expect(xmlContent).toContain("urlset");
    expect(xmlContent).toContain("/registry");
  });

  it("includes dynamic paper URLs in sitemap", async () => {
    mocks.mockGetCompletedPublicPapers.mockResolvedValue([
      { documentId: 42, updatedAt: Date.now() },
    ]);
    const { registerSitemapRoute } = await import("./sitemapRoute");
    let capturedHandler: SitemapHandlerFn | null = null;
    const app = {
      get: vi.fn((_path: string, handler: SitemapHandlerFn) => {
        capturedHandler = handler;
      }),
    };
    registerSitemapRoute(app as never);
    if (!capturedHandler) throw new Error("Handler not captured");
    const { req, res } = makeReqRes({ host: "truthdesk.claims" });
    await (capturedHandler as SitemapHandlerFn)(req, res);
    const xmlContent = vi.mocked(res.send).mock.calls[0][0] as string;
    expect(xmlContent).toContain("/reports/42");
  });
});
