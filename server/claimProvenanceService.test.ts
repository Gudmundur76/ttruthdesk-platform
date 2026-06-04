/**
 * claimProvenanceService.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the claim provenance chain service.
 *
 * Covers:
 *   - summarize() with empty chain
 *   - summarize() with full pipeline chain
 *   - summarize() with failed steps
 *   - summarize() with manual verdict override
 *   - summarize() with agent ingestion step
 *   - summarize() with similarity check step
 *   - summarize() narrative construction
 *   - summarize() stepsMissing / stepsCompleted logic
 *   - summarize() actors deduplication
 *   - recordStep() mock (DB insert path)
 *   - getChain() ordering (ascending by createdAt)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { summarize } from "./claimProvenanceService";
import type { ProvenanceChainEntry } from "./claimProvenanceService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
  overrides: Partial<ProvenanceChainEntry> & { step: ProvenanceChainEntry["step"] }
): ProvenanceChainEntry {
  return {
    id: overrides.id ?? 1,
    claimId: overrides.claimId ?? 42,
    documentId: overrides.documentId ?? 7,
    step: overrides.step,
    actor: overrides.actor ?? "pipeline",
    inputSnapshot: overrides.inputSnapshot ?? null,
    outputSnapshot: overrides.outputSnapshot ?? null,
    durationMs: overrides.durationMs ?? 120,
    success: overrides.success ?? true,
    errorMsg: overrides.errorMsg ?? null,
    createdAt: overrides.createdAt ?? new Date("2024-01-15T10:00:00Z"),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("summarize()", () => {
  it("returns a zero-step summary for an empty chain", () => {
    const result = summarize([]);
    expect(result.claimId).toBe(0);
    expect(result.totalSteps).toBe(0);
    expect(result.successfulSteps).toBe(0);
    expect(result.failedSteps).toBe(0);
    expect(result.firstSeenAt).toBeNull();
    expect(result.lastModifiedAt).toBeNull();
    expect(result.stepsCompleted).toHaveLength(0);
    expect(result.stepsMissing).toHaveLength(4); // all 4 canonical steps missing
    expect(result.actors).toHaveLength(0);
    expect(result.narrative).toBe("No provenance data recorded for this claim.");
  });

  it("correctly counts successful and failed steps", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({ id: 1, step: "extraction", success: true }),
      makeEvent({ id: 2, step: "evidence_lookup", success: false, errorMsg: "timeout" }),
      makeEvent({ id: 3, step: "quality_scoring", success: true }),
    ];
    const result = summarize(chain);
    expect(result.totalSteps).toBe(3);
    expect(result.successfulSteps).toBe(2);
    expect(result.failedSteps).toBe(1);
  });

  it("identifies stepsCompleted and stepsMissing correctly", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({ step: "extraction", success: true }),
      makeEvent({ step: "evidence_lookup", success: true }),
    ];
    const result = summarize(chain);
    expect(result.stepsCompleted).toContain("extraction");
    expect(result.stepsCompleted).toContain("evidence_lookup");
    expect(result.stepsMissing).toContain("quality_scoring");
    expect(result.stepsMissing).toContain("verdict_override");
    expect(result.stepsMissing).not.toContain("extraction");
  });

  it("does NOT include failed steps in stepsCompleted", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({ step: "extraction", success: false, errorMsg: "parse error" }),
    ];
    const result = summarize(chain);
    expect(result.stepsCompleted).not.toContain("extraction");
    expect(result.stepsMissing).toContain("extraction");
  });

  it("deduplicates actors correctly", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({ step: "extraction", actor: "pipeline" }),
      makeEvent({ step: "evidence_lookup", actor: "pipeline" }),
      makeEvent({ step: "quality_scoring", actor: "scorer-v2" }),
    ];
    const result = summarize(chain);
    expect(result.actors).toHaveLength(2);
    expect(result.actors).toContain("pipeline");
    expect(result.actors).toContain("scorer-v2");
  });

  it("sets firstSeenAt to the first event's createdAt", () => {
    const t1 = new Date("2024-01-01T08:00:00Z");
    const t2 = new Date("2024-01-01T09:00:00Z");
    const chain: ProvenanceChainEntry[] = [
      makeEvent({ step: "extraction", createdAt: t1 }),
      makeEvent({ step: "evidence_lookup", createdAt: t2 }),
    ];
    const result = summarize(chain);
    expect(result.firstSeenAt).toEqual(t1);
    expect(result.lastModifiedAt).toEqual(t2);
  });

  it("builds narrative mentioning extraction claimType", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({
        step: "extraction",
        outputSnapshot: { claimType: "causal", entityCount: 3 },
      }),
    ];
    const result = summarize(chain);
    expect(result.narrative).toContain("causal");
    expect(result.narrative).toContain("pipeline");
  });

  it("builds narrative mentioning evidence verdict and source", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({
        step: "evidence_lookup",
        outputSnapshot: { verdict: "Supported", evidenceSource: "PDB" },
      }),
    ];
    const result = summarize(chain);
    expect(result.narrative).toContain("Supported");
    expect(result.narrative).toContain("PDB");
  });

  it("builds narrative mentioning quality scoring confidence", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({
        step: "quality_scoring",
        outputSnapshot: { confidenceScore: 0.87 },
      }),
    ];
    const result = summarize(chain);
    expect(result.narrative).toContain("87%");
  });

  it("builds narrative mentioning verdict override actor and new verdict", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({
        step: "verdict_override",
        actor: "Dr. Smith",
        outputSnapshot: { overriddenVerdict: "Contradicted" },
      }),
    ];
    const result = summarize(chain);
    expect(result.narrative).toContain("Contradicted");
    expect(result.narrative).toContain("Dr. Smith");
  });

  it("builds narrative mentioning agent ingestion actor", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({ step: "agent_ingestion", actor: "creatine-agent-v1" }),
    ];
    const result = summarize(chain);
    expect(result.narrative).toContain("creatine-agent-v1");
  });

  it("builds narrative mentioning similarity duplicates when > 0", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({
        step: "similarity_check",
        outputSnapshot: { duplicatesFound: 3 },
      }),
    ];
    const result = summarize(chain);
    expect(result.narrative).toContain("3");
  });

  it("does NOT mention similarity duplicates when count is 0", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({
        step: "similarity_check",
        outputSnapshot: { duplicatesFound: 0 },
      }),
    ];
    const result = summarize(chain);
    // When no duplicates, similarity step is silent in narrative
    expect(result.narrative).not.toContain("near-duplicate");
  });

  it("mentions failed steps count in narrative", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({ step: "extraction", success: false, errorMsg: "parse error" }),
      makeEvent({ step: "evidence_lookup", success: false, errorMsg: "timeout" }),
    ];
    const result = summarize(chain);
    expect(result.narrative).toContain("2 step(s) failed");
  });

  it("handles a full pipeline chain correctly", () => {
    const chain: ProvenanceChainEntry[] = [
      makeEvent({
        id: 1,
        step: "extraction",
        actor: "pipeline",
        outputSnapshot: { claimType: "mechanistic" },
        createdAt: new Date("2024-01-15T10:00:00Z"),
      }),
      makeEvent({
        id: 2,
        step: "evidence_lookup",
        actor: "pipeline",
        outputSnapshot: { verdict: "Partially Supported", evidenceSource: "PubMed" },
        createdAt: new Date("2024-01-15T10:01:00Z"),
      }),
      makeEvent({
        id: 3,
        step: "quality_scoring",
        actor: "scorer-v2",
        outputSnapshot: { confidenceScore: 0.72 },
        createdAt: new Date("2024-01-15T10:02:00Z"),
      }),
    ];
    const result = summarize(chain);
    expect(result.claimId).toBe(42);
    expect(result.totalSteps).toBe(3);
    expect(result.successfulSteps).toBe(3);
    expect(result.failedSteps).toBe(0);
    expect(result.stepsCompleted).toHaveLength(3);
    expect(result.stepsMissing).toContain("verdict_override");
    expect(result.actors).toHaveLength(2);
    expect(result.narrative).toContain("mechanistic");
    expect(result.narrative).toContain("Partially Supported");
    expect(result.narrative).toContain("72%");
  });

  it("returns fallback narrative when no recognisable steps are present", () => {
    // Only an unknown step type (won't match any narrative builder)
    const chain: ProvenanceChainEntry[] = [
      makeEvent({ step: "similarity_check", outputSnapshot: { duplicatesFound: 0 } }),
    ];
    const result = summarize(chain);
    // similarity_check with 0 duplicates adds nothing to parts
    expect(result.narrative).toBe("Claim was processed through the standard pipeline.");
  });
});

// ─── recordStep() mock test ───────────────────────────────────────────────────

describe("recordStep() (mocked DB)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls getDb and inserts a row, returning the inserted id", async () => {
    // Mock the DB module — Drizzle insert returns [result, fields]
    // where result has insertId
    vi.doMock("./db", () => ({
      getDb: vi.fn().mockResolvedValue({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([{ insertId: 99 }, []]),
        }),
      }),
    }));

    // Re-import after mocking
    const { recordStep } = await import("./claimProvenanceService");

    const id = await recordStep({
      claimId: 1,
      documentId: 2,
      step: "extraction",
      actor: "test-actor",
      success: true,
    });

    // Should return the insertId from the mock
    expect(id).toBe(99);
  });
});

// ─── getChain() ordering test ─────────────────────────────────────────────────

describe("getChain() (mocked DB)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns events ordered ascending by createdAt", async () => {
    // The mock returns rows already in ascending order (as the DB would after ORDER BY)
    const mockRows = [
      {
        id: 1, claimId: 5, documentId: 1, step: "extraction",
        actor: "pipeline", inputSnapshot: null, outputSnapshot: null,
        durationMs: 100, success: 1, errorMsg: null,
        createdAt: new Date("2024-01-15T10:00:00Z"),
      },
      {
        id: 2, claimId: 5, documentId: 1, step: "evidence_lookup",
        actor: "pipeline", inputSnapshot: null, outputSnapshot: null,
        durationMs: 200, success: 1, errorMsg: null,
        createdAt: new Date("2024-01-15T10:01:00Z"),
      },
      {
        id: 3, claimId: 5, documentId: 1, step: "quality_scoring",
        actor: "scorer", inputSnapshot: null, outputSnapshot: null,
        durationMs: 50, success: 1, errorMsg: null,
        createdAt: new Date("2024-01-15T10:02:00Z"),
      },
    ];

    vi.doMock("./db", () => ({
      getDb: vi.fn().mockResolvedValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(mockRows),
            }),
          }),
        }),
      }),
    }));

    const { getChain } = await import("./claimProvenanceService");
    const chain = await getChain(5);

    // DB returns rows in ascending order; service should preserve that order
    expect(chain).toHaveLength(3);
    expect(chain[0].step).toBe("extraction");
    expect(chain[1].step).toBe("evidence_lookup");
    expect(chain[2].step).toBe("quality_scoring");
  });

  it("returns empty array when no events exist for a claim", async () => {
    vi.doMock("./db", () => ({
      getDb: vi.fn().mockResolvedValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    }));

    const { getChain } = await import("./claimProvenanceService");
    const chain = await getChain(999);
    expect(chain).toHaveLength(0);
  });

  it("returns empty array when DB is unavailable (null connection)", async () => {
    vi.doMock("./db", () => ({
      getDb: vi.fn().mockResolvedValue(null),
    }));

    const { getChain } = await import("./claimProvenanceService");
    const chain = await getChain(1);
    expect(chain).toHaveLength(0);
  });
});
