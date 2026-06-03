/**
 * claimPageRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers GET /api/claim/:id — returns claim data with ClaimReview JSON-LD
 * for the public /claim/:id frontend page.
 *
 * Also registers GET /api/claim/:id/jsonld — returns the raw JSON-LD object
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

export function buildClaimReviewJsonLd(
  claim: {
    id: number;
    claimText: string | null;
    verdict: string | null;
    verdictRationale: string | null;
    pdbEvidenceUrl: string | null;
    pdbId: string | null;
    createdAt: Date | null;
  },
  document: {
    id: number;
    title: string | null;
    createdAt: Date | null;
  },
  baseUrl: string
) {
  const rating = VERDICT_RATING[claim.verdict ?? ""] ?? { value: "0.5", label: claim.verdict ?? "Unknown" };

  return {
    "@context": "https://schema.org",
    "@type": "ClaimReview",
    url: `${baseUrl}/claim/${claim.id}`,
    claimReviewed: claim.claimText ?? "",
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
    datePublished: claim.createdAt?.toISOString() ?? new Date().toISOString(),
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

    const jsonld = buildClaimReviewJsonLd(row.claim, row.document, origin);

    res
      .set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
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
          createdAt: row.claim.createdAt,
          documentId: row.claim.documentId,
        },
        document: {
          id: row.document.id,
          title: row.document.title,
          createdAt: row.document.createdAt,
        },
        jsonld,
      });
  });
}
