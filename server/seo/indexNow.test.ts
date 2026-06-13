/**
 * indexNow.test.ts
 * Tests for the IndexNow SEO helper and FAQPage JSON-LD builder.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notifyIndexNow, notifyIndexNowBatch, claimUrl, wikiUrl, reportUrl } from "./indexNow";

// ─── Mock fetch globally ──────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── URL helpers ──────────────────────────────────────────────────────────────
describe("URL helpers", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("claimUrl returns correct URL with default host", () => {
    delete process.env.VITE_APP_URL;
    const url = claimUrl(42);
    expect(url).toBe("https://protein-desk-5r5rzpyg.manus.space/claim/42");
  });

  it("claimUrl uses VITE_APP_URL when set", () => {
    process.env.VITE_APP_URL = "https://custom.example.com";
    const url = claimUrl(99);
    expect(url).toBe("https://custom.example.com/claim/99");
  });

  it("wikiUrl returns correct URL", () => {
    delete process.env.VITE_APP_URL;
    const url = wikiUrl("protein", "hemoglobin");
    expect(url).toBe("https://protein-desk-5r5rzpyg.manus.space/wiki/protein/hemoglobin");
  });

  it("reportUrl returns correct URL", () => {
    delete process.env.VITE_APP_URL;
    const url = reportUrl(7);
    expect(url).toBe("https://protein-desk-5r5rzpyg.manus.space/reports/7");
  });
});

// ─── notifyIndexNow ───────────────────────────────────────────────────────────
describe("notifyIndexNow", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("does nothing when INDEX_NOW_KEY is not set", async () => {
    delete process.env.INDEX_NOW_KEY;
    await notifyIndexNow("https://example.com/claim/1");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends POST to IndexNow endpoint with correct body when key is set", async () => {
    process.env.INDEX_NOW_KEY = "test-key-abc123";
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await notifyIndexNow("https://protein-desk-5r5rzpyg.manus.space/claim/1");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body as string) as {
      host: string;
      key: string;
      keyLocation: string;
      urlList: string[];
    };
    expect(body.key).toBe("test-key-abc123");
    expect(body.urlList).toEqual(["https://protein-desk-5r5rzpyg.manus.space/claim/1"]);
    expect(body.keyLocation).toContain("test-key-abc123.txt");
  });

  it("accepts 202 status as success", async () => {
    process.env.INDEX_NOW_KEY = "key-xyz";
    mockFetch.mockResolvedValueOnce({ ok: false, status: 202 });

    // Should not throw
    await expect(notifyIndexNow("https://example.com/claim/5")).resolves.toBeUndefined();
  });

  it("logs warning on unexpected status but does not throw", async () => {
    process.env.INDEX_NOW_KEY = "key-xyz";
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    // Production code now uses structured logger (writes JSON to stdout)
    const captured: string[] = [];
     
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
      captured.push(String(chunk));
      return true;
    });

    await notifyIndexNow("https://example.com/claim/5");
    stdoutSpy.mockRestore();
    expect(captured.join("")).toContain("429");
  });

  it("does not throw when fetch rejects", async () => {
    process.env.INDEX_NOW_KEY = "key-xyz";
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    await expect(notifyIndexNow("https://example.com/claim/5")).resolves.toBeUndefined();
  });
});

// ─── notifyIndexNowBatch ──────────────────────────────────────────────────────
describe("notifyIndexNowBatch", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("does nothing when key is not set", async () => {
    delete process.env.INDEX_NOW_KEY;
    await notifyIndexNowBatch(["https://example.com/claim/1", "https://example.com/claim/2"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does nothing when urls array is empty", async () => {
    process.env.INDEX_NOW_KEY = "key-xyz";
    await notifyIndexNowBatch([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends all URLs in a single request when under batch limit", async () => {
    process.env.INDEX_NOW_KEY = "key-batch";
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const urls = Array.from({ length: 50 }, (_, i) => `https://example.com/claim/${i}`);
    await notifyIndexNowBatch(urls);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { urlList: string[] };
    expect(body.urlList).toHaveLength(50);
  });

  it("sends correct Content-Type header", async () => {
    process.env.INDEX_NOW_KEY = "key-batch";
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await notifyIndexNowBatch(["https://example.com/claim/1"]);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json; charset=utf-8"
    );
  });

  it("does not throw when fetch rejects on batch", async () => {
    process.env.INDEX_NOW_KEY = "key-batch";
    mockFetch.mockRejectedValueOnce(new Error("Timeout"));

    await expect(
      notifyIndexNowBatch(["https://example.com/claim/1"])
    ).resolves.toBeUndefined();
  });
});
