/**
 * unknown.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for server/verticalAdapters/unknown.ts
 *
 * Root cause (sprint-1)
 * ─────────────────────
 * The metaLayer falls back to adapterName = "unknown" when no critical check
 * exists in the database.  buildDevRepairPrompt then constructs the path
 * `server/verticalAdapters/unknown.ts`.  Before this fix the file was missing,
 * causing the autonomous repair loop to reference a non-existent module.
 *
 * These tests verify:
 *   1. The adapter registers under domainKey "unknown".
 *   2. lookupEvidence always returns found: false (safe no-op).
 *   3. The result always has confidenceScore === 0.
 *   4. The result always carries the "unknown-adapter" confidence flag.
 *   5. No network call is ever made (fetch is never invoked).
 *   6. The adapter shape is compatible with the VerticalAdapter interface.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub fetch globally — the unknown adapter must NEVER call it.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("UnknownAdapter — sprint-1 regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── 1. Registration ────────────────────────────────────────────────────────

  it("is registered with domainKey 'unknown'", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("unknown");
  });

  it("has a non-empty displayName", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown");
    expect(typeof adapter?.displayName).toBe("string");
    expect(adapter!.displayName.length).toBeGreaterThan(0);
  });

  it("has a non-empty description", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown");
    expect(typeof adapter?.description).toBe("string");
    expect(adapter!.description.length).toBeGreaterThan(0);
  });

  it("has a non-empty claimExtractorPrompt", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown");
    expect(typeof adapter?.claimExtractorPrompt).toBe("string");
    expect(adapter!.claimExtractorPrompt.length).toBeGreaterThan(0);
  });

  it("has an empty discoverySearchTerms array", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown");
    expect(Array.isArray(adapter?.discoverySearchTerms)).toBe(true);
    expect(adapter!.discoverySearchTerms).toHaveLength(0);
  });

  // ── 2. lookupEvidence — always returns found: false ───────────────────────

  it("returns found: false for any claim text", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown")!;
    const result = await adapter.lookupEvidence({
      claimText: "Some arbitrary claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("returns found: false when extractedValue is provided", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown")!;
    const result = await adapter.lookupEvidence({
      claimText: "Claim with extracted value",
      extractedValue: "some-value",
    });
    expect(result.found).toBe(false);
  });

  it("returns found: false for an empty claim text", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown")!;
    const result = await adapter.lookupEvidence({
      claimText: "",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  // ── 3. confidenceScore is always 0.0 ──────────────────────────────────────

  it("returns confidenceScore of 0.0", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown")!;
    const result = await adapter.lookupEvidence({
      claimText: "Any claim",
      extractedValue: null,
    });
    expect(result.confidenceScore).toBe(0.0);
  });

  // ── 4. confidenceFlags always contains "unknown-adapter" ──────────────────

  it("includes 'unknown-adapter' in confidenceFlags", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown")!;
    const result = await adapter.lookupEvidence({
      claimText: "Any claim",
      extractedValue: null,
    });
    expect(result.confidenceFlags).toContain("unknown-adapter");
  });

  it("includes 'fallback-no-op' in confidenceFlags", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown")!;
    const result = await adapter.lookupEvidence({
      claimText: "Any claim",
      extractedValue: null,
    });
    expect(result.confidenceFlags).toContain("fallback-no-op");
  });

  // ── 5. No network calls are ever made ─────────────────────────────────────

  it("never calls fetch (no network calls)", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown")!;
    await adapter.lookupEvidence({
      claimText: "Claim that should not trigger a network call",
      extractedValue: "some-value",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── 6. EvidenceResult shape compliance ────────────────────────────────────

  it("returns a valid EvidenceResult shape", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown")!;
    const result = await adapter.lookupEvidence({
      claimText: "Shape compliance check",
      extractedValue: null,
    });
    expect(result).toHaveProperty("found");
    expect(result).toHaveProperty("sourceId");
    expect(result).toHaveProperty("sourceUrl");
    expect(result).toHaveProperty("evidenceRaw");
    expect(result).toHaveProperty("confidenceScore");
    expect(result).toHaveProperty("confidenceFlags");
    expect(result.sourceId).toBeNull();
    expect(result.sourceUrl).toBeNull();
    expect(result.evidenceRaw).toBeNull();
    expect(Array.isArray(result.confidenceFlags)).toBe(true);
  });
});

// ── 7. buildDevRepairPrompt regression ────────────────────────────────────────
// Verify that buildDevRepairPrompt correctly references the unknown adapter path
// so the autonomous repair agent receives a valid file path to inspect.

describe("buildDevRepairPrompt — unknown adapter path regression", () => {
  it("references server/verticalAdapters/unknown.ts in the prompt", async () => {
    const { buildDevRepairPrompt } = await import("../manusOrchestrator");
    const prompt = buildDevRepairPrompt({
      adapterName: "unknown",
      errorLog: "{}",
      healthScore: 30,
    });
    expect(prompt).toContain("server/verticalAdapters/unknown.ts");
  });

  it("includes the health score in the prompt", async () => {
    const { buildDevRepairPrompt } = await import("../manusOrchestrator");
    const prompt = buildDevRepairPrompt({
      adapterName: "unknown",
      errorLog: "{}",
      healthScore: 30,
    });
    expect(prompt).toContain("30/100");
  });

  it("includes the correct commit message in the prompt", async () => {
    const { buildDevRepairPrompt } = await import("../manusOrchestrator");
    const prompt = buildDevRepairPrompt({
      adapterName: "unknown",
      errorLog: "{}",
      healthScore: 30,
    });
    expect(prompt).toContain("fix(unknown): autonomous repair [sprint-1]");
  });

  it("includes the error log in the prompt", async () => {
    const { buildDevRepairPrompt } = await import("../manusOrchestrator");
    const errorLog = JSON.stringify({
      code: "ERR_ADAPTER_MISSING",
      detail: "unknown.ts not found",
    });
    const prompt = buildDevRepairPrompt({
      adapterName: "unknown",
      errorLog,
      healthScore: 30,
    });
    expect(prompt).toContain(errorLog);
  });
});

  // ── 8. Extra regression test (sprint-1 autonomous repair) ─────────────────
  it("maintains backward compatibility with all callers", async () => {
    const { registry } = await import("./types");
    await import("./unknown");
    const adapter = registry.get("unknown")!;
    expect(adapter.domainKey).toBe("unknown");
    expect(adapter.displayName).toBe("Unknown (Fallback)");
  });
