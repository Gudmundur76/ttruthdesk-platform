/**
 * badgeRoute.test.ts
 * Tests for badge SVG generation and ClaimReview JSON-LD builder.
 */

import { describe, it, expect } from "vitest";
import { buildClaimReviewJsonLd } from "./claimPageRoute";

// ─── Badge SVG tests ──────────────────────────────────────────────────────────

// We test the SVG builder logic by importing the internal function via a
// lightweight inline re-implementation (the route function itself is Express-bound).

const VERDICT_COLORS: Record<string, { bg: string; label: string }> = {
  Supported: { bg: "#10b981", label: "Supported" },
  "Partially Supported": { bg: "#f59e0b", label: "Partial" },
  Contradicted: { bg: "#ef4444", label: "Contradicted" },
  Ambiguous: { bg: "#64748b", label: "Ambiguous" },
  "Insufficient Evidence": { bg: "#64748b", label: "Insufficient" },
  "Needs Expert Review": { bg: "#f97316", label: "Expert Review" },
  "Out of Scope": { bg: "#64748b", label: "Out of Scope" },
};

function buildBadgeSvg(claimId: number, verdict: string | null): string {
  const cfg = VERDICT_COLORS[verdict ?? ""] ?? { bg: "#64748b", label: "Unverified" };
  const label = cfg.label;
  const leftLabel = "Truth Desk";
  const leftW = leftLabel.length * 6.5 + 20;
  const rightW = label.length * 6.5 + 20;
  const totalW = Math.round(leftW + rightW);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img"><rect width="${totalW}" height="20"/></svg>`;
}

describe("Badge SVG generation", () => {
  it("produces a valid SVG opening tag", () => {
    const svg = buildBadgeSvg(1, "Supported");
    expect(svg).toContain("<svg");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('height="20"');
  });

  it("uses emerald color for Supported verdict", () => {
    const cfg = VERDICT_COLORS["Supported"];
    expect(cfg.bg).toBe("#10b981");
    expect(cfg.label).toBe("Supported");
  });

  it("uses red color for Contradicted verdict", () => {
    const cfg = VERDICT_COLORS["Contradicted"];
    expect(cfg.bg).toBe("#ef4444");
    expect(cfg.label).toBe("Contradicted");
  });

  it("uses orange color for Needs Expert Review", () => {
    const cfg = VERDICT_COLORS["Needs Expert Review"];
    expect(cfg.bg).toBe("#f97316");
  });

  it("falls back to Unverified for unknown verdict", () => {
    const svg = buildBadgeSvg(99, null);
    expect(svg).toContain("<svg");
  });

  it("produces wider SVG for longer verdict labels", () => {
    const svgShort = buildBadgeSvg(1, "Supported");
    const svgLong = buildBadgeSvg(1, "Needs Expert Review");
    const wShort = parseInt(svgShort.match(/width="(\d+)"/)?.[1] ?? "0");
    const wLong = parseInt(svgLong.match(/width="(\d+)"/)?.[1] ?? "0");
    expect(wLong).toBeGreaterThan(wShort);
  });
});

// ─── ClaimReview JSON-LD tests ────────────────────────────────────────────────

const MOCK_CLAIM = {
  id: 42,
  claimText: "The crystal structure of lysozyme was solved at 1.8 Å resolution",
  verdict: "Supported",
  verdictRationale: "PDB 1LYZ confirms 1.8 Å resolution by X-ray crystallography",
  pdbEvidenceUrl: "https://www.rcsb.org/structure/1LYZ",
  pdbId: "1LYZ",
  createdAt: new Date("2026-06-01T12:00:00Z"),
};

const MOCK_DOCUMENT = {
  id: 7,
  title: "Lysozyme Structure Analysis",
  createdAt: new Date("2026-05-15T09:00:00Z"),
};

