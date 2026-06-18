import { describe, it, expect, vi } from "vitest";
import {
  compositeTruthEngineStage,
  reportGeneratorStage,
  confidenceTrendStage,
  predictionRecordStage,
  pipelineAuditorStage,
} from "./stagesPhase56";
import type { StageContext } from "./stageRegistry";

vi.mock("../db", () => ({
  getClaimsByDocument: vi.fn().mockResolvedValue([
    { confidenceScore: 0.9, verdict: "Supported" },
    { confidenceScore: 0.7, verdict: "Supported" },
    { confidenceScore: 0.3, verdict: "Contradicted" },
  ]),
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../drizzle/schema", () => ({
  auditReports: { documentId: "documentId" },
  frontierDirectives: { sourceLayer: "sourceLayer" },
}));

function ctx(overrides: Partial<StageContext> = {}): StageContext {
  return { documentId: 1, documentStatus: "complete", qualityTier: "verified", ...overrides };
}

describe("compositeTruthEngineStage", () => {
  it("returns PASS with compositeScore and label", async () => {
    const c = ctx({ extractedClaims: [
      { verdict: "Supported", confidenceScore: 0.9 },
      { verdict: "Supported", confidenceScore: 0.8 },
      { verdict: "Contradicted", confidenceScore: 0.2 },
    ] });
    const result = await compositeTruthEngineStage(c);
    expect(result.outcome).toBe("PASS");
    expect(result.data?.compositeScore).toBeDefined();
    expect(result.data?.compositeLabel).toBeDefined();
  });

  it("returns SKIP for empty claims", async () => {
    const result = await compositeTruthEngineStage(ctx({ extractedClaims: [] }));
    expect(result.outcome).toBe("SKIP");
  });
});

describe("reportGeneratorStage", () => {
  it("returns SKIP when DB unavailable", async () => {
    const result = await reportGeneratorStage(ctx());
    expect(result.outcome).toBe("SKIP");
  });
});

describe("confidenceTrendStage", () => {
  it("returns PASS with trend data", async () => {
    const result = await confidenceTrendStage(ctx());
    expect(result.outcome).toBe("PASS");
    expect(result.data?.confidenceTrend).toBeDefined();
  });
});

describe("predictionRecordStage", () => {
  it("returns SKIP when DB unavailable", async () => {
    const result = await predictionRecordStage(ctx());
    expect(result.outcome).toBe("SKIP");
  });
});

describe("pipelineAuditorStage", () => {
  it("returns PASS with correlationId in data", async () => {
    const result = await pipelineAuditorStage(ctx({ correlationId: "test-corr-id" }));
    expect(result.outcome).toBe("PASS");
    expect(result.data?.correlationId).toBe("test-corr-id");
  });

  it("generates correlationId if not provided", async () => {
    const result = await pipelineAuditorStage(ctx());
    expect(result.outcome).toBe("PASS");
    expect(typeof result.data?.correlationId).toBe("string");
    expect((result.data?.correlationId as string).length).toBeGreaterThan(10);
  });

  it("includes auditTrail in data", async () => {
    const result = await pipelineAuditorStage(ctx({ documentId: 42 }));
    expect(result.data?.auditTrail).toHaveLength(1);
    const entry = (result.data?.auditTrail as Array<{ documentId: number }>)[0];
    expect(entry.documentId).toBe(42);
  });
});
