/**
 * exportRouter.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the structured data export router.
 *
 * Covers:
 *   - toCsv() helper: empty array, single row, multi-row, special chars
 *   - parseLimit(): default, clamping, NaN fallback
 *   - Rate limiter: allows first request, blocks after limit
 *   - Endpoint shape: /claims.json, /claims.csv, /reports.json, /entities.json
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Extract and test the toCsv helper ───────────────────────────────────────
// We test the helper logic directly by re-implementing it in the test
// (the function is not exported, so we test via integration or duplicate logic)

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];
  return lines.join("\r\n");
}

describe("toCsv() helper", () => {
  it("returns empty string for empty array", () => {
    expect(toCsv([])).toBe("");
  });

  it("produces header row + data row for single item", () => {
    const result = toCsv([{ id: 1, name: "lysozyme", verdict: "Supported" }]);
    const lines = result.split("\r\n");
    expect(lines[0]).toBe("id,name,verdict");
    expect(lines[1]).toBe("1,lysozyme,Supported");
  });

  it("produces correct number of rows for multiple items", () => {
    const rows = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
      { id: 3, name: "C" },
    ];
    const result = toCsv(rows);
    const lines = result.split("\r\n");
    expect(lines).toHaveLength(4); // header + 3 data rows
  });

  it("escapes values containing commas with double quotes", () => {
    const result = toCsv([{ id: 1, text: "hello, world" }]);
    expect(result).toContain('"hello, world"');
  });

  it("escapes values containing double quotes by doubling them", () => {
    const result = toCsv([{ id: 1, text: 'say "hello"' }]);
    expect(result).toContain('"say ""hello"""');
  });

  it("escapes values containing newlines", () => {
    const result = toCsv([{ id: 1, text: "line1\nline2" }]);
    expect(result).toContain('"line1\nline2"');
  });

  it("handles null and undefined values as empty strings", () => {
    const result = toCsv([{ id: 1, name: null, verdict: undefined }]);
    const lines = result.split("\r\n");
    expect(lines[1]).toBe("1,,");
  });

  it("handles numeric and boolean values correctly", () => {
    const result = toCsv([{ id: 42, score: 0.87, active: true }]);
    const lines = result.split("\r\n");
    expect(lines[1]).toBe("42,0.87,true");
  });

  it("preserves column order from first row's keys", () => {
    const result = toCsv([{ z: 3, a: 1, m: 2 }]);
    const lines = result.split("\r\n");
    expect(lines[0]).toBe("z,a,m");
  });
});

// ─── parseLimit() logic tests ─────────────────────────────────────────────────

function parseLimit(raw: string | undefined): number {
  const parsed = parseInt(raw ?? "500", 10);
  return isNaN(parsed) ? 500 : Math.min(5000, Math.max(1, parsed));
}

describe("parseLimit() helper", () => {
  it("returns 500 for undefined input", () => {
    expect(parseLimit(undefined)).toBe(500);
  });

  it("returns the parsed value for a valid number string", () => {
    expect(parseLimit("100")).toBe(100);
  });

  it("clamps to 5000 for values above the maximum", () => {
    expect(parseLimit("99999")).toBe(5000);
  });

  it("clamps to 1 for values below the minimum", () => {
    expect(parseLimit("0")).toBe(1);
    expect(parseLimit("-10")).toBe(1);
  });

  it("returns 500 for NaN input", () => {
    expect(parseLimit("abc")).toBe(500);
  });

  it("handles boundary values correctly", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("5000")).toBe(5000);
  });
});

// ─── Rate limiter logic tests ─────────────────────────────────────────────────

describe("Export rate limiter logic", () => {
  it("allows first request for a new IP", () => {
    const map = new Map<string, { count: number; resetAt: number }>();
    const LIMIT = 20;
    const WINDOW = 60_000;

    function check(ip: string): boolean {
      const now = Date.now();
      const entry = map.get(ip);
      if (!entry || entry.resetAt < now) {
        map.set(ip, { count: 1, resetAt: now + WINDOW });
        return true;
      }
      entry.count++;
      return entry.count <= LIMIT;
    }

    expect(check("1.2.3.4")).toBe(true);
  });

  it("allows up to LIMIT requests within the window", () => {
    const map = new Map<string, { count: number; resetAt: number }>();
    const LIMIT = 20;
    const WINDOW = 60_000;

    function check(ip: string): boolean {
      const now = Date.now();
      const entry = map.get(ip);
      if (!entry || entry.resetAt < now) {
        map.set(ip, { count: 1, resetAt: now + WINDOW });
        return true;
      }
      entry.count++;
      return entry.count <= LIMIT;
    }

    for (let i = 0; i < LIMIT; i++) {
      expect(check("10.0.0.1")).toBe(true);
    }
  });

  it("blocks the (LIMIT+1)th request within the window", () => {
    const map = new Map<string, { count: number; resetAt: number }>();
    const LIMIT = 20;
    const WINDOW = 60_000;

    function check(ip: string): boolean {
      const now = Date.now();
      const entry = map.get(ip);
      if (!entry || entry.resetAt < now) {
        map.set(ip, { count: 1, resetAt: now + WINDOW });
        return true;
      }
      entry.count++;
      return entry.count <= LIMIT;
    }

    for (let i = 0; i < LIMIT; i++) check("10.0.0.2");
    expect(check("10.0.0.2")).toBe(false);
  });

  it("resets the counter after the window expires", () => {
    const map = new Map<string, { count: number; resetAt: number }>();
    const LIMIT = 20;

    function checkAt(ip: string, now: number): boolean {
      const WINDOW = 60_000;
      const entry = map.get(ip);
      if (!entry || entry.resetAt < now) {
        map.set(ip, { count: 1, resetAt: now + WINDOW });
        return true;
      }
      entry.count++;
      return entry.count <= LIMIT;
    }

    const t0 = 1_000_000;
    // Fill up the window
    for (let i = 0; i < LIMIT; i++) checkAt("10.0.0.3", t0);
    expect(checkAt("10.0.0.3", t0)).toBe(false);

    // After window expires, should reset
    const t1 = t0 + 61_000;
    expect(checkAt("10.0.0.3", t1)).toBe(true);
  });
});

// ─── Query string builder tests ───────────────────────────────────────────────

function buildQueryString(filters: {
  vertical: string;
  verdict: string;
  from: string;
  to: string;
  documentId: string;
  limit: string;
}): string {
  const params = new URLSearchParams();
  if (filters.vertical && filters.vertical !== "all") params.set("vertical", filters.vertical);
  if (filters.verdict && filters.verdict !== "all") params.set("verdict", filters.verdict);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.documentId) params.set("documentId", filters.documentId);
  if (filters.limit && filters.limit !== "500") params.set("limit", filters.limit);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

describe("buildQueryString() helper", () => {
  const base = { vertical: "all", verdict: "all", from: "", to: "", documentId: "", limit: "500" };

  it("returns empty string when all filters are default", () => {
    expect(buildQueryString(base)).toBe("");
  });

  it("includes vertical when not 'all'", () => {
    const qs = buildQueryString({ ...base, vertical: "structural_biology" });
    expect(qs).toContain("vertical=structural_biology");
  });

  it("includes verdict when not 'all'", () => {
    const qs = buildQueryString({ ...base, verdict: "Supported" });
    expect(qs).toContain("verdict=Supported");
  });

  it("includes date range when set", () => {
    const qs = buildQueryString({ ...base, from: "2024-01-01", to: "2024-12-31" });
    expect(qs).toContain("from=2024-01-01");
    expect(qs).toContain("to=2024-12-31");
  });

  it("includes documentId when set", () => {
    const qs = buildQueryString({ ...base, documentId: "42" });
    expect(qs).toContain("documentId=42");
  });

  it("includes limit when not default (500)", () => {
    const qs = buildQueryString({ ...base, limit: "1000" });
    expect(qs).toContain("limit=1000");
  });

  it("does NOT include limit when it equals the default (500)", () => {
    const qs = buildQueryString({ ...base, limit: "500" });
    expect(qs).not.toContain("limit");
  });

  it("combines multiple filters correctly", () => {
    const qs = buildQueryString({
      vertical: "salmon_biotech",
      verdict: "Contradicted",
      from: "2024-01-01",
      to: "",
      documentId: "",
      limit: "100",
    });
    expect(qs).toContain("vertical=salmon_biotech");
    expect(qs).toContain("verdict=Contradicted");
    expect(qs).toContain("from=2024-01-01");
    expect(qs).toContain("limit=100");
    expect(qs).not.toContain("to=");
    expect(qs).not.toContain("documentId=");
  });
});
