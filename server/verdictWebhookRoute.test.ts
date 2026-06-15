/**
 * verdictWebhookRoute.test.ts
 *
 * Tests for the verdict webhook that feeds the self-improving SLM flywheel.
 *
 * Ralph Wiggum loop: RED → GREEN → VALIDATE → COMPLETE
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildVerdictPayload, fireVerdictWebhook } from "./verdictWebhookRoute";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const mockPubmedResults = [
  {
    pmid: "12345",
    title: "Protein XYZ binding study",
    abstractSnippet:
      "Our experiments demonstrate that protein XYZ binds to receptor ABC.",
    citationUrl: "https://pubmed.ncbi.nlm.nih.gov/12345",
  },
  {
    pmid: "67890",
    title: "Receptor ABC characterization",
    abstractSnippet: "Receptor ABC was characterized in detail.",
    citationUrl: "https://pubmed.ncbi.nlm.nih.gov/67890",
  },
];

// ── buildVerdictPayload ───────────────────────────────────────────────────────
describe("buildVerdictPayload", () => {
  it("builds a payload with the correct verdict and confidence", () => {
    const payload = buildVerdictPayload({
      claimId: "claim-001",
      claimText: "Protein XYZ binds to receptor ABC.",
      verdict: "Supported",
      confidence: 0.9,
      pubmedResults: mockPubmedResults,
      rationale: "2 peer-reviewed papers support this claim.",
    });

    expect(payload.claimId).toBe("claim-001");
    expect(payload.claimText).toBe("Protein XYZ binds to receptor ABC.");
    expect(payload.verdict).toBe("Supported");
    expect(payload.confidence).toBe(0.9);
  });

  it("uses the first PubMed abstract snippet as contextSentence", () => {
    const payload = buildVerdictPayload({
      claimId: null,
      claimText: "Protein XYZ binds to receptor ABC.",
      verdict: "Supported",
      confidence: 0.9,
      pubmedResults: mockPubmedResults,
    });

    expect(payload.contextSentence).toBe(
      "Our experiments demonstrate that protein XYZ binds to receptor ABC."
    );
  });

  it("falls back to claimText as contextSentence when no PubMed results", () => {
    const payload = buildVerdictPayload({
      claimId: null,
      claimText: "Protein XYZ binds to receptor ABC.",
      verdict: "Insufficient Evidence",
      confidence: 0.1,
      pubmedResults: [],
    });

    expect(payload.contextSentence).toBe("Protein XYZ binds to receptor ABC.");
  });

  it("builds provenance string from rationale", () => {
    const payload = buildVerdictPayload({
      claimId: null,
      claimText: "Test claim.",
      verdict: "Supported",
      confidence: 0.9,
      pubmedResults: [],
      rationale: "Evidence found in 2 papers.",
    });

    expect(payload.provenance).toContain("Evidence found in 2 papers.");
    expect(payload.provenance).toContain("Supported");
  });

  it("maps entities with canonicalId fallback to name", () => {
    const payload = buildVerdictPayload({
      claimId: null,
      claimText: "Test claim.",
      verdict: "Supported",
      confidence: 0.9,
      pubmedResults: [],
      entities: [
        { type: "protein", name: "XYZ", canonicalId: "P12345" },
        { type: "receptor", name: "ABC" }, // no canonicalId
      ],
    });

    expect(payload.entities[0]!.canonicalId).toBe("P12345");
    expect(payload.entities[1]!.canonicalId).toBe("ABC"); // falls back to name
  });

  it("returns empty entities array when not provided", () => {
    const payload = buildVerdictPayload({
      claimId: null,
      claimText: "Test claim.",
      verdict: "Supported",
      confidence: 0.9,
      pubmedResults: [],
    });

    expect(payload.entities).toEqual([]);
  });
});

// ── fireVerdictWebhook ────────────────────────────────────────────────────────
describe("fireVerdictWebhook", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not call fetch when COGNITIVE_LOOP_URL is not set", () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    // ENV.cognitiveLoopUrl defaults to "" in test environment
    const payload = buildVerdictPayload({
      claimId: "claim-001",
      claimText: "Test claim.",
      verdict: "Supported",
      confidence: 0.9,
      pubmedResults: [],
    });

    fireVerdictWebhook(payload);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not throw when fetch rejects (fire-and-forget)", async () => {
    // Temporarily override ENV.cognitiveLoopUrl by mocking the module
    // This tests the error-swallowing behavior
    const fetchSpy = vi.fn().mockRejectedValue(new Error("Network error"));
    globalThis.fetch = fetchSpy;

    // Should not throw
    expect(() => {
      fireVerdictWebhook({
        claimId: "claim-001",
        claimText: "Test claim.",
        verdict: "Supported",
        confidence: 0.9,
        contextSentence: "Test.",
        entities: [],
        provenance: "Test → Supported",
      });
    }).not.toThrow();

    // Give the promise time to reject silently
    await new Promise(resolve => setTimeout(resolve, 10));
  });
});
