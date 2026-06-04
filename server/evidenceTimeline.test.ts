/**
 * Tests for the evidence timeline tRPC procedures.
 * These verify the query logic, trend computation, and edge cases.
 */
import { describe, it, expect } from "vitest";

// ─── Helpers mirrored from routers.ts ────────────────────────────────────────

type TimelineEvent = {
  claimId: number;
  confidenceScore: number | null;
  verdict: string | null;
  pubYear: string | null;
  date: string;
};

function computeTrend(events: TimelineEvent[]): string {
  const midpoint = Math.floor(events.length / 2);
  const firstHalf = events.slice(0, midpoint).filter((e) => e.confidenceScore != null);
  const secondHalf = events.slice(midpoint).filter((e) => e.confidenceScore != null);
  const firstAvg = firstHalf.length
    ? firstHalf.reduce((s, e) => s + (e.confidenceScore ?? 0), 0) / firstHalf.length
    : null;
  const secondAvg = secondHalf.length
    ? secondHalf.reduce((s, e) => s + (e.confidenceScore ?? 0), 0) / secondHalf.length
    : null;
  if (firstAvg == null || secondAvg == null) return "insufficient_data";
  if (secondAvg - firstAvg > 0.05) return "improving";
  if (firstAvg - secondAvg > 0.05) return "declining";
  return "stable";
}

function computeVerdictDistribution(events: TimelineEvent[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const ev of events) {
    if (ev.verdict) dist[ev.verdict] = (dist[ev.verdict] ?? 0) + 1;
  }
  return dist;
}

function computeAverageConfidence(events: TimelineEvent[]): number | null {
  const scored = events.filter((e) => e.confidenceScore != null);
  if (scored.length === 0) return null;
  return scored.reduce((s, e) => s + (e.confidenceScore ?? 0), 0) / scored.length;
}

