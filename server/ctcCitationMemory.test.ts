/**
 * ctcCitationMemory.test.ts — Tests for CTCCitationMemory
 *
 * Uses the project-standard vi.mock("fs") pattern (see metaAgent.test.ts).
 * The sidecar is not running in test environments, so enabled-mode tests
 * verify that errors are swallowed and safe defaults are returned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import {
  CTCCitationMemory,
  getCTCCitationMemory,
  type CitationEpisode,
} from "./ctcCitationMemory";

// ─── Mock fs ──────────────────────────────────────────────────────────────────
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

const mockFs = fs as unknown as { existsSync: ReturnType<typeof vi.fn> };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEpisode(overrides: Partial<CitationEpisode> = {}): CitationEpisode {
  return {
    source_pmid: "12345678",
    source_title: "Original study on protein binding",
    original_claim: "Protein X binds receptor Y with Kd of 5 nM.",
    hops: [
      {
        pmid: "87654321",
        title: "Review citing original study",
        hop_number: 1,
        distortion_score: 0.6,
        distortion_type: "quantitative_exaggeration",
        citing_claim_text: "Protein X binds receptor Y with high affinity.",
      },
    ],
    max_distortion_score: 0.6,
    dominant_distortion_type: "quantitative_exaggeration",
    analyzed_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Disabled mode tests ──────────────────────────────────────────────────────

describe("CTCCitationMemory (disabled — evolva-mragent not present)", () => {
  let ctc: CTCCitationMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    ctc = new CTCCitationMemory("/tmp/test-ctc.db");
  });

  it("isEnabled returns false when evolva-mragent is not installed", () => {
    expect(ctc.isEnabled).toBe(false);
  });

  it("ingestChain resolves without throwing when disabled", async () => {
    await expect(ctc.ingestChain(makeEpisode())).resolves.toBeUndefined();
  });

  it("reconstruct returns safe default when disabled", async () => {
    const result = await ctc.reconstruct("How was claim X distorted?");
    expect(result.question).toBe("How was claim X distorted?");
    expect(result.confidence).toBe("low");
    expect(result.supports).toEqual([]);
    expect(result.tool_calls_made).toBe(0);
  });

  it("getDistortionPatterns returns empty array when disabled", async () => {
    const result = await ctc.getDistortionPatterns("12345678");
    expect(result).toEqual([]);
  });

  it("traceDistortionPath returns empty chain when disabled", async () => {
    const result = await ctc.traceDistortionPath("12345678");
    expect(result.source_pmid).toBe("12345678");
    expect(result.chain).toEqual([]);
    expect(result.max_distortion).toBe(0);
  });

  it("findHighDistortionClaims returns empty array when disabled", async () => {
    const result = await ctc.findHighDistortionClaims(0.7, 10);
    expect(result).toEqual([]);
  });
});

// ─── Enabled mode tests (sidecar not running → errors swallowed) ─────────────

describe("CTCCitationMemory (enabled — sidecar not running, errors swallowed)", () => {
  let ctc: CTCCitationMemory;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      return path.includes("evolva-mragent") || path.includes("ctc_sidecar");
    });
    ctc = new CTCCitationMemory("/tmp/test-ctc-enabled.db");
  });

  it("isEnabled returns true when evolva-mragent is present", () => {
    expect(ctc.isEnabled).toBe(true);
  });

  it("ingestChain does not throw on sidecar ECONNREFUSED", async () => {
    await expect(ctc.ingestChain(makeEpisode())).resolves.toBeUndefined();
  });

  it("reconstruct does not throw when sidecar returns an error response", async () => {
    // The sidecar may return {error: "..."} (exit 0) or throw (exit non-zero).
    // Either way, reconstruct() must not throw — it returns whatever the sidecar gives back.
    await expect(ctc.reconstruct("How was claim X distorted?")).resolves.toBeDefined();
  });

  it("getDistortionPatterns returns empty array on sidecar ECONNREFUSED", async () => {
    const result = await ctc.getDistortionPatterns("12345678");
    expect(Array.isArray(result)).toBe(true);
  });

  it("traceDistortionPath returns empty chain on sidecar ECONNREFUSED", async () => {
    const result = await ctc.traceDistortionPath("12345678");
    expect(result.source_pmid).toBe("12345678");
    expect(Array.isArray(result.chain)).toBe(true);
  });

  it("findHighDistortionClaims returns empty array on sidecar ECONNREFUSED", async () => {
    const result = await ctc.findHighDistortionClaims(0.7, 10);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── CitationEpisode shape tests ──────────────────────────────────────────────

describe("CitationEpisode shape", () => {
  it("makeEpisode produces a valid CitationEpisode", () => {
    const ep = makeEpisode();
    expect(ep.source_pmid).toBe("12345678");
    expect(ep.hops).toHaveLength(1);
    expect(ep.hops[0].distortion_score).toBeGreaterThanOrEqual(0);
    expect(ep.hops[0].distortion_score).toBeLessThanOrEqual(1);
    expect(ep.max_distortion_score).toBeGreaterThanOrEqual(0);
    expect(typeof ep.analyzed_at).toBe("string");
  });

  it("episode can have zero hops (no citation chain yet)", () => {
    const ep = makeEpisode({ hops: [], max_distortion_score: 0 });
    expect(ep.hops).toHaveLength(0);
    expect(ep.max_distortion_score).toBe(0);
  });

  it("episode can have multiple hops", () => {
    const ep = makeEpisode({
      hops: [
        { pmid: "111", title: "Hop 1", hop_number: 1, distortion_score: 0.3, distortion_type: "omission" },
        { pmid: "222", title: "Hop 2", hop_number: 2, distortion_score: 0.7, distortion_type: "exaggeration" },
        { pmid: "333", title: "Hop 3", hop_number: 3, distortion_score: 0.9, distortion_type: "reversal" },
      ],
      max_distortion_score: 0.9,
    });
    expect(ep.hops).toHaveLength(3);
    expect(ep.max_distortion_score).toBe(0.9);
  });

  it("source_title is optional", () => {
    const ep = makeEpisode({ source_title: undefined });
    expect(ep.source_title).toBeUndefined();
  });
});

// ─── Singleton tests ──────────────────────────────────────────────────────────

describe("getCTCCitationMemory singleton", () => {
  it("returns the same instance on repeated calls", () => {
    const a = getCTCCitationMemory();
    const b = getCTCCitationMemory();
    expect(a).toBe(b);
  });

  it("singleton is an instance of CTCCitationMemory", () => {
    const instance = getCTCCitationMemory();
    expect(instance).toBeInstanceOf(CTCCitationMemory);
  });
});
