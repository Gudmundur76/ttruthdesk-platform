/**
 * codeGuardian.test.ts — Phase 122
 *
 * Tests for runCodeGuardian(): the meta-agent orchestrator that runs all
 * four layers (drift, stubs, pipeline, routing) and returns a CodeGuardianReport.
 *
 * All sub-modules are mocked so tests are deterministic and DB-free.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("./codeDriftService", () => ({
  detectCodeDrift: vi.fn(),
}));

vi.mock("./stubLedger", () => ({
  buildStubLedger: vi.fn(),
  getOverdueEscalations: vi.fn(),
}));

vi.mock("./pipelineGuardian", () => ({
  runPipelineGuardian: vi.fn(),
}));

vi.mock("./alertRouter", () => ({
  routeFindings: vi.fn(),
  driftFindingToMetaFinding: vi.fn(df => ({
    checkType: df.checkType,
    severity: df.severity,
    confidence: df.confidence,
    summary: df.summary,
    details: df.details,
  })),
  invariantResultToMetaFinding: vi.fn(ir => ({
    checkType: `invariant.${ir.name}`,
    severity:
      ir.status === "fail"
        ? "critical"
        : ir.status === "warn"
          ? "warning"
          : "info",
    confidence: 1,
    summary: `Invariant ${ir.name}: ${ir.status}`,
    details: { actual: ir.actual, threshold: ir.threshold },
  })),
}));

vi.mock("../logger", () => ({
  logger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

import type { CodeDriftReport, DriftFinding } from "./codeDriftService";
import type { StubLedgerReport, StubEscalation } from "./stubLedger";
import type { PipelineGuardianReport } from "./pipelineGuardian";

function makeDriftFinding(
  severity: DriftFinding["severity"] = "info"
): DriftFinding {
  return {
    checkType: "test.drift",
    severity,
    confidence: 0.9,
    summary: "test drift finding",
    details: {},
  };
}

function makeCodeDriftReport(
  overrides: Partial<Record<keyof CodeDriftReport, DriftFinding>> = {}
): CodeDriftReport {
  const clean = makeDriftFinding("info");
  const fields = {
    schemaDrift: overrides.schemaDrift ?? clean,
    apiDrift: overrides.apiDrift ?? clean,
    testDrift: overrides.testDrift ?? clean,
    dependencyDrift: overrides.dependencyDrift ?? clean,
    configDrift: overrides.configDrift ?? clean,
    disciplineDrift: overrides.disciplineDrift ?? clean,
  };
  const severities = Object.values(fields).map(f => f.severity);
  const overallSeverity: CodeDriftReport["overallSeverity"] =
    severities.includes("critical")
      ? "critical"
      : severities.includes("warning")
        ? "warning"
        : "info";
  return { ...fields, overallSeverity, checkedAt: new Date().toISOString() };
}

function makeStubLedger(
  stubs: StubLedgerReport["stubs"] = []
): StubLedgerReport {
  return {
    total: stubs.length,
    open: stubs.filter(s => s.status === "open").length,
    overdue: stubs.filter(s => s.status === "overdue").length,
    byPriority: { P0: 0, P1: 0, P2: 0 },
    stubs,
    checkedAt: new Date().toISOString(),
  };
}

function makePipelineReport(
  invariants: PipelineGuardianReport["invariants"] = []
): PipelineGuardianReport {
  return {
    invariants,
    overallStatus: invariants.some(i => i.status === "fail")
      ? "fail"
      : invariants.some(i => i.status === "warn")
        ? "warn"
        : "pass",
    failCount: invariants.filter(i => i.status === "fail").length,
    warnCount: invariants.filter(i => i.status === "warn").length,
    checkedAt: new Date().toISOString(),
    durationMs: 0,
  };
}

function makeInvariant(
  name: string,
  status: "pass" | "warn" | "fail" = "pass"
): PipelineGuardianReport["invariants"][0] {
  return {
    name,
    status,
    threshold: "0",
    actual: status === "fail" ? "1" : "0",
    details: {},
    severity:
      status === "fail" ? "critical" : status === "warn" ? "warning" : "info",
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runCodeGuardian", () => {
  let detectCodeDrift: ReturnType<typeof vi.fn>;
  let buildStubLedger: ReturnType<typeof vi.fn>;
  let getOverdueEscalations: ReturnType<typeof vi.fn>;
  let runPipelineGuardian: ReturnType<typeof vi.fn>;
  let routeFindings: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    const drift = await import("./codeDriftService");
    const stubs = await import("./stubLedger");
    const pipeline = await import("./pipelineGuardian");
    const router = await import("./alertRouter");

    detectCodeDrift = drift.detectCodeDrift as ReturnType<typeof vi.fn>;
    buildStubLedger = stubs.buildStubLedger as ReturnType<typeof vi.fn>;
    getOverdueEscalations = stubs.getOverdueEscalations as ReturnType<
      typeof vi.fn
    >;
    runPipelineGuardian = pipeline.runPipelineGuardian as ReturnType<
      typeof vi.fn
    >;
    routeFindings = router.routeFindings as ReturnType<typeof vi.fn>;

    // Restore the converter implementations after resetAllMocks clears them
    const driftFindingToMetaFinding =
      router.driftFindingToMetaFinding as ReturnType<typeof vi.fn>;
    const invariantResultToMetaFinding =
      router.invariantResultToMetaFinding as ReturnType<typeof vi.fn>;
    driftFindingToMetaFinding.mockImplementation((df: DriftFinding) => ({
      checkType: df.checkType,
      severity: df.severity,
      confidence: df.confidence,
      summary: df.summary,
      details: df.details,
    }));
    invariantResultToMetaFinding.mockImplementation(
      (ir: {
        name: string;
        status: string;
        threshold: string;
        actual: string;
      }) => ({
        checkType: `invariant.${ir.name}`,
        severity:
          ir.status === "fail"
            ? "critical"
            : ir.status === "warn"
              ? "warning"
              : "info",
        confidence: 1,
        summary: `Invariant ${ir.name}: ${ir.status}`,
        details: { actual: ir.actual, threshold: ir.threshold },
      })
    );
  });

  it("returns a CodeGuardianReport with agentName = codeGuardianAgent", async () => {
    detectCodeDrift.mockResolvedValue(makeCodeDriftReport());
    buildStubLedger.mockReturnValue(makeStubLedger());
    getOverdueEscalations.mockReturnValue([]);
    runPipelineGuardian.mockResolvedValue(makePipelineReport());
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    const report = await runCodeGuardian();

    expect(report.agentName).toBe("codeGuardianAgent");
  });

  it("returns healthScore 100 when all checks are clean", async () => {
    detectCodeDrift.mockResolvedValue(makeCodeDriftReport());
    buildStubLedger.mockReturnValue(makeStubLedger());
    getOverdueEscalations.mockReturnValue([]);
    runPipelineGuardian.mockResolvedValue(makePipelineReport());
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    const report = await runCodeGuardian();

    expect(report.healthScore).toBe(100);
    expect(report.healthGrade).toBe("A");
  });

  it("deducts 10 points per critical drift finding", async () => {
    detectCodeDrift.mockResolvedValue(
      makeCodeDriftReport({ schemaDrift: makeDriftFinding("critical") })
    );
    buildStubLedger.mockReturnValue(makeStubLedger());
    getOverdueEscalations.mockReturnValue([]);
    runPipelineGuardian.mockResolvedValue(makePipelineReport());
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    const report = await runCodeGuardian();

    expect(report.healthScore).toBe(90);
  });

  it("deducts 5 points per warning drift finding", async () => {
    detectCodeDrift.mockResolvedValue(
      makeCodeDriftReport({ apiDrift: makeDriftFinding("warning") })
    );
    buildStubLedger.mockReturnValue(makeStubLedger());
    getOverdueEscalations.mockReturnValue([]);
    runPipelineGuardian.mockResolvedValue(makePipelineReport());
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    const report = await runCodeGuardian();

    expect(report.healthScore).toBe(95);
  });

  it("deducts 3 points per failed pipeline invariant", async () => {
    detectCodeDrift.mockResolvedValue(makeCodeDriftReport());
    buildStubLedger.mockReturnValue(makeStubLedger());
    getOverdueEscalations.mockReturnValue([]);
    runPipelineGuardian.mockResolvedValue(
      makePipelineReport([makeInvariant("stuckDocuments", "fail")])
    );
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    const report = await runCodeGuardian();

    expect(report.healthScore).toBe(97);
  });

  it("assigns grade F when healthScore < 40", async () => {
    // 6 critical drift findings = -60 points → score 40 → grade D
    // 6 critical + 1 more critical = impossible (only 6 drift checks), use pipeline fails
    const criticalDrift = makeDriftFinding("critical");
    detectCodeDrift.mockResolvedValue({
      schemaDrift: criticalDrift,
      apiDrift: criticalDrift,
      testDrift: criticalDrift,
      dependencyDrift: criticalDrift,
      configDrift: criticalDrift,
      disciplineDrift: criticalDrift,
    });
    // Add pipeline fails to push below 40
    const failInvariants = Array.from({ length: 8 }, (_, i) =>
      makeInvariant(`inv${i}`, "fail")
    );
    buildStubLedger.mockReturnValue(makeStubLedger());
    getOverdueEscalations.mockReturnValue([]);
    runPipelineGuardian.mockResolvedValue(makePipelineReport(failInvariants));
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    const report = await runCodeGuardian();

    // 6 critical drift = -60, 8 fail invariants = -24 → 100-60-24 = 16 → grade F
    expect(report.healthScore).toBeLessThan(40);
    expect(report.healthGrade).toBe("F");
  });

  it("counts criticalCount and warningCount correctly", async () => {
    detectCodeDrift.mockResolvedValue(
      makeCodeDriftReport({
        schemaDrift: makeDriftFinding("critical"),
        apiDrift: makeDriftFinding("warning"),
      })
    );
    buildStubLedger.mockReturnValue(makeStubLedger());
    getOverdueEscalations.mockReturnValue([]);
    runPipelineGuardian.mockResolvedValue(makePipelineReport());
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    const report = await runCodeGuardian();

    expect(report.criticalCount).toBe(1);
    expect(report.warningCount).toBe(1);
  });

  it("includes overdueEscalations in the report", async () => {
    const escalation: StubEscalation = {
      stub: {
        id: "test:stub",
        file: "server/test.ts",
        line: 10,
        priority: "P0",
        description: "test stub",
        estimatedLines: 20,
        createdAt: new Date(),
        deadlineAt: new Date(),
        status: "overdue",
        blockingPhases: [],
        daysOverdue: 5,
      },
      escalationReason: "P0 stub is 5 days overdue",
      suggestedAction: "Implement it",
    };

    detectCodeDrift.mockResolvedValue(makeCodeDriftReport());
    buildStubLedger.mockReturnValue(makeStubLedger([escalation.stub]));
    getOverdueEscalations.mockReturnValue([escalation]);
    runPipelineGuardian.mockResolvedValue(makePipelineReport());
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    const report = await runCodeGuardian();

    expect(report.overdueEscalations).toHaveLength(1);
    expect(report.overdueEscalations[0].escalationReason).toContain(
      "5 days overdue"
    );
  });

  it("calls routeFindings with all assembled findings", async () => {
    detectCodeDrift.mockResolvedValue(makeCodeDriftReport());
    buildStubLedger.mockReturnValue(makeStubLedger());
    getOverdueEscalations.mockReturnValue([]);
    runPipelineGuardian.mockResolvedValue(
      makePipelineReport([makeInvariant("claimOrphans", "pass")])
    );
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    await runCodeGuardian();

    expect(routeFindings).toHaveBeenCalledOnce();
    // 6 drift findings + 1 invariant = 7 total
    const calledWith = routeFindings.mock.calls[0][0] as unknown[];
    expect(calledWith).toHaveLength(7);
  });

  it("includes startedAt, completedAt, and durationMs in the report", async () => {
    detectCodeDrift.mockResolvedValue(makeCodeDriftReport());
    buildStubLedger.mockReturnValue(makeStubLedger());
    getOverdueEscalations.mockReturnValue([]);
    runPipelineGuardian.mockResolvedValue(makePipelineReport());
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    const report = await runCodeGuardian();

    expect(report.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("healthScore is clamped at minimum when penalties are extreme", async () => {
    const criticalDrift = makeDriftFinding("critical");
    detectCodeDrift.mockResolvedValue({
      schemaDrift: criticalDrift,
      apiDrift: criticalDrift,
      testDrift: criticalDrift,
      dependencyDrift: criticalDrift,
      configDrift: criticalDrift,
      disciplineDrift: criticalDrift,
    });
    // 20 failing invariants: pipeline penalty capped at 30
    // Total: 100 - (6 * 10) - min(20*3, 30) = 100 - 60 - 30 = 10
    const failInvariants = Array.from({ length: 20 }, (_, i) =>
      makeInvariant(`inv${i}`, "fail")
    );
    buildStubLedger.mockReturnValue(makeStubLedger());
    getOverdueEscalations.mockReturnValue([]);
    runPipelineGuardian.mockResolvedValue(makePipelineReport(failInvariants));
    routeFindings.mockResolvedValue(undefined);

    const { runCodeGuardian } = await import("./codeGuardian");
    const report = await runCodeGuardian();

    // Score = 100 - 60 (6 critical drift) - 30 (20 fails capped) = 10
    expect(report.healthScore).toBe(10);
    expect(report.healthGrade).toBe("F");
  });
});