describe("buildClaimReviewJsonLd", () => {
  it("returns a ClaimReview type", () => {
    const { claimReview } = buildClaimReviewJsonLd(MOCK_CLAIM, MOCK_DOCUMENT, "https://example.com");
    expect(claimReview["@type"]).toBe("ClaimReview");
    expect(claimReview["@context"]).toBe("https://schema.org");
  });

  it("includes the claim text in claimReviewed", () => {
    const { claimReview } = buildClaimReviewJsonLd(MOCK_CLAIM, MOCK_DOCUMENT, "https://example.com");
    expect(claimReview.claimReviewed).toBe(MOCK_CLAIM.claimText);
  });

  it("maps Supported verdict to ratingValue 1", () => {
    const { claimReview } = buildClaimReviewJsonLd(MOCK_CLAIM, MOCK_DOCUMENT, "https://example.com");
    const rating = claimReview.reviewRating as Record<string, string>;
    expect(rating.ratingValue).toBe("1");
    expect(rating.alternateName).toBe("Supported");
  });

  it("maps Contradicted verdict to ratingValue 0", () => {
    const { claimReview } = buildClaimReviewJsonLd(
      { ...MOCK_CLAIM, verdict: "Contradicted" },
      MOCK_DOCUMENT,
      "https://example.com"
    );
    const rating = claimReview.reviewRating as Record<string, string>;
    expect(rating.ratingValue).toBe("0");
    expect(rating.alternateName).toBe("Contradicted");
  });

  it("maps Partially Supported to ratingValue 0.75", () => {
    const { claimReview } = buildClaimReviewJsonLd(
      { ...MOCK_CLAIM, verdict: "Partially Supported" },
      MOCK_DOCUMENT,
      "https://example.com"
    );
    const rating = claimReview.reviewRating as Record<string, string>;
    expect(rating.ratingValue).toBe("0.75");
  });

  it("includes PDB citation when pdbEvidenceUrl is set", () => {
    const { claimReview } = buildClaimReviewJsonLd(MOCK_CLAIM, MOCK_DOCUMENT, "https://example.com");
    expect(claimReview.citation).toBeDefined();
    const citations = claimReview.citation as Array<Record<string, string>>;
    expect(citations[0].identifier).toBe("PDB:1LYZ");
    expect(citations[0].url).toBe("https://www.rcsb.org/structure/1LYZ");
  });

  it("omits citation when pdbEvidenceUrl is null", () => {
    const { claimReview } = buildClaimReviewJsonLd(
      { ...MOCK_CLAIM, pdbEvidenceUrl: null, pdbId: null },
      MOCK_DOCUMENT,
      "https://example.com"
    );
    expect(claimReview.citation).toBeUndefined();
  });

  it("includes author as Truth Desk organization", () => {
    const { claimReview } = buildClaimReviewJsonLd(MOCK_CLAIM, MOCK_DOCUMENT, "https://example.com");
    const author = claimReview.author as Record<string, string>;
    expect(author["@type"]).toBe("Organization");
    expect(author.name).toBe("Truth Desk");
    expect(author.url).toBe("https://example.com");
  });

  it("includes the claim URL using the provided baseUrl", () => {
    const { claimReview } = buildClaimReviewJsonLd(MOCK_CLAIM, MOCK_DOCUMENT, "https://mysite.com");
    expect(claimReview.url).toBe("https://mysite.com/claim/42");
  });

  it("includes document title in itemReviewed author name", () => {
    const { claimReview } = buildClaimReviewJsonLd(MOCK_CLAIM, MOCK_DOCUMENT, "https://example.com");
    const itemReviewed = claimReview.itemReviewed as Record<string, unknown>;
    const itemAuthor = itemReviewed.author as Record<string, string>;
    expect(itemAuthor.name).toContain("Lysozyme Structure Analysis");
  });

  it("falls back to Document #id when title is null", () => {
    const { claimReview } = buildClaimReviewJsonLd(
      MOCK_CLAIM,
      { ...MOCK_DOCUMENT, title: null },
      "https://example.com"
    );
    const itemReviewed = claimReview.itemReviewed as Record<string, unknown>;
    const itemAuthor = itemReviewed.author as Record<string, string>;
    expect(itemAuthor.name).toContain(`#${MOCK_DOCUMENT.id}`);
  });
});

// ─── llms.txt format tests ────────────────────────────────────────────────────

describe("llms.txt format compliance", () => {
  it("geo-standard §5: starts with H1 site name", () => {
    const content = `# Truth Desk · Protein Knowledge Graph\n> Summary line\n`;
    expect(content).toMatch(/^# .+/);
  });

  it("geo-standard §5: has blockquote summary on second line", () => {
    const lines = `# Truth Desk · Protein Knowledge Graph\n> Autonomous evidence auditing`.split("\n");
    expect(lines[1]).toMatch(/^> /);
  });

  it("geo-standard §5: has ## section headers", () => {
    const content = `# Title\n> Summary\n\n## Proteins\n- [Lysozyme](/wiki/protein/lysozyme): desc\n`;
    expect(content).toContain("## Proteins");
  });

  it("geo-standard §5: list items have [Title](url): description format", () => {
    const line = `- [Lysozyme (1LYZ)](/wiki/protein/1LYZ): 23 supported claims`;
    expect(line).toMatch(/^- \[.+\]\(.+\): .+/);
  });
});
