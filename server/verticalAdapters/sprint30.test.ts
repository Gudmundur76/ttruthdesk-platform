import { describe, it, expect, vi, beforeEach } from "vitest";
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
import "./openfda_adverse";
import "./nice";
import "./who_iris";
import "./embase";
import { getVertical } from "./types";
beforeEach(() => {
  mockFetch.mockReset();
});

describe("openfda_adverse", () => {
  it("registers with domainKey openfda_adverse", () => {
    expect(getVertical("openfda_adverse")).toBeDefined();
  });
  it("returns found=true with FAERS data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            safetyreportid: "12345678",
            receivedate: "20240101",
            patient: {
              drug: [{ medicinalproduct: "aspirin" }],
              reaction: [{ reactionmeddrapt: "GI bleed" }],
            },
          },
        ],
        meta: { results: { total: 4200 } },
      }),
    });
    const r = await getVertical("openfda_adverse")!.lookupEvidence({
      claimText: "aspirin causes GI bleeding",
      extractedValue: null,
    });
    expect(r.found).toBe(true);
    expect(r.sourceId).toBe("12345678");
    expect(r.confidenceScore).toBeGreaterThan(0.6);
  });
  it("returns found=false on empty results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], meta: { results: { total: 0 } } }),
    });
    const r = await getVertical("openfda_adverse")!.lookupEvidence({
      claimText: "unknown drug",
      extractedValue: null,
    });
    expect(r.found).toBe(false);
  });
  it("returns found=false on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    const r = await getVertical("openfda_adverse")!.lookupEvidence({
      claimText: "aspirin",
      extractedValue: null,
    });
    expect(r.found).toBe(false);
    expect(r.confidenceFlags).toContain("http_error_429");
  });
  it("returns found=false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));
    const r = await getVertical("openfda_adverse")!.lookupEvidence({
      claimText: "aspirin",
      extractedValue: null,
    });
    expect(r.found).toBe(false);
    expect(r.confidenceFlags).toContain("network_or_parsing_error");
  });
});

describe("nice", () => {
  it("registers with domainKey nice", () => {
    expect(getVertical("nice")).toBeDefined();
  });
  it("returns found=true with NICE guideline", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        guidance: [
          {
            id: "NG198",
            title: "COVID-19 guideline",
            type: "Guideline",
            publishedDate: "2021-03-01",
            url: "https://www.nice.org.uk/guidance/ng198",
          },
        ],
      }),
    });
    const r = await getVertical("nice")!.lookupEvidence({
      claimText: "COVID-19 treatment",
      extractedValue: null,
    });
    expect(r.found).toBe(true);
    expect(r.sourceId).toBe("NG198");
    expect(r.confidenceScore).toBeGreaterThanOrEqual(0.9);
  });
  it("returns found=false on empty results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ guidance: [] }),
    });
    const r = await getVertical("nice")!.lookupEvidence({
      claimText: "obscure topic",
      extractedValue: null,
    });
    expect(r.found).toBe(false);
  });
  it("returns found=false on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const r = await getVertical("nice")!.lookupEvidence({
      claimText: "diabetes",
      extractedValue: null,
    });
    expect(r.found).toBe(false);
  });
  it("returns found=false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));
    const r = await getVertical("nice")!.lookupEvidence({
      claimText: "diabetes",
      extractedValue: null,
    });
    expect(r.found).toBe(false);
  });
});

describe("who_iris", () => {
  it("registers with domainKey who_iris", () => {
    expect(getVertical("who_iris")).toBeDefined();
  });
  it("returns found=true with WHO IRIS document", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _embedded: {
          searchResult: {
            _embedded: {
              objects: [
                {
                  indexableObject: {
                    handle: "10665/123456",
                    metadata: {
                      "dc.title": [{ value: "WHO malaria guidelines" }],
                      "dc.date.issued": [{ value: "2023" }],
                      "dc.type": [{ value: "Technical report" }],
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    });
    const r = await getVertical("who_iris")!.lookupEvidence({
      claimText: "malaria prevention",
      extractedValue: null,
    });
    expect(r.found).toBe(true);
    expect(r.sourceId).toBe("10665/123456");
    expect(r.confidenceFlags).toContain("who_primary_source");
  });
  it("returns found=false on empty results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _embedded: { searchResult: { _embedded: { objects: [] } } },
      }),
    });
    const r = await getVertical("who_iris")!.lookupEvidence({
      claimText: "obscure topic",
      extractedValue: null,
    });
    expect(r.found).toBe(false);
  });
  it("returns found=false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));
    const r = await getVertical("who_iris")!.lookupEvidence({
      claimText: "malaria",
      extractedValue: null,
    });
    expect(r.found).toBe(false);
  });
});

describe("embase", () => {
  it("registers with domainKey embase", () => {
    expect(getVertical("embase")).toBeDefined();
  });
  it("returns found=true with EMBASE article", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        resultList: {
          result: [
            {
              pmid: "38001234",
              doi: "10.1016/j.test.2024.001",
              title: "Pharmacokinetics of metformin",
              authorString: "Smith J",
              journalTitle: "Eur J Clin Pharmacol",
              pubYear: "2024",
              citedByCount: 45,
              isOpenAccess: "Y",
            },
          ],
        },
      }),
    });
    const r = await getVertical("embase")!.lookupEvidence({
      claimText: "metformin pharmacokinetics",
      extractedValue: null,
    });
    expect(r.found).toBe(true);
    expect(r.sourceId).toBe("10.1016/j.test.2024.001");
    expect(r.confidenceFlags).toContain("embase_peer_reviewed");
  });
  it("returns found=false on empty results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ resultList: { result: [] } }),
    });
    const r = await getVertical("embase")!.lookupEvidence({
      claimText: "obscure compound",
      extractedValue: null,
    });
    expect(r.found).toBe(false);
  });
  it("returns found=false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));
    const r = await getVertical("embase")!.lookupEvidence({
      claimText: "aspirin",
      extractedValue: null,
    });
    expect(r.found).toBe(false);
    expect(r.confidenceFlags).toContain("network_or_parsing_error");
  });
});
