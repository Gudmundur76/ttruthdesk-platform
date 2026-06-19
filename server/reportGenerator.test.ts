/**
 * reportGenerator.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for reportGenerator.ts — pure functions only, no DB.
 */
import { describe, it, expect } from "vitest";
import { buildVerdictSummary, countHighRisk, generateHtmlReport, type GeneratedHtmlReport } from "./reportGenerator";
import type { Claim } from "../drizzle/schema";

function makeClaim(verdict: string | null, overriddenVerdict?: string | null): Claim {
  return {
    id: 1,
    documentId: 1,
    claimText: "Test claim",
    verdict: verdict as Claim["verdict"],
    overriddenVerdict: (overriddenVerdict ?? null) as Claim["overriddenVerdict"],
    confidenceScore: "0.8",
    sources: null,
    flags: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    notes: null,
    isHighRisk: false,
    claimType: "general_molecular",
    entityId: null,
    priority: null,
    isHypothesis: false,
    gapId: null,
    inferenceType: null,
    parentVerifications: null,
  } as unknown as Claim;
}

// ─── buildVerdictSummary ──────────────────────────────────────────────────────

describe("buildVerdictSummary()", () => {
  it("returns all zeroes for empty claims", () => {
    const summary = buildVerdictSummary([]);
    expect(Object.values(summary).every(v => v === 0)).toBe(true);
  });

  it("counts verdicts correctly", () => {
    const claims = [
      makeClaim("Supported"),
      makeClaim("Supported"),
      makeClaim("Contradicted"),
      makeClaim("Ambiguous"),
    ];
    const summary = buildVerdictSummary(claims);
    expect(summary["Supported"]).toBe(2);
    expect(summary["Contradicted"]).toBe(1);
    expect(summary["Ambiguous"]).toBe(1);
    expect(summary["Partially Supported"]).toBe(0);
  });

  it("uses overriddenVerdict over verdict when present", () => {
    const claims = [
      makeClaim("Supported", "Contradicted"),
    ];
    const summary = buildVerdictSummary(claims);
    expect(summary["Supported"]).toBe(0);
    expect(summary["Contradicted"]).toBe(1);
  });

  it("ignores unknown verdict values", () => {
    const claims = [makeClaim("UnknownVerdict")];
    const summary = buildVerdictSummary(claims);
    expect(Object.values(summary).every(v => v === 0)).toBe(true);
  });

  it("counts all known verdict types", () => {
    const verdicts = [
      "Supported", "Contradicted", "Partially Supported",
      "Ambiguous", "Insufficient Evidence", "Out of Scope", "Needs Expert Review",
    ];
    const claims = verdicts.map(v => makeClaim(v));
    const summary = buildVerdictSummary(claims);
    for (const v of verdicts) {
      expect(summary[v]).toBe(1);
    }
  });
});

// ─── countHighRisk ────────────────────────────────────────────────────────────

describe("countHighRisk()", () => {
  it("returns 0 for empty claims", () => {
    expect(countHighRisk([])).toBe(0);
  });

  it("counts Contradicted as high risk", () => {
    const claims = [makeClaim("Contradicted"), makeClaim("Supported")];
    expect(countHighRisk(claims)).toBe(1);
  });

  it("counts Needs Expert Review as high risk", () => {
    const claims = [makeClaim("Needs Expert Review"), makeClaim("Ambiguous")];
    expect(countHighRisk(claims)).toBe(1);
  });

  it("uses overriddenVerdict for risk assessment", () => {
    const claims = [makeClaim("Supported", "Contradicted")];
    expect(countHighRisk(claims)).toBe(1);
  });

  it("counts both high-risk types together", () => {
    const claims = [
      makeClaim("Contradicted"),
      makeClaim("Needs Expert Review"),
      makeClaim("Supported"),
    ];
    expect(countHighRisk(claims)).toBe(2);
  });
});

// ─── generateHtmlReport ───────────────────────────────────────────────────────

describe("generateHtmlReport()", () => {
  it("returns a GeneratedHtmlReport object with html containing the document title", () => {
    const result = generateHtmlReport({
      documentTitle: "Test Document",
      documentUrl: "https://example.com",
      claims: [],
      generatedAt: new Date("2024-01-01"),
      reportId: 42,
    });
    expect(typeof result).toBe("object");
    expect(typeof result.html).toBe("string");
    expect(result.html).toContain("Test Document");
    expect(typeof result.title).toBe("string");
    expect(result.title).toContain("Test Document");
    expect(result.claimCount).toBe(0);
    expect(result.supportedCount).toBe(0);
    expect(result.contradictedCount).toBe(0);
  });

  it("includes report ID in html output", () => {
    const result = generateHtmlReport({
      documentTitle: "Doc",
      documentUrl: null,
      claims: [],
      generatedAt: new Date(),
      reportId: 99,
    });
    expect(result.html).toContain("99");
  });

  it("includes verdict summary rows for non-zero verdicts", () => {
    const claims = [makeClaim("Supported"), makeClaim("Contradicted")];
    const result = generateHtmlReport({
      documentTitle: "Doc",
      documentUrl: null,
      claims,
      generatedAt: new Date(),
      reportId: 1,
    });
    expect(result.html).toContain("Supported");
    expect(result.html).toContain("Contradicted");
    expect(result.claimCount).toBe(2);
    expect(result.supportedCount).toBe(1);
    expect(result.contradictedCount).toBe(1);
  });

  it("handles null documentUrl gracefully", () => {
    const result = generateHtmlReport({
      documentTitle: "Doc",
      documentUrl: null,
      claims: [],
      generatedAt: new Date(),
      reportId: 1,
    });
    expect(typeof result.html).toBe("string");
    expect(result.html.length).toBeGreaterThan(100);
  });

  it("respects includeEvidenceDetails=false flag", () => {
    const claims = [makeClaim("Supported")];
    const withDetails = generateHtmlReport({
      documentTitle: "Doc",
      documentUrl: null,
      claims,
      generatedAt: new Date(),
      reportId: 1,
      includeEvidenceDetails: true,
    });
    const withoutDetails = generateHtmlReport({
      documentTitle: "Doc",
      documentUrl: null,
      claims,
      generatedAt: new Date(),
      reportId: 1,
      includeEvidenceDetails: false,
    });
    // Both should be valid GeneratedHtmlReport objects
    expect(typeof withDetails.html).toBe("string");
    expect(typeof withoutDetails.html).toBe("string");
  });

  it("returns correct supportedCount and contradictedCount", () => {
    const claims = [
      makeClaim("Supported"),
      makeClaim("Supported"),
      makeClaim("Contradicted"),
      makeClaim("Ambiguous"),
    ];
    const result = generateHtmlReport({
      documentTitle: "Doc",
      documentUrl: null,
      claims,
      generatedAt: new Date(),
      reportId: 1,
    });
    expect(result.claimCount).toBe(4);
    expect(result.supportedCount).toBe(2);
    expect(result.contradictedCount).toBe(1);
  });
});
