/**
 * sourceVersionAgent.test.ts — Phase 109
 *
 * Tests for the Source Version Agent:
 *   - fetchSourceProbe: probe URL resolution and HTTP fetch
 *   - extractVersionLabel: version string extraction from response text
 *   - computeHash: deterministic SHA-256 hashing
 *   - runSourceVersionAgent: full integration (mocked DB + fetch)
 *
 * Ralph Wiggum loop: tests run until green, no skips.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchSourceProbe,
  computeVersionHash,
  classifyChangeType,
  runSourceVersionAgent,
} from "./sourceVersionAgent";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeFetchResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

// ─── computeHash ───────────────────────────────────────────────────────────────

describe("computeVersionHash", () => {
  it("returns a 32-char hex string for any non-empty input", () => {
    const hash = computeVersionHash("hello world");
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic — same input always produces same hash", () => {
    const a = computeVersionHash({ version: "1.0.0" });
    const b = computeVersionHash({ version: "1.0.0" });
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    const a = computeVersionHash({ version: "1.0" });
    const b = computeVersionHash({ version: "1.1" });
    expect(a).not.toBe(b);
  });

  it("handles null/empty object without throwing", () => {
    const hash = computeVersionHash({});
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is key-order independent (normalises key order)", () => {
    const a = computeVersionHash({ z: 1, a: 2 });
    const b = computeVersionHash({ a: 2, z: 1 });
    expect(a).toBe(b);
  });
});

// ─── fetchSourceProbe ──────────────────────────────────────────────────────────

describe("fetchSourceProbe", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns text and label for a known source with a successful probe", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse('{"version":"1.2.3","status":"ok"}')
    );

    const result = await fetchSourceProbe("pubmed", "https://eutils.ncbi.nlm.nih.gov");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("version");
    expect(typeof result!.label).toBe("string");
  });

  it("returns null when fetch throws (network error)", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchSourceProbe("pubmed", "https://eutils.ncbi.nlm.nih.gov");
    expect(result).toBeNull();
  });

  it("returns null when HTTP response is not ok (404)", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(makeFetchResponse("Not Found", 404));

    const result = await fetchSourceProbe("crossref", "https://api.crossref.org");
    expect(result).toBeNull();
  });

  it("returns null for generic_url source with no apiBaseUrl", async () => {
    // generic_url has no probe URL and empty apiBaseUrl → should return null
    const result = await fetchSourceProbe("generic_url", "");
    expect(result).toBeNull();
  });

  it("uses apiBaseUrl as fallback for unknown source IDs", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(makeFetchResponse('{"ok":true}'));

    const result = await fetchSourceProbe("my_custom_source", "https://example.com/api");
    expect(result).not.toBeNull();
    // Should have called fetch with the apiBaseUrl
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it("extracts version label from response containing v-prefixed version", async () => {
    const mockFetch = vi.mocked(fetch);
    // v-prefixed pattern: /v([0-9]+\.[0-9]+(?:\.[0-9]+)?)/ captures the number part
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse('{"release":"v2.5.1","updated":"2024-01-01"}')
    );

    const result = await fetchSourceProbe("openalex", "https://api.openalex.org");
    expect(result).not.toBeNull();
    // extractVersionLabel returns the capture group ("2.5.1") not the full match
    expect(result!.label).toBe("2.5.1");
  });

  it("extracts version label from response containing version key", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse('{"version":"3.14.0","name":"test"}')
    );

    const result = await fetchSourceProbe("openalex", "https://api.openalex.org");
    expect(result).not.toBeNull();
    expect(result!.label).toBe("3.14.0");
  });

  it("falls back to 'unknown' label when no version pattern is found", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse('{"status":"ok","count":42}')
    );

    const result = await fetchSourceProbe("openalex", "https://api.openalex.org");
    expect(result).not.toBeNull();
    expect(result!.label).toBe("unknown");
  });
});

// ─── runSourceVersionAgent ─────────────────────────────────────────────────────

describe("runSourceVersionAgent", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns a result object with the correct shape", async () => {
    // Mock DB to return no approved sources
    vi.doMock("./db", () => ({
      getDb: vi.fn().mockResolvedValue(null),
    }));

    const { runSourceVersionAgent: run } = await import("./sourceVersionAgent");
    const result = await run();

    expect(result).toMatchObject({
      sourcesChecked: expect.any(Number),
      sourcesUpdated: expect.any(Number),
      sourcesUnchanged: expect.any(Number),
      sourcesErrored: expect.any(Number),
      sourcesSkipped: expect.any(Number),
      durationMs: expect.any(Number),
    });
  });

  it("returns non-zero sourcesChecked when SOURCE_WHITELIST has approved sources", async () => {
    // runSourceVersionAgent iterates SOURCE_WHITELIST regardless of DB availability.
    // When DB is null, getSourceVersion returns null (no previous hash) and
    // upsertSourceVersion is a no-op, so sources end up as errored (probe fails)
    // or skipped (generic_url / doi_fallback). sourcesChecked = approved sources count.
    vi.doMock("./db", () => ({
      getDb: vi.fn().mockResolvedValue(null),
    }));

    const { runSourceVersionAgent: run } = await import("./sourceVersionAgent");
    const result = await run();

    // sourcesChecked is the count of approved sources in SOURCE_WHITELIST
    expect(result.sourcesChecked).toBeGreaterThan(0);
    // All counts are non-negative
    expect(result.sourcesUpdated).toBeGreaterThanOrEqual(0);
    expect(result.sourcesUnchanged).toBeGreaterThanOrEqual(0);
    expect(result.sourcesErrored).toBeGreaterThanOrEqual(0);
    expect(result.sourcesSkipped).toBeGreaterThanOrEqual(0);
    // Total must equal sourcesChecked
    expect(
      result.sourcesUpdated + result.sourcesUnchanged + result.sourcesErrored + result.sourcesSkipped
    ).toBe(result.sourcesChecked);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("durationMs is a non-negative number", async () => {
    vi.doMock("./db", () => ({
      getDb: vi.fn().mockResolvedValue(null),
    }));

    const { runSourceVersionAgent: run } = await import("./sourceVersionAgent");
    const result = await run();

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Integration: hash stability ──────────────────────────────────────────────

describe("hash stability across runs", () => {
  it("identical probe responses produce identical hashes (idempotency)", () => {
    const payload = { version: "1.0.0", count: 42, status: "ok" };
    const h1 = computeVersionHash(payload);
    const h2 = computeVersionHash(payload);
    expect(h1).toBe(h2);
  });

  it("single-character change produces a completely different hash (avalanche)", () => {
    const h1 = computeVersionHash({ version: "1.0.0" });
    const h2 = computeVersionHash({ version: "1.0.1" });
    // Hashes should differ — just check they are not equal
    expect(h1).not.toBe(h2);
    // And both are valid 32-char hex
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
    expect(h2).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ─── classifyChangeType ───────────────────────────────────────────────────────────────────

describe("classifyChangeType", () => {
  it("returns 'retraction' for text containing 'retracted'", () => {
    expect(classifyChangeType("This paper has been retracted by the authors.")).toBe("retraction");
  });

  it("returns 'retraction' for text containing 'withdrawn' (case-insensitive)", () => {
    expect(classifyChangeType("WITHDRAWN: The article was withdrawn.")).toBe("retraction");
  });

  it("returns 'major' for text containing 'breaking change'", () => {
    expect(classifyChangeType("v2.0.0: breaking change in API schema")).toBe("major");
  });

  it("returns 'major' for text containing 'major release'", () => {
    expect(classifyChangeType("major release: new schema update in v3")).toBe("major");
  });

  it("returns 'minor' for ordinary update text", () => {
    expect(classifyChangeType("Updated count: 42, status: ok")).toBe("minor");
  });

  it("returns 'minor' for empty string", () => {
    expect(classifyChangeType("")).toBe("minor");
  });

  it("prioritises retraction over major keywords", () => {
    expect(classifyChangeType("retracted: breaking change in v2")).toBe("retraction");
  });
});
