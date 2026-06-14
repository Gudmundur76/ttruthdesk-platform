/**
 * seedKnowledgeGraph.test.ts
 * Unit tests for server/seedKnowledgeGraph.ts
 *
 * seedKnowledgeGraph.ts is a standalone script (no exports) that calls
 * main() → process.exit(0) at the bottom.
 *
 * Key: fetchPubmedAbstract and fetchPmcFullText are LOCAL functions that use
 * global fetch — we must stub fetch globally, not mock a module import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetAutoIngestedPaperByPmid: vi.fn(),
  mockCreateDocument: vi.fn(),
  mockUpdateDocumentStatus: vi.fn(),
  mockUpsertAutoIngestedPaper: vi.fn(),
  mockRunAnalysisPipeline: vi.fn(),
  mockProcessExit: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));
vi.mock("./_core/env", () => ({
  ENV: { databaseUrl: "mysql://test", heartbeatSecret: "test-secret" },
}));
vi.mock("./db", () => ({
  getDb: vi.fn(() => null),
  getDbOrThrow: vi.fn(() => { throw new Error("No DB in test"); }),
  createDocument: mocks.mockCreateDocument,
  updateDocumentStatus: mocks.mockUpdateDocumentStatus,
  upsertAutoIngestedPaper: mocks.mockUpsertAutoIngestedPaper,
  getAutoIngestedPaperByPmid: mocks.mockGetAutoIngestedPaperByPmid,
}));
vi.mock("./analysisPipeline", () => ({
  runAnalysisPipeline: mocks.mockRunAnalysisPipeline,
}));

describe("seedKnowledgeGraph script", () => {
  let originalExit: typeof process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    originalExit = process.exit;
    process.exit = mocks.mockProcessExit as unknown as typeof process.exit;
    vi.useFakeTimers();

    // Default: all papers already ingested (skipped path — fastest)
    mocks.mockGetAutoIngestedPaperByPmid.mockResolvedValue({
      id: 1,
      pmid: "12345678",
      status: "completed",
    });
    mocks.mockUpsertAutoIngestedPaper.mockResolvedValue(undefined);
    mocks.mockCreateDocument.mockResolvedValue(1);
    mocks.mockUpdateDocumentStatus.mockResolvedValue(undefined);
    mocks.mockRunAnalysisPipeline.mockResolvedValue({ status: "completed" });

    // Default fetch: return 404 so fetchPubmedAbstract returns null quickly
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "",
      json: async () => ({}),
    }));
  });

  afterEach(() => {
    process.exit = originalExit;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs main() and calls process.exit(0) when all papers are skipped", async () => {
    const importPromise = import("./seedKnowledgeGraph");
    await vi.runAllTimersAsync();
    await importPromise;
    await vi.runAllTimersAsync();
    expect(mocks.mockProcessExit).toHaveBeenCalledWith(0);
  }, 10_000);

  it("skips papers that are already ingested with non-failed status", async () => {
    mocks.mockGetAutoIngestedPaperByPmid.mockResolvedValue({
      id: 42,
      pmid: "38234567",
      status: "completed",
    });

    const importPromise = import("./seedKnowledgeGraph");
    await vi.runAllTimersAsync();
    await importPromise;
    await vi.runAllTimersAsync();

    // fetch (used by fetchPubmedAbstract) should NOT be called for skipped papers
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(mocks.mockProcessExit).toHaveBeenCalledWith(0);
  }, 10_000);

  it("processes a failed paper by calling fetch for PubMed data", async () => {
    // First call returns failed, rest return completed
    mocks.mockGetAutoIngestedPaperByPmid
      .mockResolvedValueOnce({ id: 1, pmid: "38234567", status: "failed" })
      .mockResolvedValue({ id: 2, status: "completed" });

    // fetch returns 404 → fetchPubmedAbstract returns null → paper marked as failed
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "",
      json: async () => ({}),
    }));

    const importPromise = import("./seedKnowledgeGraph");
    await vi.runAllTimersAsync();
    await importPromise;
    await vi.runAllTimersAsync();

    // fetch should have been called for the failed paper's PubMed lookup
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    // upsertAutoIngestedPaper should be called with failed status
    expect(mocks.mockUpsertAutoIngestedPaper).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
    expect(mocks.mockProcessExit).toHaveBeenCalledWith(0);
  }, 10_000);
});