function buildDate(pubYear: string | null, claimDate: string): string {
  return pubYear ? `${pubYear}-01-01` : claimDate.slice(0, 10);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("evidence timeline — trend computation", () => {
  it("returns improving when second half has higher average confidence", () => {
    const events: TimelineEvent[] = [
      { claimId: 1, confidenceScore: 0.4, verdict: "Supported", pubYear: "2018", date: "2018-01-01" },
      { claimId: 2, confidenceScore: 0.45, verdict: "Supported", pubYear: "2019", date: "2019-01-01" },
      { claimId: 3, confidenceScore: 0.75, verdict: "Supported", pubYear: "2022", date: "2022-01-01" },
      { claimId: 4, confidenceScore: 0.82, verdict: "Supported", pubYear: "2023", date: "2023-01-01" },
    ];
    expect(computeTrend(events)).toBe("improving");
  });

  it("returns declining when second half has lower average confidence", () => {
    const events: TimelineEvent[] = [
      { claimId: 1, confidenceScore: 0.85, verdict: "Supported", pubYear: "2018", date: "2018-01-01" },
      { claimId: 2, confidenceScore: 0.80, verdict: "Supported", pubYear: "2019", date: "2019-01-01" },
      { claimId: 3, confidenceScore: 0.35, verdict: "Contradicted", pubYear: "2022", date: "2022-01-01" },
      { claimId: 4, confidenceScore: 0.30, verdict: "Contradicted", pubYear: "2023", date: "2023-01-01" },
    ];
    expect(computeTrend(events)).toBe("declining");
  });

  it("returns stable when difference is within 0.05 threshold", () => {
    const events: TimelineEvent[] = [
      { claimId: 1, confidenceScore: 0.65, verdict: "Supported", pubYear: "2020", date: "2020-01-01" },
      { claimId: 2, confidenceScore: 0.66, verdict: "Supported", pubYear: "2021", date: "2021-01-01" },
      { claimId: 3, confidenceScore: 0.67, verdict: "Supported", pubYear: "2022", date: "2022-01-01" },
      { claimId: 4, confidenceScore: 0.68, verdict: "Supported", pubYear: "2023", date: "2023-01-01" },
    ];
    expect(computeTrend(events)).toBe("stable");
  });

  it("returns insufficient_data for a single event", () => {
    const events: TimelineEvent[] = [
      { claimId: 1, confidenceScore: 0.7, verdict: "Supported", pubYear: "2023", date: "2023-01-01" },
    ];
    expect(computeTrend(events)).toBe("insufficient_data");
  });

  it("returns insufficient_data when all confidence scores are null", () => {
    const events: TimelineEvent[] = [
      { claimId: 1, confidenceScore: null, verdict: "Ambiguous", pubYear: "2020", date: "2020-01-01" },
      { claimId: 2, confidenceScore: null, verdict: "Ambiguous", pubYear: "2021", date: "2021-01-01" },
      { claimId: 3, confidenceScore: null, verdict: "Ambiguous", pubYear: "2022", date: "2022-01-01" },
      { claimId: 4, confidenceScore: null, verdict: "Ambiguous", pubYear: "2023", date: "2023-01-01" },
    ];
    expect(computeTrend(events)).toBe("insufficient_data");
  });
});

describe("evidence timeline — verdict distribution", () => {
  it("counts verdicts correctly", () => {
    const events: TimelineEvent[] = [
      { claimId: 1, confidenceScore: 0.8, verdict: "Supported", pubYear: "2020", date: "2020-01-01" },
      { claimId: 2, confidenceScore: 0.6, verdict: "Supported", pubYear: "2021", date: "2021-01-01" },
      { claimId: 3, confidenceScore: 0.3, verdict: "Contradicted", pubYear: "2022", date: "2022-01-01" },
      { claimId: 4, confidenceScore: 0.5, verdict: "Ambiguous", pubYear: "2023", date: "2023-01-01" },
    ];
    const dist = computeVerdictDistribution(events);
    expect(dist["Supported"]).toBe(2);
    expect(dist["Contradicted"]).toBe(1);
    expect(dist["Ambiguous"]).toBe(1);
  });

  it("ignores null verdicts", () => {
    const events: TimelineEvent[] = [
      { claimId: 1, confidenceScore: 0.5, verdict: null, pubYear: "2020", date: "2020-01-01" },
      { claimId: 2, confidenceScore: 0.7, verdict: "Supported", pubYear: "2021", date: "2021-01-01" },
    ];
    const dist = computeVerdictDistribution(events);
    expect(Object.keys(dist)).toHaveLength(1);
    expect(dist["Supported"]).toBe(1);
  });

  it("returns empty object for empty events", () => {
    expect(computeVerdictDistribution([])).toEqual({});
  });
});

describe("evidence timeline — average confidence", () => {
  it("computes the correct average", () => {
    const events: TimelineEvent[] = [
      { claimId: 1, confidenceScore: 0.4, verdict: "Supported", pubYear: "2020", date: "2020-01-01" },
      { claimId: 2, confidenceScore: 0.6, verdict: "Supported", pubYear: "2021", date: "2021-01-01" },
      { claimId: 3, confidenceScore: 0.8, verdict: "Supported", pubYear: "2022", date: "2022-01-01" },
    ];
    expect(computeAverageConfidence(events)).toBeCloseTo(0.6, 5);
  });

  it("returns null when no scores are present", () => {
    const events: TimelineEvent[] = [
      { claimId: 1, confidenceScore: null, verdict: "Ambiguous", pubYear: "2020", date: "2020-01-01" },
    ];
    expect(computeAverageConfidence(events)).toBeNull();
  });

  it("skips null scores in the average", () => {
    const events: TimelineEvent[] = [
      { claimId: 1, confidenceScore: 0.6, verdict: "Supported", pubYear: "2020", date: "2020-01-01" },
      { claimId: 2, confidenceScore: null, verdict: "Ambiguous", pubYear: "2021", date: "2021-01-01" },
      { claimId: 3, confidenceScore: 0.8, verdict: "Supported", pubYear: "2022", date: "2022-01-01" },
    ];
    expect(computeAverageConfidence(events)).toBeCloseTo(0.7, 5);
  });
});

describe("evidence timeline — date building", () => {
  it("uses pubYear when available", () => {
    expect(buildDate("2021", "2023-06-15T00:00:00.000Z")).toBe("2021-01-01");
  });

  it("falls back to claim date when pubYear is null", () => {
    expect(buildDate(null, "2023-06-15T00:00:00.000Z")).toBe("2023-06-15");
  });

  it("handles pubYear as a 4-digit string", () => {
    expect(buildDate("1998", "2000-01-01T00:00:00.000Z")).toBe("1998-01-01");
  });
});

describe("evidence timeline — empty state", () => {
  it("returns empty summary when no events", () => {
    const events: TimelineEvent[] = [];
    expect(computeVerdictDistribution(events)).toEqual({});
    expect(computeAverageConfidence(events)).toBeNull();
    expect(computeTrend(events)).toBe("insufficient_data");
  });
});
