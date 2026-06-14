/**
 * wikiLintJob.test.ts
 * Unit tests for server/wikiLintJob.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockLintWiki: vi.fn(),
  mockBuildIndex: vi.fn(),
  mockNotifyOwner: vi.fn(),
}));

vi.mock("./wikiEngine", () => ({
  lintWiki: mocks.mockLintWiki,
  buildIndex: mocks.mockBuildIndex,
}));
vi.mock("./_core/notification", () => ({ notifyOwner: mocks.mockNotifyOwner }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

const makeLintResult = () => ({
  contradictions: [{ pageSlug: "page-1", conflictingSlug: "page-2", reason: "conflict" }],
  orphanSlugs: ["orphan-1"],
  stalePageSlugs: [],
  missingCrossRefs: ["ref-1", "ref-2"],
  summary: "Wiki lint complete with 1 contradiction",
});

const makeReqRes = () => {
  const req = { headers: {} };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return { req, res };
};

describe("wikiEngineLintJobHandler()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockLintWiki.mockResolvedValue(makeLintResult());
    mocks.mockBuildIndex.mockResolvedValue(undefined);
    mocks.mockNotifyOwner.mockResolvedValue(true);
  });

  it("returns ok:true with lint summary on success", async () => {
    const { wikiEngineLintJobHandler } = await import("./wikiLintJob");
    const { req, res } = makeReqRes();
    await wikiEngineLintJobHandler(req as never, res as never);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      contradictions: 1,
      orphanSlugs: 1,
      stalePageSlugs: 0,
      missingCrossRefs: 2,
    }));
  });

  it("calls buildIndex after lintWiki", async () => {
    const { wikiEngineLintJobHandler } = await import("./wikiLintJob");
    const { req, res } = makeReqRes();
    await wikiEngineLintJobHandler(req as never, res as never);
    expect(mocks.mockLintWiki).toHaveBeenCalledOnce();
    expect(mocks.mockBuildIndex).toHaveBeenCalledOnce();
  });

  it("sends notification to owner with summary", async () => {
    const { wikiEngineLintJobHandler } = await import("./wikiLintJob");
    const { req, res } = makeReqRes();
    await wikiEngineLintJobHandler(req as never, res as never);
    expect(mocks.mockNotifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      title: "Wiki Engine Lint Report",
    }));
  });

  it("returns 500 when lintWiki throws", async () => {
    mocks.mockLintWiki.mockRejectedValue(new Error("DB error"));
    const { wikiEngineLintJobHandler } = await import("./wikiLintJob");
    const { req, res } = makeReqRes();
    await wikiEngineLintJobHandler(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it("continues even when notifyOwner fails (non-fatal)", async () => {
    mocks.mockNotifyOwner.mockRejectedValue(new Error("Notification failed"));
    const { wikiEngineLintJobHandler } = await import("./wikiLintJob");
    const { req, res } = makeReqRes();
    await wikiEngineLintJobHandler(req as never, res as never);
    // Should still return ok:true despite notification failure
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});
