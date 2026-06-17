/**
 * cochrane.test.ts
 * Unit tests for the PubMed-backed Cochrane adapter (Sprint 41 fix).
 *
 * The adapter makes two sequential PubMed API calls:
 *   1. esearch  → returns PMID list
 *   2. esummary → returns full record with DOI, title, journal
 *
 * All fetch calls are mocked via vi.stubGlobal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esearchResponse(pmids: string[]) {
  return {
    ok: true,
    json: async () => ({ esearchresult: { idlist: pmids } }),
  };
}

function esummaryResponse(pmid: string, doi: string, title: string) {
  return {
    ok: true,
    json: async () => ({
      result: {
        [pmid]: {
          uid: pmid,
          title,
          fulljournalname: "The Cochrane database of systematic reviews",
          pubdate: "2024",
          authors: [{ name: "Smith J" }, { name: "Jones A" }],
          articleids: [
            { idtype: "doi", value: doi },
            { idtype: "pubmed", value: pmid },
          ],
        },
      },
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CochraneAdapter (PubMed-backed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'cochrane'", async () => {
    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("cochrane");
  });

  it("returns found=true with DOI and Cochrane URL for a keyword search", async () => {
    const pmid = "41919561";
    const doi = "10.1002/14651858.CD015266.pub3";
    mocks.mockFetch
      .mockResolvedValueOnce(esearchResponse([pmid]))
      .mockResolvedValueOnce(
        esummaryResponse(pmid, doi, "Aspirin for colorectal cancer prevention")
      );

    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    if (!adapter) throw new Error("Adapter not registered");

    const result = await adapter.lookupEvidence({
      claimText: "Aspirin reduces colorectal cancer risk",
      extractedValue: "aspirin colorectal cancer",
    });

    expect(result.found).toBe(true);
    expect(result.sourceId).toBe(doi);
    expect(result.sourceUrl).toBe(
      `https://www.cochranelibrary.com/cdsr/doi/${doi}/full`
    );
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.9);
    expect(result.confidenceFlags).toContain("cochrane_review_via_pubmed");
    expect(
      (result.evidenceRaw as Record<string, unknown>)?.cochrane_review
    ).toBe(true);
  });

  it("searches by DOI when claim contains a Cochrane DOI", async () => {
    const pmid = "38000001";
    const doi = "10.1002/14651858.CD001234.pub5";
    mocks.mockFetch
      .mockResolvedValueOnce(esearchResponse([pmid]))
      .mockResolvedValueOnce(
        esummaryResponse(pmid, doi, "Paracetamol for acute pain")
      );

    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    if (!adapter) throw new Error("Adapter not registered");

    const result = await adapter.lookupEvidence({
      claimText: `The review ${doi} found paracetamol effective`,
      extractedValue: null,
    });

    expect(result.found).toBe(true);
    expect(result.sourceId).toBe(doi);
    // Verify the first fetch used [AID] DOI search term
    const firstCallUrl = mocks.mockFetch.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain("AID");
    expect(firstCallUrl).toContain(encodeURIComponent(doi));
  });

  it("returns found=false when PubMed returns no PMIDs", async () => {
    mocks.mockFetch.mockResolvedValueOnce(esearchResponse([]));

    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    if (!adapter) throw new Error("Adapter not registered");

    const result = await adapter.lookupEvidence({
      claimText: "Completely invented medical claim xyznonexistent",
      extractedValue: null,
    });

    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("no_cochrane_review_found");
  });

  it("returns found=false when PubMed esearch returns HTTP error", async () => {
    mocks.mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    if (!adapter) throw new Error("Adapter not registered");

    const result = await adapter.lookupEvidence({
      claimText: "Some medical claim",
      extractedValue: null,
    });

    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("pubmed_esearch_http_error");
  });

  it("returns found=false when PubMed esummary returns HTTP error", async () => {
    mocks.mockFetch
      .mockResolvedValueOnce(esearchResponse(["12345678"]))
      .mockResolvedValueOnce({ ok: false, status: 503 });

    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    if (!adapter) throw new Error("Adapter not registered");

    const result = await adapter.lookupEvidence({
      claimText: "Some medical claim",
      extractedValue: null,
    });

    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("pubmed_esummary_http_error");
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    if (!adapter) throw new Error("Adapter not registered");

    const result = await adapter.lookupEvidence({
      claimText: "Some medical claim",
      extractedValue: null,
    });

    expect(result.found).toBe(false);
    expect(result.confidenceFlags).toContain("network_or_parsing_error");
  });

  it("falls back to PubMed URL when no DOI in summary record", async () => {
    const pmid = "99999999";
    mocks.mockFetch
      .mockResolvedValueOnce(esearchResponse([pmid]))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            [pmid]: {
              uid: pmid,
              title: "Review without DOI",
              fulljournalname: "The Cochrane database of systematic reviews",
              pubdate: "2023",
              authors: [],
              articleids: [{ idtype: "pubmed", value: pmid }],
            },
          },
        }),
      });

    const { registry } = await import("./types");
    await import("./cochrane");
    const adapter = registry.get("cochrane");
    if (!adapter) throw new Error("Adapter not registered");

    const result = await adapter.lookupEvidence({
      claimText: "Some review without a DOI",
      extractedValue: null,
    });

    expect(result.found).toBe(true);
    expect(result.sourceId).toBe(`pmid:${pmid}`);
    expect(result.sourceUrl).toBe(`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`);
  });
});
