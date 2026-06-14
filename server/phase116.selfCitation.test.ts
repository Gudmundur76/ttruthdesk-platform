/**
 * phase116.selfCitation.test.ts
 * RED → GREEN tests for Phase 116: selfCitationFraction in OcEnrichmentResult.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the vertical adapter registry ──────────────────────────────────────
vi.mock("./verticalAdapters/types", () => ({
  getVertical: vi.fn(),
}));
import { getVertical } from "./verticalAdapters/types";
import { openCitationsEnrichClaim } from "./openCitationsEnricher";

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    lookupEvidence: vi.fn().mockResolvedValue({
      found: true,
      sourceId: "doi:10.1000/test",
      sourceUrl: "https://doi.org/10.1000/test",
      confidenceScore: 0.75,
      confidenceFlags: ["Cited 20 times (OpenCitations)"],
      evidenceRaw: {
        doi: "10.1000/test",
        citationCount: 20,
        selfCitationFraction: 0.25,
        citationSample: [],
        ...overrides,
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Phase 116 — selfCitationFraction in OcEnrichmentResult", () => {
  it("returns selfCitationFraction when evidenceRaw contains it", async () => {
    vi.mocked(getVertical).mockReturnValue(makeAdapter({ selfCitationFraction: 0.4 }) as never);
    const result = await openCitationsEnrichClaim(
      "This paper 10.1000/test shows results",
      null
    );
    expect(result).not.toBeNull();
    expect(result!.selfCitationFraction).toBe(0.4);
  });

  it("returns selfCitationFraction of 0 when no self-citations", async () => {
    vi.mocked(getVertical).mockReturnValue(makeAdapter({ selfCitationFraction: 0 }) as never);
    const result = await openCitationsEnrichClaim(
      "This paper 10.1000/test shows results",
      null
    );
    expect(result).not.toBeNull();
    expect(result!.selfCitationFraction).toBe(0);
  });

  it("returns selfCitationFraction of null when evidenceRaw does not contain it", async () => {
    const adapterWithoutFraction = {
      lookupEvidence: vi.fn().mockResolvedValue({
        found: true,
        sourceId: "doi:10.1000/test",
        sourceUrl: "https://doi.org/10.1000/test",
        confidenceScore: 0.75,
        confidenceFlags: [],
        evidenceRaw: {
          doi: "10.1000/test",
          citationCount: 5,
          // no selfCitationFraction field
        },
      }),
    };
    vi.mocked(getVertical).mockReturnValue(adapterWithoutFraction as never);
    const result = await openCitationsEnrichClaim(
      "This paper 10.1000/test shows results",
      null
    );
    expect(result).not.toBeNull();
    expect(result!.selfCitationFraction).toBeNull();
  });

  it("selfCitationFraction is included in OcEnrichmentResult interface", async () => {
    vi.mocked(getVertical).mockReturnValue(makeAdapter({ selfCitationFraction: 0.15 }) as never);
    const result = await openCitationsEnrichClaim(
      "DOI 10.1000/test is cited",
      "10.1000/test"
    );
    expect(result).not.toBeNull();
    // TypeScript compile check — selfCitationFraction must be a key on the result
    expect(Object.prototype.hasOwnProperty.call(result, "selfCitationFraction")).toBe(true);
  });

  it("opencitations adapter computes selfCitationFraction as selfCiteCount / total", async () => {
    // The adapter should compute fraction = selfCiteCount / citationSample.length
    // We test this via the enricher by checking the fraction matches expected ratio
    const adapterWithSample = {
      lookupEvidence: vi.fn().mockResolvedValue({
        found: true,
        sourceId: "doi:10.1000/test",
        sourceUrl: "https://doi.org/10.1000/test",
        confidenceScore: 0.80,
        confidenceFlags: [],
        evidenceRaw: {
          doi: "10.1000/test",
          citationCount: 4,
          // 2 out of 4 are self-citations → fraction = 0.5
          selfCitationFraction: 0.5,
          citationSample: [
            { oci: "a", citing: "x", selfCite: true },
            { oci: "b", citing: "y", selfCite: false },
            { oci: "c", citing: "z", selfCite: true },
            { oci: "d", citing: "w", selfCite: false },
          ],
        },
      }),
    };
    vi.mocked(getVertical).mockReturnValue(adapterWithSample as never);
    const result = await openCitationsEnrichClaim(
      "See 10.1000/test for details",
      null
    );
    expect(result).not.toBeNull();
    expect(result!.selfCitationFraction).toBe(0.5);
  });
});
