/**
 * pdfReportGenerator.test.ts
 * Unit tests for server/pdfReportGenerator.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetDocumentById: vi.fn(),
  mockGetClaimsByDocument: vi.fn(),
  mockGetAuditReportByDocument: vi.fn(),
}));

vi.mock("./db", () => ({
  getDocumentById: mocks.mockGetDocumentById,
  getClaimsByDocument: mocks.mockGetClaimsByDocument,
  getAuditReportByDocument: mocks.mockGetAuditReportByDocument,
}));
vi.mock("./logger", () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  errData: vi.fn((e: unknown) => ({ err: String(e) })),
}));

describe("generatePdfReport()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("throws when document is not found", async () => {
    mocks.mockGetDocumentById.mockResolvedValue(null);
    mocks.mockGetClaimsByDocument.mockResolvedValue([]);
    mocks.mockGetAuditReportByDocument.mockResolvedValue(null);
    const { generatePdfReport } = await import("./pdfReportGenerator");
    await expect(generatePdfReport(999)).rejects.toThrow();
  });

  it("returns a Buffer when document exists", async () => {
    mocks.mockGetDocumentById.mockResolvedValue({
      id: 1,
      title: "Test Paper",
      status: "complete",
      userId: 1,
      vertical: "structural_biology",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    mocks.mockGetClaimsByDocument.mockResolvedValue([
      {
        id: 1,
        claimText: "Protein X is involved in Y",
        verdict: "Supported",
        confidenceScore: 0.9,
        createdAt: Date.now(),
      },
    ]);
    mocks.mockGetAuditReportByDocument.mockResolvedValue({
      id: 1,
      summary: "Test summary",
      overallScore: 85,
      createdAt: Date.now(),
    });
    const { generatePdfReport } = await import("./pdfReportGenerator");
    const result = await generatePdfReport(1);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });
});
