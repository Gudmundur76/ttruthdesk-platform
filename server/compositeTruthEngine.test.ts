/**
 * compositeTruthEngine.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 123 — per-module coverage for the verification pipeline.
 *
 * compositeTruthEngine is a pure, deterministic, stateless function.
 * No mocks required. Tests cover all 8 composite truth labels, score
 * arithmetic, retraction penalty, provenance bonus/penalty, citation
 * authority adjustment, and rationale string generation.
 *
 * Architecture review requirement (2026-06-13): verification pipeline modules
 * must have explicit per-module coverage targets, not averaged into the global
 * floor. Target: ≥ 80% line coverage for this module.
 */
import { describe, it, expect } from "vitest";
import {
  computeCompositeTruth,
  COMPOSITE_LABEL_META,
  type CompositeTruthInput,
} from "./compositeTruthEngine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function base(overrides: Partial<CompositeTruthInput> = {}): CompositeTruthInput {
  return {
    upstreamVerdict: "Supported",
    provenanceScore: null,
    chainDistortionScore: null,
    chainHopCount: null,
    citationAuthorityScore: null,
    isRetracted: false,
    ...overrides,
  };
}

// ─── Label assignment ─────────────────────────────────────────────────────────

describe("computeCompositeTruth — label assignment", () => {
  it("returns verified_faithful for Supported + low chain distortion", () => {
    const result = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", chainDistortionScore: 0.1, chainHopCount: 3 })
    );
    expect(result.label).toBe("verified_faithful");
  });

  it("returns verified_distorted for Supported + high chain distortion (>= 0.25)", () => {
    const result = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", chainDistortionScore: 0.3, chainHopCount: 5 })
    );
    expect(result.label).toBe("verified_distorted");
  });

  it("returns verified_faithful for Supported with no chain data", () => {
    const result = computeCompositeTruth(base({ upstreamVerdict: "Supported" }));
    expect(result.label).toBe("verified_faithful");
  });

  it("returns contradicted for Contradicted + low chain distortion", () => {
    const result = computeCompositeTruth(
      base({ upstreamVerdict: "Contradicted", chainDistortionScore: 0.1, chainHopCount: 2 })
    );
    expect(result.label).toBe("contradicted");
  });

  it("returns contradicted_amplified for Contradicted + high chain distortion", () => {
    const result = computeCompositeTruth(
      base({ upstreamVerdict: "Contradicted", chainDistortionScore: 0.5, chainHopCount: 4 })
    );
    expect(result.label).toBe("contradicted_amplified");
  });

  it("returns partially_supported for Partially Supported", () => {
    const result = computeCompositeTruth(base({ upstreamVerdict: "Partially Supported" }));
    expect(result.label).toBe("partially_supported");
  });

  it("returns contested for Ambiguous", () => {
    const result = computeCompositeTruth(base({ upstreamVerdict: "Ambiguous" }));
    expect(result.label).toBe("contested");
  });

  it("returns insufficient_evidence for Insufficient Evidence", () => {
    const result = computeCompositeTruth(base({ upstreamVerdict: "Insufficient Evidence" }));
    expect(result.label).toBe("insufficient_evidence");
  });

  it("returns out_of_scope for Out of Scope", () => {
    const result = computeCompositeTruth(base({ upstreamVerdict: "Out of Scope" }));
    expect(result.label).toBe("out_of_scope");
  });

  it("returns out_of_scope for Needs Expert Review", () => {
    const result = computeCompositeTruth(base({ upstreamVerdict: "Needs Expert Review" }));
    expect(result.label).toBe("out_of_scope");
  });

  it("returns out_of_scope for null verdict", () => {
    const result = computeCompositeTruth(base({ upstreamVerdict: null }));
    expect(result.label).toBe("out_of_scope");
  });

  it("returns out_of_scope for undefined verdict", () => {
    const result = computeCompositeTruth(base({ upstreamVerdict: undefined }));
    expect(result.label).toBe("out_of_scope");
  });

  it("returns contested for unknown verdict string", () => {
     
    const result = computeCompositeTruth(base({ upstreamVerdict: "UNKNOWN_VERDICT" as any }));
    expect(result.label).toBe("contested");
  });
});

// ─── Score arithmetic ─────────────────────────────────────────────────────────

