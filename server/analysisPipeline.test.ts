/**
 * analysisPipeline.test.ts
 * Unit tests for server/analysisPipeline.ts — runAnalysisPipeline
 *
 * The pipeline is complex with many dependencies. We test:
 * 1. Draft-tier guard (upgrades draft→verified before re-running)
 * 2. Happy path with zero claims extracted (short-circuits most logic)
 * 3. Error path (updateDocumentStatus throws → pipeline catches and sets error status)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDocumentById: vi.fn(),
  mockUpdateDocumentStatus: vi.fn(),
  mockInsertClaims: vi.fn(),
  mockGetClaimsByDocument: vi.fn(),
  mockExtractClaims: vi.fn(),
  mockGetActiveLLMProvider: vi.fn(),
  mockGetVertical: vi.fn(),
  mockUpsertAuditReport: vi.fn(),
  mockGenerateHtmlReport: vi.fn(),
  mockBuildVerdictSummary: vi.fn(),
  mockCountHighRisk: vi.fn(),
  mockStoragePut: vi.fn(),
  mockNotifyOwner: vi.fn(),
  mockCompileDocumentToWiki: vi.fn(),
  mockIngestSourceToWiki: vi.fn(),
  mockGeneratePdfReport: vi.fn(),
  mockComputeClaimTrajectory: vi.fn(),
  mockSavePrediction: vi.fn(),
  mockDispatchHighRiskAlert: vi.fn(),
  mockNotifyIndexNow: vi.fn(),
  mockNotifyIndexNowBatch: vi.fn(),
  mockClaimUrl: vi.fn(),
  mockReportUrl: vi.fn(),
  mockRecordModelUsage: vi.fn(),
  mockRunSelfPromptCycle: vi.fn(),
  mockRunInversePromptForEntity: vi.fn(),
  mockAnalyzeCitationChain: vi.fn(),
  mockComputeCompositeTruth: vi.fn(),
  mockOpenCitationsEnrichClaim: vi.fn(),
}));

vi.mock("./db", () => ({
  getDocumentById: mocks.mockGetDocumentById,
  updateDocumentStatus: mocks.mockUpdateDocumentStatus,
  insertClaims: mocks.mockInsertClaims,
  getClaimsByDocument: mocks.mockGetClaimsByDocument,
  upsertAuditReport: mocks.mockUpsertAuditReport,
  updateClaimVerdict: vi.fn().mockResolvedValue(undefined),
  insertCitation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./claimExtractor", () => ({
  extractClaims: mocks.mockExtractClaims,
  getActiveLLMProvider: mocks.mockGetActiveLLMProvider,
}));
vi.mock("./passageExtractor", () => ({ extractPassageForClaim: vi.fn().mockResolvedValue("passage") }));
vi.mock("./misrepresentationClassifier", () => ({ classifyMisrepresentation: vi.fn().mockResolvedValue(null) }));
vi.mock("./pdbAdapter", () => ({
  verdictForClaim: vi.fn().mockResolvedValue({ verdict: "Supported", rationale: "ok" }),
  fetchPdbEntry: vi.fn().mockResolvedValue(null),
}));
vi.mock("./verticalAdapters/types", () => ({
  getVertical: mocks.mockGetVertical,
}));
vi.mock("./verticalAdapters", () => ({}));
vi.mock("./verdictEngine", () => ({
  verdictForResolution: vi.fn().mockReturnValue({ verdict: "Supported", rationale: "ok" }),
  classifyByConfidence: vi.fn().mockReturnValue("Supported"),
}));
vi.mock("./completenessCheck", () => ({
  checkPdbCompleteness: vi.fn().mockResolvedValue({ complete: true }),
  checkAdapterCompleteness: vi.fn().mockResolvedValue({ complete: true }),
}));
vi.mock("./reportGenerator", () => ({
  generateHtmlReport: mocks.mockGenerateHtmlReport,
  buildVerdictSummary: mocks.mockBuildVerdictSummary,
  countHighRisk: mocks.mockCountHighRisk,
}));
vi.mock("./storage", () => ({ storagePut: mocks.mockStoragePut }));
vi.mock("./_core/notification", () => ({ notifyOwner: mocks.mockNotifyOwner }));
vi.mock("./wikiCompiler", () => ({ compileDocumentToWiki: mocks.mockCompileDocumentToWiki }));
vi.mock("./wikiEngine", () => ({ ingestSourceToWiki: mocks.mockIngestSourceToWiki, appendLog: vi.fn() }));
vi.mock("./pdfReportGenerator", () => ({ generatePdfReport: mocks.mockGeneratePdfReport }));
vi.mock("./predictionEngine", () => ({
  computeClaimTrajectory: mocks.mockComputeClaimTrajectory,
  savePrediction: mocks.mockSavePrediction,
}));
vi.mock("./alertDispatcher", () => ({ dispatchHighRiskAlert: mocks.mockDispatchHighRiskAlert }));
vi.mock("./seo/indexNow", () => ({
  notifyIndexNow: mocks.mockNotifyIndexNow,
  notifyIndexNowBatch: mocks.mockNotifyIndexNowBatch,
  claimUrl: mocks.mockClaimUrl,
  reportUrl: mocks.mockReportUrl,
}));
vi.mock("./llmProviderQuality", () => ({ recordModelUsage: mocks.mockRecordModelUsage }));
vi.mock("./selfPrompt/engine", () => ({ runSelfPromptCycle: mocks.mockRunSelfPromptCycle }));
vi.mock("./inversePrompt/inversePromptEngine", () => ({
  runInversePromptForEntity: mocks.mockRunInversePromptForEntity,
}));
vi.mock("./citationChainAnalyzer", () => ({ analyzeCitationChain: mocks.mockAnalyzeCitationChain }));
vi.mock("./compositeTruthEngine", () => ({ computeCompositeTruth: mocks.mockComputeCompositeTruth }));
vi.mock("./openCitationsEnricher", () => ({ openCitationsEnrichClaim: mocks.mockOpenCitationsEnrichClaim }));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("runAnalysisPipeline()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.mockGetActiveLLMProvider.mockReturnValue("openai");
    mocks.mockUpdateDocumentStatus.mockResolvedValue(undefined);
    mocks.mockInsertClaims.mockResolvedValue(undefined);
    mocks.mockGetClaimsByDocument.mockResolvedValue([]);
    mocks.mockExtractClaims.mockResolvedValue([]);
    mocks.mockGetVertical.mockReturnValue(null);
    mocks.mockUpsertAuditReport.mockResolvedValue(undefined);
    mocks.mockGenerateHtmlReport.mockReturnValue("<html/>");
    mocks.mockBuildVerdictSummary.mockReturnValue({});
    mocks.mockCountHighRisk.mockReturnValue(0);
    mocks.mockStoragePut.mockResolvedValue({ key: "k", url: "/u" });
    mocks.mockNotifyOwner.mockResolvedValue(true);
    mocks.mockCompileDocumentToWiki.mockResolvedValue(undefined);
    mocks.mockIngestSourceToWiki.mockResolvedValue(undefined);
    mocks.mockGeneratePdfReport.mockResolvedValue({ key: "k", url: "/u" });
    mocks.mockComputeClaimTrajectory.mockResolvedValue(null);
    mocks.mockSavePrediction.mockResolvedValue(undefined);
    mocks.mockDispatchHighRiskAlert.mockResolvedValue(undefined);
    mocks.mockNotifyIndexNow.mockResolvedValue(undefined);
    mocks.mockNotifyIndexNowBatch.mockResolvedValue(undefined);
    mocks.mockClaimUrl.mockReturnValue("https://example.com/claim/1");
    mocks.mockReportUrl.mockReturnValue("https://example.com/report/1");
    mocks.mockRecordModelUsage.mockResolvedValue(undefined);
    mocks.mockRunSelfPromptCycle.mockResolvedValue({ actionsExecuted: 0 });
    mocks.mockRunInversePromptForEntity.mockResolvedValue({ candidatesGenerated: 0 });
    mocks.mockAnalyzeCitationChain.mockResolvedValue(null);
    mocks.mockComputeCompositeTruth.mockResolvedValue(null);
    mocks.mockOpenCitationsEnrichClaim.mockResolvedValue(null);
  });

  it("resolves without error for a fresh pending document with zero claims", async () => {
    mocks.mockGetDocumentById.mockResolvedValue({
      id: 1,
      status: "pending",
      qualityTier: "verified",
      verticalDomain: "structural_biology",
    });
    const { runAnalysisPipeline } = await import("./analysisPipeline");
    await expect(runAnalysisPipeline(1, "Some text", 1)).resolves.toBeUndefined();
    expect(mocks.mockUpdateDocumentStatus).toHaveBeenCalledWith(1, "extracting", expect.anything());
  });

  it("upgrades draft→verified before running when doc is draft+complete", async () => {
    mocks.mockGetDocumentById.mockResolvedValue({
      id: 2,
      status: "complete",
      qualityTier: "draft",
      verticalDomain: "structural_biology",
    });
    const { runAnalysisPipeline } = await import("./analysisPipeline");
    await runAnalysisPipeline(2, "text", 1);
    // Should have called updateDocumentStatus with qualityTier: "verified" first
    expect(mocks.mockUpdateDocumentStatus).toHaveBeenCalledWith(2, "pending", { qualityTier: "verified" });
  });

  it("resolves even when getDocumentById returns null (new doc)", async () => {
    mocks.mockGetDocumentById.mockResolvedValue(null);
    const { runAnalysisPipeline } = await import("./analysisPipeline");
    await expect(runAnalysisPipeline(3, "text", 1)).resolves.toBeUndefined();
  });

  it("sets failed status when extractClaims throws", async () => {
    mocks.mockGetDocumentById.mockResolvedValue(null);
    mocks.mockExtractClaims.mockRejectedValue(new Error("LLM error"));
    const { runAnalysisPipeline } = await import("./analysisPipeline");
    // Pipeline outer catch calls updateDocumentStatus(id, "failed") and resolves
    await expect(runAnalysisPipeline(4, "text", 1)).resolves.toBeUndefined();
    // The outer catch should have called updateDocumentStatus with "failed"
    const calls = mocks.mockUpdateDocumentStatus.mock.calls;
    const failedCall = calls.find((c) => c[1] === "failed");
    expect(failedCall).toBeDefined();
  });
});
