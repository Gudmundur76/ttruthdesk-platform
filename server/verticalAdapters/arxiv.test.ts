/**
 * arxiv.test.ts
 * Unit tests for server/verticalAdapters/arxiv.ts
 * Note: arxiv uses DOMParser for XML parsing. We stub it globally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.mockFetch);

// Stub DOMParser since we're in Node environment
const mockQuerySelector = vi.fn();
const mockQuerySelectorAll = vi.fn();

const makeMockEntry = (
  title: string,
  id: string,
  link: string | null = null
) => ({
  querySelector: vi.fn((sel: string) => {
    if (sel === "title") return { textContent: title };
    if (sel === "summary") return { textContent: "Test summary" };
    if (sel === "id") return { textContent: `http://arxiv.org/abs/${id}` };
    if (sel === 'link[rel="alternate"]')
      return link ? { getAttribute: () => link } : null;
    if (sel.includes("journal_ref")) return null;
    if (sel === "published") return { textContent: "2023-01-15T00:00:00Z" };
    if (sel === "category") return { getAttribute: () => "cs.AI" };
    return null;
  }),
  querySelectorAll: vi.fn(() => []),
});

vi.stubGlobal(
  "DOMParser",
  class {
    parseFromString(xml: string) {
      if (xml.includes("<entry>")) {
        const entry = makeMockEntry(
          "Test Paper Title",
          "2301.00001",
          "https://arxiv.org/abs/2301.00001"
        );
        return {
          querySelectorAll: (sel: string) => (sel === "entry" ? [entry] : []),
          querySelector: mockQuerySelector,
        };
      }
      return {
        querySelectorAll: () => [],
        querySelector: mockQuerySelector,
      };
    }
  }
);

describe("arxivAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("is registered with domainKey 'arxiv'", async () => {
    const { registry } = await import("./types");
    await import("./arxiv");
    const adapter = registry.get("arxiv");
    expect(adapter).toBeDefined();
    expect(adapter?.domainKey).toBe("arxiv");
  });

  it("returns found=true when arXiv API returns entries", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2301.00001v1</id>
    <title>Test Paper Title</title>
    <summary>Test summary</summary>
    <link rel="alternate" href="https://arxiv.org/abs/2301.00001"/>
    <published>2023-01-15T00:00:00Z</published>
  </entry>
</feed>`,
    });
    const { registry } = await import("./types");
    await import("./arxiv");
    const adapter = registry.get("arxiv");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Transformer models achieve state of the art results",
      extractedValue: "transformer models",
    });
    expect(result.found).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0);
  });

  it("returns found=false when arXiv API returns no entries", async () => {
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
    });
    // Override DOMParser to return empty entries
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString() {
          return { querySelectorAll: () => [], querySelector: vi.fn() };
        }
      }
    );
    const { registry } = await import("./types");
    await import("./arxiv");
    const adapter = registry.get("arxiv");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Completely made up claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
  });

  it("handles network errors gracefully", async () => {
    mocks.mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const { registry } = await import("./types");
    await import("./arxiv");
    const adapter = registry.get("arxiv");
    if (!adapter) throw new Error("Adapter not registered");
    const result = await adapter.lookupEvidence({
      claimText: "Some research claim",
      extractedValue: null,
    });
    expect(result.found).toBe(false);
    expect(result.confidenceFlags.length).toBeGreaterThan(0);
  });
});
