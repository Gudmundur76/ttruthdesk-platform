/**
 * calibration.test.ts
 * Tests for adapterCalibration, calibrationReport, promptTemplates, batchCalibration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assignFailureGroup,
  calibrateAdapter,
  calibrateAdapterFull,
} from "./adapterCalibration";
import {
  buildCalibrationReport,
  exportReportToCsv,
  compareCalibrationResults,
  summariseDocumentResults,
} from "./calibrationReport";
import {
  generateG1Prompt,
  rewriteG2Prompt,
  enhanceG3Prompt,
} from "./promptTemplates";
import type { VerticalAdapter } from "../types";
import type { TestDocument } from "./testDocuments";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../claimExtractor", () => ({
  extractClaims: vi.fn(),
}));

import { extractClaims } from "../../claimExtractor";
const mockExtractClaims = vi.mocked(extractClaims);

function makeAdapter(domainKey: string, evidenceFound = true): VerticalAdapter {
  return {
    domainKey,
    displayName: `Test ${domainKey}`,
    description: "Test adapter",
    claimExtractorPrompt: `Extract claims about ${domainKey}`,
    lookupEvidence: vi.fn().mockResolvedValue({ found: evidenceFound, sources: [] }),
    discoverySearchTerms: ["test"],
  };
}

function makeDoc(id: "D1" | "D2" | "D3" | "D4" | "D5"): TestDocument {
  return { id, label: `Doc ${id}`, description: "Test document", text: `Sample text for ${id}` };
}

function makeClaim(text: string) {
  return {
    claimText: text,
    extractedValue: null,
    claimType: "structural",
    domainFields: {},
    pdbId: null,
    proteinName: null,
    experimentalMethod: null,
    resolution: null,
    organism: null,
    ligand: null,
  };
}

// ─── assignFailureGroup ───────────────────────────────────────────────────────

describe("assignFailureGroup", () => {
  it("returns G1 when avgPrecision < 0.3", () => {
    expect(assignFailureGroup(0.2, 0.5, 0.5)).toBe("G1");
  });

  it("returns G2 when avgRecall > 0.9 and avgPrecision < 0.5", () => {
    expect(assignFailureGroup(0.4, 0.95, 0.5)).toBe("G2");
  });

  it("returns G3 when supportedRate < 0.15", () => {
    expect(assignFailureGroup(0.6, 0.5, 0.1)).toBe("G3");
  });

  it("returns G4 when all metrics are acceptable", () => {
    expect(assignFailureGroup(0.7, 0.6, 0.5)).toBe("G4");
  });

  it("G1 takes priority over G2 when precision is very low", () => {
    expect(assignFailureGroup(0.1, 0.95, 0.05)).toBe("G1");
  });
});

// ─── calibrateAdapter ─────────────────────────────────────────────────────────

describe("calibrateAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct counts when extraction succeeds and evidence is found", async () => {
    const adapter = makeAdapter("protein");
    const doc = makeDoc("D1");
    mockExtractClaims.mockResolvedValue([makeClaim("p53 is 2.1 angstroms"), makeClaim("BRCA1 is mutated")]);

    const result = await calibrateAdapter(adapter, doc);

    expect(result.adapterId).toBe("protein");
    expect(result.documentId).toBe("D1");
    expect(result.claimsExtracted).toBe(2);
    expect(result.claimsSupported).toBe(2);
    expect(result.claimsUnverifiable).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.precisionScore).toBe(1.0);
    expect(result.f1Score).toBeGreaterThan(0);
  });

  it("counts unverifiable when evidence not found", async () => {
    const adapter = makeAdapter("protein", false);
    const doc = makeDoc("D2");
    mockExtractClaims.mockResolvedValue([makeClaim("vague claim")]);

    const result = await calibrateAdapter(adapter, doc);

    expect(result.claimsUnverifiable).toBe(1);
    expect(result.claimsSupported).toBe(0);
    expect(result.precisionScore).toBe(0);
  });

  it("handles extraction failure gracefully", async () => {
    const adapter = makeAdapter("protein");
    const doc = makeDoc("D3");
    mockExtractClaims.mockRejectedValue(new Error("LLM timeout"));

    const result = await calibrateAdapter(adapter, doc);

    expect(result.claimsExtracted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("extract:");
  });

  it("handles verification failure gracefully and counts as refuted", async () => {
    const adapter = makeAdapter("protein");
    const doc = makeDoc("D4");
    mockExtractClaims.mockResolvedValue([makeClaim("some claim")]);
    vi.mocked(adapter.lookupEvidence).mockRejectedValue(new Error("API error"));

    const result = await calibrateAdapter(adapter, doc);

    expect(result.claimsRefuted).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});

// ─── calibrateAdapterFull ─────────────────────────────────────────────────────

describe("calibrateAdapterFull", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates results across all documents", async () => {
    const adapter = makeAdapter("economics");
    const docs = [makeDoc("D1"), makeDoc("D2"), makeDoc("D3")];
    mockExtractClaims.mockResolvedValue([makeClaim("GDP grew 3%")]);

    const summary = await calibrateAdapterFull(adapter, docs);

    expect(summary.adapterId).toBe("economics");
    expect(summary.results).toHaveLength(3);
    expect(summary.avgF1).toBeGreaterThan(0);
    expect(["G1", "G2", "G3", "G4"]).toContain(summary.failureGroup);
  });
});

// ─── buildCalibrationReport ───────────────────────────────────────────────────

describe("buildCalibrationReport", () => {
  it("correctly counts group distribution", () => {
    const summaries = [
      { adapterId: "a1", results: [], avgPrecision: 0.2, avgRecall: 0.5, avgF1: 0.3, failureGroup: "G1" as const, totalErrors: 0 },
      { adapterId: "a2", results: [], avgPrecision: 0.4, avgRecall: 0.95, avgF1: 0.5, failureGroup: "G2" as const, totalErrors: 0 },
      { adapterId: "a3", results: [], avgPrecision: 0.6, avgRecall: 0.5, avgF1: 0.5, failureGroup: "G4" as const, totalErrors: 0 },
    ];
    const report = buildCalibrationReport("run-001", summaries);

    expect(report.groupCounts.G1).toBe(1);
    expect(report.groupCounts.G2).toBe(1);
    expect(report.groupCounts.G3).toBe(0);
    expect(report.groupCounts.G4).toBe(1);
    expect(report.totalAdapters).toBe(3);
    expect(report.runId).toBe("run-001");
  });

  it("computes overall averages correctly", () => {
    const summaries = [
      { adapterId: "a1", results: [], avgPrecision: 0.4, avgRecall: 0.6, avgF1: 0.5, failureGroup: "G4" as const, totalErrors: 0 },
      { adapterId: "a2", results: [], avgPrecision: 0.6, avgRecall: 0.8, avgF1: 0.7, failureGroup: "G4" as const, totalErrors: 0 },
    ];
    const report = buildCalibrationReport("run-002", summaries);

    expect(report.avgPrecisionOverall).toBeCloseTo(0.5);
    expect(report.avgRecallOverall).toBeCloseTo(0.7);
    expect(report.avgF1Overall).toBeCloseTo(0.6);
  });
});

// ─── exportReportToCsv ────────────────────────────────────────────────────────

describe("exportReportToCsv", () => {
  it("produces valid CSV with header and data rows", () => {
    const summaries = [
      { adapterId: "protein", results: [], avgPrecision: 0.75, avgRecall: 0.6, avgF1: 0.67, failureGroup: "G4" as const, totalErrors: 2 },
    ];
    const report = buildCalibrationReport("run-csv", summaries);
    const csv = exportReportToCsv(report);
    const lines = csv.split("\n");

    expect(lines[0]).toBe("adapterId,avgPrecision,avgRecall,avgF1,failureGroup,totalErrors");
    expect(lines[1]).toContain("protein");
    expect(lines[1]).toContain("G4");
    expect(lines[1]).toContain("2");
  });
});

// ─── compareCalibrationResults ────────────────────────────────────────────────

describe("compareCalibrationResults", () => {
  it("correctly computes deltas and marks improvements", () => {
    const makeSummary = (id: string, f1: number, group: "G1" | "G2" | "G3" | "G4") => ({
      adapterId: id, results: [], avgPrecision: f1, avgRecall: f1, avgF1: f1, failureGroup: group, totalErrors: 0,
    });
    const before = buildCalibrationReport("before", [makeSummary("a1", 0.4, "G2"), makeSummary("a2", 0.7, "G4")]);
    const after = buildCalibrationReport("after", [makeSummary("a1", 0.65, "G4"), makeSummary("a2", 0.6, "G4")]);

    const comparison = compareCalibrationResults(before, after);

    expect(comparison).toHaveLength(2);
    const a1 = comparison.find((c) => c.adapterId === "a1")!;
    expect(a1.improved).toBe(true);
    expect(a1.delta).toBeCloseTo(0.25);
    expect(a1.beforeGroup).toBe("G2");
    expect(a1.afterGroup).toBe("G4");

    const a2 = comparison.find((c) => c.adapterId === "a2")!;
    expect(a2.improved).toBe(false);
  });

  it("sorts results by delta descending", () => {
    const makeSummary = (id: string, f1: number) => ({
      adapterId: id, results: [], avgPrecision: f1, avgRecall: f1, avgF1: f1, failureGroup: "G4" as const, totalErrors: 0,
    });
    const before = buildCalibrationReport("b", [makeSummary("a1", 0.3), makeSummary("a2", 0.5)]);
    const after = buildCalibrationReport("a", [makeSummary("a1", 0.8), makeSummary("a2", 0.6)]);

    const comparison = compareCalibrationResults(before, after);
    expect(comparison[0].adapterId).toBe("a1"); // larger delta first
  });
});

// ─── promptTemplates ──────────────────────────────────────────────────────────

describe("generateG1Prompt", () => {
  it("replaces {text} placeholder with the provided text", () => {
    const result = generateG1Prompt("Some test text");
    expect(result).toContain("Some test text");
    expect(result).not.toContain("{text}");
  });

  it("includes the G1 template header", () => {
    const result = generateG1Prompt("text");
    expect(result).toContain("scientific claim extractor");
  });
});

describe("rewriteG2Prompt", () => {
  it("appends the G2 constraint block", () => {
    const result = rewriteG2Prompt("Extract proteins from text.");
    expect(result).toContain("CONSTRAINT");
    expect(result).toContain("named entity");
  });

  it("removes the original Return: instruction", () => {
    const original = "Extract proteins.\nReturn: [{\"claimText\": \"...\"}]";
    const result = rewriteG2Prompt(original);
    // The original Return: should be gone, replaced by G2_CLAIM_SENTENCE_CONSTRAINT's Return:
    expect(result).not.toContain("Extract proteins.\nReturn:");
    expect(result).toContain("CONSTRAINT");
  });
});

describe("enhanceG3Prompt", () => {
  it("appends the G3 verification criteria block", () => {
    const result = enhanceG3Prompt("Extract claims.");
    expect(result).toContain("VERIFICATION CRITERIA");
    expect(result).toContain("DO NOT extract");
  });

  it("preserves the original prompt text", () => {
    const original = "Extract claims about proteins.";
    const result = enhanceG3Prompt(original);
    expect(result).toContain(original);
  });
});

// ─── summariseDocumentResults ─────────────────────────────────────────────────

describe("summariseDocumentResults", () => {
  it("returns per-document precision/recall/f1", () => {
    const results = [
      { adapterId: "a", documentId: "doc1", claimsExtracted: 5, claimsSupported: 4, claimsRefuted: 0, claimsUnverifiable: 1, extractionRateMs: 100, verificationRateMs: 200, precisionScore: 0.8, recallScore: 0.5, f1Score: 0.615, errors: [] },
      { adapterId: "a", documentId: "doc2", claimsExtracted: 3, claimsSupported: 3, claimsRefuted: 0, claimsUnverifiable: 0, extractionRateMs: 80, verificationRateMs: 150, precisionScore: 1.0, recallScore: 0.3, f1Score: 0.46, errors: [] },
    ];
    const summary = summariseDocumentResults(results);

    expect(summary["doc1"].precision).toBeCloseTo(0.8);
    expect(summary["doc2"].precision).toBeCloseTo(1.0);
    expect(Object.keys(summary)).toHaveLength(2);
  });
});
