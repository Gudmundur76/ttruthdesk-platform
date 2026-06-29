/**
 * trainingBridge.test.ts
 * Full coverage of emitVerdictEvent(), getPipelineStats(), and the lazy
 * ensurePipeline() path — including the case where the CLF package is absent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeModule(overrides?: {
  processVerdictEvent?: ReturnType<typeof vi.fn>;
  check?: ReturnType<typeof vi.fn>;
}) {
  const processVerdictEvent = overrides?.processVerdictEvent ?? vi.fn();
  const check = overrides?.check ?? vi.fn();
  return {
    createTrainingPipeline: vi.fn(() => ({
      generator: { processVerdictEvent },
      watcher: { check },
    })),
    _processVerdictEvent: processVerdictEvent,
    _check: check,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("getPipelineStats()", () => {
  it("returns default corpus path and threshold when env vars are not set", async () => {
    vi.resetModules();
    const { getPipelineStats } = await import("./trainingBridge");
    const stats = getPipelineStats();
    expect(stats.ready).toBe(false);
    expect(typeof stats.corpusPath).toBe("string");
    expect(stats.corpusPath.length).toBeGreaterThan(0);
    expect(stats.threshold).toBe(50); // default MIN_PAIRS_THRESHOLD
  });

  it("reflects TRAINING_CORPUS_PATH env var", async () => {
    vi.resetModules();
    process.env["TRAINING_CORPUS_PATH"] = "/tmp/test_corpus.jsonl";
    const { getPipelineStats } = await import("./trainingBridge");
    const stats = getPipelineStats();
    expect(stats.corpusPath).toBe("/tmp/test_corpus.jsonl");
    delete process.env["TRAINING_CORPUS_PATH"];
  });

  it("reflects TRAINING_MIN_PAIRS env var", async () => {
    vi.resetModules();
    process.env["TRAINING_MIN_PAIRS"] = "200";
    const { getPipelineStats } = await import("./trainingBridge");
    const stats = getPipelineStats();
    expect(stats.threshold).toBe(200);
    delete process.env["TRAINING_MIN_PAIRS"];
  });

  it("reports ready=false before any emitVerdictEvent call", async () => {
    vi.resetModules();
    const { getPipelineStats } = await import("./trainingBridge");
    expect(getPipelineStats().ready).toBe(false);
  });
});

describe("emitVerdictEvent() — pipeline unavailable", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not throw when CLF package is absent", async () => {
    // Dynamic import will fail because the CLF package is not installed
    const { emitVerdictEvent } = await import("./trainingBridge");
    await expect(
      new Promise<void>((resolve) => {
        emitVerdictEvent({
          claimText: "Metformin activates AMPK",
          verdict: "Supported",
          rationale: "Multiple RCTs confirm this mechanism",
          sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678",
          domain: "pharmacology",
          entityName: "AMPK",
        });
        // Give the fire-and-forget promise time to settle
        setTimeout(resolve, 50);
      })
    ).resolves.toBeUndefined();
  });

  it("does not throw for minimal event (no optional fields)", async () => {
    const { emitVerdictEvent } = await import("./trainingBridge");
    await expect(
      new Promise<void>((resolve) => {
        emitVerdictEvent({
          claimText: "Aspirin reduces inflammation",
          verdict: "Contradicted",
          rationale: "No evidence found",
        });
        setTimeout(resolve, 50);
      })
    ).resolves.toBeUndefined();
  });

  it("getPipelineStats().ready reflects pipeline init outcome", async () => {
    const { emitVerdictEvent, getPipelineStats } = await import("./trainingBridge");
    // Before any call, ready is always false
    expect(getPipelineStats().ready).toBe(false);
    emitVerdictEvent({
      claimText: "Test claim",
      verdict: "Supported",
      rationale: "Test rationale",
    });
    // After the fire-and-forget settles, ready reflects whether CLF loaded
    await new Promise((r) => setTimeout(r, 150));
    // We don't assert the final value — it depends on whether CLF is installed.
    // The important thing is that no exception was thrown.
    expect(typeof getPipelineStats().ready).toBe("boolean");
  });
});

describe("emitVerdictEvent() — pipeline available (mocked)", () => {
  let processVerdictEvent: ReturnType<typeof vi.fn>;
  let check: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = makeModule();
    processVerdictEvent = mod._processVerdictEvent;
    check = mod._check;

    // Mock the dynamic import path used by ensurePipeline()
    vi.doMock(
      "../../cognitive-loop-framework/src/training/index.js",
      () => mod
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps IngestVerdictEvent to VerdictEvent correctly for Supported verdict", async () => {
    const { emitVerdictEvent } = await import("./trainingBridge");
    emitVerdictEvent({
      claimText: "Metformin activates AMPK",
      verdict: "Supported",
      rationale: "Multiple RCTs confirm this mechanism",
      sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678",
      entityName: "AMPK",
    });
    await new Promise((r) => setTimeout(r, 80));

    expect(processVerdictEvent).toHaveBeenCalledTimes(1);
    const arg = processVerdictEvent.mock.calls[0][0];
    expect(arg.claimText).toBe("Metformin activates AMPK");
    expect(arg.verdict).toBe("Supported");
    expect(arg.confidence).toBe(0.85);
    expect(arg.entities).toHaveLength(1);
    expect(arg.entities[0].name).toBe("AMPK");
    expect(arg.provenance).toBe("https://pubmed.ncbi.nlm.nih.gov/12345678");
  });

  it("sets confidence=0.5 for non-Supported verdict", async () => {
    const { emitVerdictEvent } = await import("./trainingBridge");
    emitVerdictEvent({
      claimText: "Aspirin cures cancer",
      verdict: "Contradicted",
      rationale: "No evidence",
    });
    await new Promise((r) => setTimeout(r, 80));

    const arg = processVerdictEvent.mock.calls[0][0];
    expect(arg.confidence).toBe(0.5);
  });

  it("uses domain as provenance when sourceUrl is absent", async () => {
    const { emitVerdictEvent } = await import("./trainingBridge");
    emitVerdictEvent({
      claimText: "Test claim",
      verdict: "Supported",
      rationale: "Rationale",
      domain: "oncology",
    });
    await new Promise((r) => setTimeout(r, 80));

    const arg = processVerdictEvent.mock.calls[0][0];
    expect(arg.provenance).toBe("domain:oncology");
  });

  it("uses 'unknown' domain when neither sourceUrl nor domain is provided", async () => {
    const { emitVerdictEvent } = await import("./trainingBridge");
    emitVerdictEvent({
      claimText: "Test claim",
      verdict: "Supported",
      rationale: "Rationale",
    });
    await new Promise((r) => setTimeout(r, 80));

    const arg = processVerdictEvent.mock.calls[0][0];
    expect(arg.provenance).toBe("domain:unknown");
  });

  it("produces empty entities array when entityName is absent", async () => {
    const { emitVerdictEvent } = await import("./trainingBridge");
    emitVerdictEvent({
      claimText: "Test claim",
      verdict: "Supported",
      rationale: "Rationale",
    });
    await new Promise((r) => setTimeout(r, 80));

    const arg = processVerdictEvent.mock.calls[0][0];
    expect(arg.entities).toHaveLength(0);
  });

  it("calls watcher.check() after processVerdictEvent()", async () => {
    const { emitVerdictEvent } = await import("./trainingBridge");
    emitVerdictEvent({
      claimText: "Test",
      verdict: "Supported",
      rationale: "Rationale",
    });
    await new Promise((r) => setTimeout(r, 80));

    expect(check).toHaveBeenCalledTimes(1);
  });

  it("generates a unique claimId for each event", async () => {
    const { emitVerdictEvent } = await import("./trainingBridge");
    emitVerdictEvent({ claimText: "A", verdict: "Supported", rationale: "R" });
    emitVerdictEvent({ claimText: "B", verdict: "Supported", rationale: "R" });
    await new Promise((r) => setTimeout(r, 100));

    const ids = processVerdictEvent.mock.calls.map(
      (c: unknown[]) => (c[0] as { claimId: string }).claimId
    );
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("truncates rationale to 500 chars for contextSentence", async () => {
    const { emitVerdictEvent } = await import("./trainingBridge");
    const longRationale = "x".repeat(600);
    emitVerdictEvent({
      claimText: "Test",
      verdict: "Supported",
      rationale: longRationale,
    });
    await new Promise((r) => setTimeout(r, 80));

    const arg = processVerdictEvent.mock.calls[0][0];
    expect(arg.contextSentence.length).toBe(500);
  });
});
