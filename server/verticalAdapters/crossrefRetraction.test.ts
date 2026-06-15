/**
 * crossref.test.ts — Ralph Wiggum TDD loop
 * Tests for Crossref + Scite retraction detection adapter.
 * All network calls are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractDoisFromText, checkDoiRetraction } from "./crossrefRetraction";

// ─── extractDoisFromText ──────────────────────────────────────────────────────

describe("extractDoisFromText", () => {
  it("extracts a simple DOI from text", () => {
    const dois = extractDoisFromText(
      "See the paper at 10.1016/j.cell.2014.05.010 for details."
    );
    expect(dois).toContain("10.1016/j.cell.2014.05.010");
  });

  it("extracts multiple DOIs from text", () => {
    const dois = extractDoisFromText(
      "Papers 10.1038/nature12345 and 10.1126/science.abcd1234 both support this."
    );
    expect(dois.length).toBe(2);
  });

  it("returns empty array when no DOI present", () => {
    const dois = extractDoisFromText("No DOI in this text at all.");
    expect(dois).toHaveLength(0);
  });

  it("deduplicates repeated DOIs", () => {
    const dois = extractDoisFromText(
      "10.1038/nature12345 and again 10.1038/nature12345"
    );
    expect(dois).toHaveLength(1);
  });

  it("handles DOIs with complex suffixes", () => {
    const dois = extractDoisFromText(
      "Retracted: 10.1016/S0140-6736(97)11096-0"
    );
    expect(dois.length).toBeGreaterThan(0);
  });
});

// ─── checkDoiRetraction ───────────────────────────────────────────────────────

describe("checkDoiRetraction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns retracted=true when Scite confirms retraction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("scite.ai")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                retracted: true,
                editorialNotices: [
                  {
                    status: "Retracted",
                    date: "2010-02-06",
                    noticeDoi: "10.1016/s0140-6736(10)60175-4",
                  },
                ],
              }),
          });
        }
        // Crossref returns no retraction
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ message: { "update-to": [] } }),
        });
      })
    );

    const result = await checkDoiRetraction("10.1016/S0140-6736(97)11096-0");
    expect(result.retracted).toBe(true);
    expect(result.source).toBe("scite");
    expect(result.retractionDate).toBe("2010-02-06");
    expect(result.noticeDoi).toBe("10.1016/s0140-6736(10)60175-4");
  });

  it("returns retracted=true when Crossref confirms retraction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("crossref.org")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                message: {
                  "update-to": [
                    {
                      type: "retraction",
                      DOI: "10.1234/retraction-notice",
                      updated: { "date-time": "2023-01-15T00:00:00Z" },
                    },
                  ],
                },
              }),
          });
        }
        // Scite returns not retracted
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ retracted: false, editorialNotices: [] }),
        });
      })
    );

    const result = await checkDoiRetraction("10.1234/some-paper");
    expect(result.retracted).toBe(true);
    expect(result.source).toBe("crossref");
    expect(result.retractionDate).toBe("2023-01-15");
  });

  it("returns retracted=false for a valid non-retracted paper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            retracted: false,
            editorialNotices: [],
            message: { "update-to": [] },
          }),
      })
    );

    const result = await checkDoiRetraction("10.1016/j.cell.2014.05.010");
    expect(result.retracted).toBe(false);
    expect(result.source).toBe("none");
    expect(result.retractionDate).toBeNull();
  });

  it("handles network errors gracefully — never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error"))
    );

    const result = await checkDoiRetraction("10.1234/any-doi");
    expect(result).toBeDefined();
    expect(result.retracted).toBe(false);
    expect(result.doi).toBe("10.1234/any-doi");
  });

  it("returns all editorial notices from Scite", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("scite.ai")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                retracted: false,
                editorialNotices: [
                  {
                    status: "Has correction",
                    date: "2022-01-01",
                    noticeDoi: "10.1234/corr",
                  },
                  {
                    status: "Comment",
                    date: "2022-03-01",
                    noticeDoi: "10.1234/comment",
                  },
                ],
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ message: { "update-to": [] } }),
        });
      })
    );

    const result = await checkDoiRetraction("10.1234/paper-with-correction");
    expect(result.retracted).toBe(false);
    expect(result.editorialNotices.length).toBe(2);
    expect(result.editorialNotices[0].status).toBe("Has correction");
  });
});
