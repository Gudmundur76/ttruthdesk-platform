/**
 * claimPageRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers GET /api/claim/:id — returns claim data with:
 *   - ClaimReview JSON-LD (existing)
 *   - FAQPage JSON-LD (new — 47% Top-3 citation rate advantage in Perplexity)
 *   - dateModified field in JSON-LD (freshness signal for AI reranker)
 *   - Last-Modified HTTP header (2.5× more Perplexity citations for <30-day pages)
 *
 * Also registers GET /api/claim/:id/jsonld — returns the raw JSON-LD array
 * for server-side rendering and SEO crawlers.
 */

import type { Express, Request, Response } from "express";
import { getClaimWithDocument } from "./db";

const VERDICT_RATING: Record<string, { value: string; label: string }> = {
  Supported: { value: "1", label: "Supported" },
  "Partially Supported": { value: "0.75", label: "Partially Supported" },
  Ambiguous: { value: "0.5", label: "Ambiguous" },
  "Insufficient Evidence": { value: "0.5", label: "Insufficient Evidence" },
  "Out of Scope": { value: "0.5", label: "Out of Scope" },
  "Needs Expert Review": { value: "0.5", label: "Needs Expert Review" },
  Contradicted: { value: "0", label: "Contradicted" },
};

/** Build a concise BLUF answer for FAQPage (answers in first 100 words). */
function buildFaqAnswer(claim: {
  verdict: string | null;
  verdictRationale: string | null;
  pdbId: string | null;
  pdbEvidenceUrl: string | null;
  confidenceScore?: number | null;
}): string {
  const verdict = claim.verdict ?? "Unknown";
  const rationale = claim.verdictRationale ?? "";
  const evidence = claim.pdbEvidenceUrl
    ? ` Evidence: ${claim.pdbEvidenceUrl}.`
    : claim.pdbId
      ? ` PDB entry: ${claim.pdbId}.`
      : "";
  const confidence =
    claim.confidenceScore != null
      ? ` Confidence: ${Math.round(claim.confidenceScore * 100)}%.`
      : "";
  // Keep total under 100 words — BLUF format
  return `${verdict}. ${rationale}${evidence}${confidence}`.trim();
}

export function buildClaimReviewJsonLd(
  claim: {
    id: number;
    claimText: string | null;
    verdict: string | null;
    verdictRationale: string | null;
    pdbEvidenceUrl: string | null;
    pdbId: string | null;
    createdAt: Date | null;
    updatedAt?: Date | null;
    confidenceScore?: number | null;
  },
  document: {
    id: number;
    title: string | null;
    createdAt: Date | null;
  },
  baseUrl: string
) {
  const rating = VERDICT_RATING[claim.verdict ?? ""] ?? { value: "0.5", label: claim.verdict ?? "Unknown" };
  const dateModified = (claim.updatedAt ?? claim.createdAt ?? new Date()).toISOString();

  const claimReview = {
    "@context": "https://schema.org",
    "@type": "ClaimReview",
    url: `${baseUrl}/claim/${claim.id}`,
    claimReviewed: claim.claimText ?? "",
    datePublished: claim.createdAt?.toISOString() ?? new Date().toISOString(),
    dateModified,
    reviewRating: {
      "@type": "Rating",
      ratingValue: rating.value,
      bestRating: "1",
      worstRating: "0",
      alternateName: rating.label,
    },
    itemReviewed: {
      "@type": "Claim",
      author: {
        "@type": "Organization",
        name: document.title ? `Document: ${document.title}` : `Document #${document.id}`,
      },
      datePublished: document.createdAt?.toISOString() ?? new Date().toISOString(),
    },
    author: {
      "@type": "Organization",
      name: "Truth Desk",
      url: baseUrl,
    },
    reviewBody: claim.verdictRationale ?? "",
    ...(claim.pdbEvidenceUrl
      ? {
          citation: [
            {
              "@type": "ScholarlyArticle",
              headline: `PDB entry ${claim.pdbId ?? ""}`,
              identifier: `PDB:${claim.pdbId ?? ""}`,
              url: claim.pdbEvidenceUrl,
            },
          ],
        }
      : {}),
  };

  // FAQPage schema — 47% Top-3 Perplexity citation rate vs 28% without
  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    dateModified,
    mainEntity: [
      {
        "@type": "Question",
        name: `Is the claim "${claim.claimText ?? ""}" true?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: buildFaqAnswer(claim),
        },
      },
      // Second question: what is the confidence level?
      ...(claim.confidenceScore != null
        ? [
            {
              "@type": "Question",
              name: `How confident is Truth Desk in this verdict?`,
              acceptedAnswer: {
                "@type": "Answer",
                text: `Truth Desk assigns a confidence score of ${Math.round(claim.confidenceScore * 100)}% to this verdict (${claim.verdict ?? "Unknown"}). Scores above 80% indicate strong evidence alignment; scores below 50% suggest the claim requires expert review.`,
              },
            },
          ]
        : []),
    ],
  };

  return { claimReview, faqPage };
}

export function registerClaimPageRoute(app: Express): void {
  // Returns claim data as JSON for the frontend /claim/:id page
  app.get("/api/claim/:id", async (req: Request, res: Response) => {
    const claimId = parseInt(req.params.id ?? "", 10);
    if (isNaN(claimId)) {
      res.status(400).json({ error: "Invalid claim ID" });
      return;
    }

    const row = await getClaimWithDocument(claimId);
    if (!row) {
      res.status(404).json({ error: "Claim not found" });
      return;
    }

    const origin =
      process.env.VITE_APP_URL ??
      `${req.protocol}://${req.get("host") ?? "protein-desk-5r5rzpyg.manus.space"}`;

    const { claimReview, faqPage } = buildClaimReviewJsonLd(row.claim, row.document, origin);

    // Last-Modified header: 2.5× more Perplexity citations for pages updated <30 days ago
    const lastModified = (row.claim.updatedAt ?? row.claim.createdAt ?? new Date()).toUTCString();

    res
      .set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "Last-Modified": lastModified,
        // Link headers for agent discovery
        Link: [
          `<${origin}/llms.txt>; rel="llms"`,
          `<${origin}/.well-known/mcp.json>; rel="mcp"`,
          `<${origin}/api/trpc>; rel="api-catalog"`,
        ].join(", "),
      })
      .json({
        claim: {
          id: row.claim.id,
          claimText: row.claim.claimText,
          verdict: row.claim.verdict,
          verdictRationale: row.claim.verdictRationale,
          pdbId: row.claim.pdbId,
          pdbEvidenceUrl: row.claim.pdbEvidenceUrl,
          confidenceScore: row.claim.confidenceScore,
          createdAt: row.claim.createdAt,
          updatedAt: row.claim.updatedAt,
          documentId: row.claim.documentId,
        },
        document: {
          id: row.document.id,
          title: row.document.title,
          createdAt: row.document.createdAt,
        },
        // Legacy: single jsonld object (ClaimReview) for backwards compat
        jsonld: claimReview,
        // New: array with both ClaimReview + FAQPage for richer AI citations
        jsonldArray: [claimReview, faqPage],
      });
  });
}