describe("computeCompositeTruth — score arithmetic", () => {
  it("score is clamped to [0, 1]", () => {
    const result = computeCompositeTruth(
      base({
        upstreamVerdict: "Contradicted",
        chainDistortionScore: 1.0,
        chainHopCount: 10,
        provenanceScore: 0.0,
        isRetracted: true,
        citationAuthorityScore: 0.1,
      })
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("Supported with high provenance and authority returns a high score", () => {
    const result = computeCompositeTruth(
      base({
        upstreamVerdict: "Supported",
        provenanceScore: 0.9,
        citationAuthorityScore: 0.9,
        isRetracted: false,
      })
    );
    expect(result.score).toBeGreaterThan(0.7);
  });

  it("retraction penalty reduces score", () => {
    const withoutRetraction = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", isRetracted: false })
    );
    const withRetraction = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", isRetracted: true })
    );
    expect(withRetraction.score).toBeLessThan(withoutRetraction.score);
  });

  it("high provenance score adds bonus", () => {
    const lowProv = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", provenanceScore: 0.5 })
    );
    const highProv = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", provenanceScore: 0.9 })
    );
    expect(highProv.score).toBeGreaterThan(lowProv.score);
  });

  it("low provenance score applies penalty", () => {
    const noProv = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", provenanceScore: null })
    );
    const lowProv = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", provenanceScore: 0.1 })
    );
    expect(lowProv.score).toBeLessThan(noProv.score);
  });

  it("high citation authority adds bonus", () => {
    const noAuth = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", citationAuthorityScore: null })
    );
    const highAuth = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", citationAuthorityScore: 0.9 })
    );
    expect(highAuth.score).toBeGreaterThan(noAuth.score);
  });

  it("low citation authority applies penalty", () => {
    const noAuth = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", citationAuthorityScore: null })
    );
    const lowAuth = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", citationAuthorityScore: 0.2 })
    );
    expect(lowAuth.score).toBeLessThan(noAuth.score);
  });

  it("chain distortion penalty is applied when chain data present", () => {
    const noChain = computeCompositeTruth(
      base({ upstreamVerdict: "Supported" })
    );
    const highChain = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", chainDistortionScore: 0.8, chainHopCount: 5 })
    );
    expect(highChain.score).toBeLessThan(noChain.score);
  });

  it("score is rounded to 4 decimal places", () => {
    const result = computeCompositeTruth(
      base({
        upstreamVerdict: "Supported",
        provenanceScore: 0.7,
        chainDistortionScore: 0.15,
        chainHopCount: 3,
      })
    );
    const decimals = result.score.toString().split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it("chain distortion not applied when chainHopCount is 0", () => {
    const zeroHops = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", chainDistortionScore: 0.9, chainHopCount: 0 })
    );
    const noChain = computeCompositeTruth(base({ upstreamVerdict: "Supported" }));
    // With 0 hops, hasChainData = false, so no penalty — scores should be equal
    expect(zeroHops.score).toBe(noChain.score);
  });

  it("chain distortion not applied when chainDistortionScore is null", () => {
    const nullScore = computeCompositeTruth(
      base({ upstreamVerdict: "Supported", chainDistortionScore: null, chainHopCount: 5 })
    );
    const noChain = computeCompositeTruth(base({ upstreamVerdict: "Supported" }));
    expect(nullScore.score).toBe(noChain.score);
  });
});

// ─── Rationale string ─────────────────────────────────────────────────────────

describe("computeCompositeTruth — rationale", () => {
  it("rationale is a non-empty string", () => {
    const result = computeCompositeTruth(base());
    expect(typeof result.rationale).toBe("string");
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("rationale mentions chain hop count when chain data present", () => {
    const result = computeCompositeTruth(
      base({ chainDistortionScore: 0.2, chainHopCount: 7 })
    );
    expect(result.rationale).toContain("7 citing paper");
  });

  it("rationale mentions no chain data when absent", () => {
    const result = computeCompositeTruth(base());
    expect(result.rationale).toContain("No citation chain data");
  });

  it("rationale mentions provenance score when present", () => {
    const result = computeCompositeTruth(base({ provenanceScore: 0.75 }));
    expect(result.rationale).toContain("Provenance score: 75%");
  });

  it("rationale mentions retraction warning when retracted", () => {
    const result = computeCompositeTruth(base({ isRetracted: true }));
    expect(result.rationale).toContain("retraction notice");
  });

  it("rationale mentions high citation authority boost", () => {
    const result = computeCompositeTruth(base({ citationAuthorityScore: 0.85 }));
    expect(result.rationale).toContain("high citation authority");
  });

  it("rationale mentions low citation authority penalty", () => {
    const result = computeCompositeTruth(base({ citationAuthorityScore: 0.2 }));
    expect(result.rationale).toContain("low citation authority");
  });

  it("rationale mentions neutral citation authority when mid-range", () => {
    const result = computeCompositeTruth(base({ citationAuthorityScore: 0.55 }));
    expect(result.rationale).toContain("no adjustment");
  });

  it("singular 'paper' when chainHopCount is 1", () => {
    const result = computeCompositeTruth(
      base({ chainDistortionScore: 0.1, chainHopCount: 1 })
    );
    expect(result.rationale).toContain("1 citing paper ");
    expect(result.rationale).not.toContain("1 citing papers");
  });
});

// ─── COMPOSITE_LABEL_META ─────────────────────────────────────────────────────

describe("COMPOSITE_LABEL_META", () => {
  it("contains entries for all 8 labels", () => {
    const labels = [
      "verified_faithful",
      "verified_distorted",
      "contradicted",
      "contradicted_amplified",
      "partially_supported",
      "contested",
      "insufficient_evidence",
      "out_of_scope",
    ];
    for (const label of labels) {
       
      expect(COMPOSITE_LABEL_META[label as import("./compositeTruthEngine").CompositeTruthLabel]).toBeDefined();
    }
  });

  it("each meta entry has label, displayName, colors.bg, and colors.text", () => {
    for (const meta of Object.values(COMPOSITE_LABEL_META)) {
      expect(meta).toHaveProperty("label");
      expect(meta).toHaveProperty("displayName");
      expect(meta).toHaveProperty("colors");
      expect(meta).toHaveProperty("colors.bg");
      expect(meta).toHaveProperty("colors.text");
    }
  });
});
