import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  draftGuardStage,
  claimExtractionStage,
  passageExtractionStage,
  misrepresentationClassifierStage,
  adapterRouterStage,
  verdictAggregatorStage,
} from "./stages";
import type { StageContext } from "./stageRegistry";

vi.mock("../db", () => ({
  getClaimsByDocument: vi.fn().mockResolvedValue([
    { id: 1, verdict: "Supported", confidenceScore: 0.9, sourcePassage: "p1", misrepresentationType: "none" },
    { id: 2, verdict: "Contradicted", confidenceScore: 0.3, sourcePassage: null, misrepresentationType: "amplification" },
    { id: 3, verdict: null, confidenceScore: null, sourcePassage: null, misrepresentationType: "unknown" },
  ]),
  getDb: vi.fn().mockResolvedValue(null),
}));

function ctx(overrides: Partial<StageContext> = {}): StageContext {
  return { documentId: 1, documentStatus: "complete", qualityTier: "verified", ...overrides };
}

describe("draftGuardStage", () => {
  it("passes for complete", async () => {
    expect((await draftGuardStage(ctx())).outcome).toBe("PASS");
  });
  it("skips for pending", async () => {
    expect((await draftGuardStage(ctx({ documentStatus: "pending" }))).outcome).toBe("SKIP");
  });
  it("passes for generating_report", async () => {
    expect((await draftGuardStage(ctx({ documentStatus: "generating_report" }))).outcome).toBe("PASS");
  });
});

describe("claimExtractionStage", () => {
  it("returns PASS with extractedClaims", async () => {
    const result = await claimExtractionStage(ctx());
    expect(result.outcome).toBe("PASS");
    expect(result.data?.extractedClaims).toHaveLength(3);
  });
});

describe("passageExtractionStage", () => {
  it("returns PASS with passages that have sourcePassage", async () => {
    const c = ctx({ extractedClaims: [
      { id: 1, sourcePassage: "text" },
      { id: 2, sourcePassage: null },
    ] });
    const result = await passageExtractionStage(c);
    expect(result.outcome).toBe("PASS");
    expect((result.data?.passages as unknown[]).length).toBe(1);
  });
});

describe("misrepresentationClassifierStage", () => {
  it("returns PASS and counts classified contradicted claims", async () => {
    const c = ctx({ extractedClaims: [
      { verdict: "Contradicted", misrepresentationType: "amplification" },
      { verdict: "Contradicted", misrepresentationType: "unknown" },
      { verdict: "Supported", misrepresentationType: "none" },
    ] });
    const result = await misrepresentationClassifierStage(c);
    expect(result.outcome).toBe("PASS");
    expect(result.reason).toContain("1/2");
  });
});

describe("adapterRouterStage", () => {
  it("returns PASS with adapter result", async () => {
    const result = await adapterRouterStage(ctx());
    expect(result.outcome).toBe("PASS");
    expect(result.data?.adapterResult).toBeDefined();
  });
});

describe("verdictAggregatorStage", () => {
  it("returns PASS with verdict summary", async () => {
    const c = ctx({ extractedClaims: [
      { verdict: "Supported" }, { verdict: "Supported" }, { verdict: "Contradicted" }
    ] });
    const result = await verdictAggregatorStage(c);
    expect(result.outcome).toBe("PASS");
    const summary = result.data?.verdictSummary as Record<string, number>;
    expect(summary["Supported"]).toBe(2);
    expect(summary["Contradicted"]).toBe(1);
  });
});
