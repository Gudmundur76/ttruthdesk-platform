import { describe, it, expect } from "vitest";

// ── Pure unit tests for leaderboard ranking logic ──────────────────────────────

interface EntityRow {
  id: number;
  canonicalName: string;
  entityType: string;
  totalCitations: number;
  recentCitations: number;
}

function rankEntities(rows: EntityRow[]): (EntityRow & { rank: number; trend: "up" | "down" | "stable"; trendDelta: number })[] {
  const sorted = [...rows].sort((a, b) => b.totalCitations - a.totalCitations);
  return sorted.map((e, i) => {
    const delta = e.recentCitations - Math.floor(e.totalCitations * 0.1);
    const trend: "up" | "down" | "stable" = delta > 0 ? "up" : delta < 0 ? "down" : "stable";
    return { ...e, rank: i + 1, trend, trendDelta: Math.abs(delta) };
  });
}

describe("verticalLeaderboard — rankEntities", () => {
  it("ranks by totalCitations descending", () => {
    const rows: EntityRow[] = [
      { id: 1, canonicalName: "Whey Protein", entityType: "protein", totalCitations: 500, recentCitations: 80 },
      { id: 2, canonicalName: "Casein", entityType: "protein", totalCitations: 300, recentCitations: 20 },
      { id: 3, canonicalName: "Creatine", entityType: "ligand", totalCitations: 800, recentCitations: 100 },
    ];
    const ranked = rankEntities(rows);
    expect(ranked[0].canonicalName).toBe("Creatine");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].canonicalName).toBe("Whey Protein");
    expect(ranked[1].rank).toBe(2);
    expect(ranked[2].canonicalName).toBe("Casein");
    expect(ranked[2].rank).toBe(3);
  });

  it("assigns trend=up when recentCitations > 10% of total", () => {
    const rows: EntityRow[] = [
      { id: 1, canonicalName: "Leucine", entityType: "protein", totalCitations: 100, recentCitations: 25 },
    ];
    const ranked = rankEntities(rows);
    // 10% of 100 = 10, recent=25 → delta=15 → up
    expect(ranked[0].trend).toBe("up");
    expect(ranked[0].trendDelta).toBe(15);
  });

  it("assigns trend=down when recentCitations < 10% of total", () => {
    const rows: EntityRow[] = [
      { id: 1, canonicalName: "Collagen", entityType: "protein", totalCitations: 200, recentCitations: 5 },
    ];
    const ranked = rankEntities(rows);
    // 10% of 200 = 20, recent=5 → delta=-15 → down
    expect(ranked[0].trend).toBe("down");
    expect(ranked[0].trendDelta).toBe(15);
  });

  it("assigns trend=stable when recentCitations == 10% of total", () => {
    const rows: EntityRow[] = [
      { id: 1, canonicalName: "Glutamine", entityType: "protein", totalCitations: 100, recentCitations: 10 },
    ];
    const ranked = rankEntities(rows);
    expect(ranked[0].trend).toBe("stable");
    expect(ranked[0].trendDelta).toBe(0);
  });

  it("handles empty input", () => {
    expect(rankEntities([])).toEqual([]);
  });

  it("handles single entity", () => {
    const rows: EntityRow[] = [
      { id: 1, canonicalName: "BCAAs", entityType: "concept", totalCitations: 42, recentCitations: 5 },
    ];
    const ranked = rankEntities(rows);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].rank).toBe(1);
  });

  it("preserves all entity fields in output", () => {
    const rows: EntityRow[] = [
      { id: 99, canonicalName: "Taurine", entityType: "ligand", totalCitations: 77, recentCitations: 8 },
    ];
    const ranked = rankEntities(rows);
    expect(ranked[0].id).toBe(99);
    expect(ranked[0].entityType).toBe("ligand");
  });

  it("handles ties by preserving original order", () => {
    const rows: EntityRow[] = [
      { id: 1, canonicalName: "A", entityType: "protein", totalCitations: 100, recentCitations: 10 },
      { id: 2, canonicalName: "B", entityType: "protein", totalCitations: 100, recentCitations: 10 },
    ];
    const ranked = rankEntities(rows);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
    expect(ranked[0].totalCitations).toBe(ranked[1].totalCitations);
  });
});

// ── Pagination helper ──────────────────────────────────────────────────────────

function paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; total: number; pages: number } {
  const total = items.length;
  const pages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, pages };
}

describe("verticalLeaderboard — paginate", () => {
  const items = Array.from({ length: 55 }, (_, i) => i + 1);

  it("returns correct first page", () => {
    const result = paginate(items, 1, 20);
    expect(result.items).toHaveLength(20);
    expect(result.items[0]).toBe(1);
    expect(result.total).toBe(55);
    expect(result.pages).toBe(3);
  });

  it("returns correct last page (partial)", () => {
    const result = paginate(items, 3, 20);
    expect(result.items).toHaveLength(15);
    expect(result.items[0]).toBe(41);
  });

  it("returns empty array for out-of-range page", () => {
    const result = paginate(items, 10, 20);
    expect(result.items).toHaveLength(0);
  });

  it("handles pageSize larger than total", () => {
    const result = paginate(items, 1, 100);
    expect(result.items).toHaveLength(55);
    expect(result.pages).toBe(1);
  });
});
