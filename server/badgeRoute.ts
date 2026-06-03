/**
 * badgeRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers GET /badge/:claimId.svg — returns an SVG verification badge for
 * embedding on external sites.
 *
 * Badge design:
 *   [TD logo] Truth Desk | <verdict> | Claim #<id>
 *
 * Color coding matches the 7-verdict system:
 *   Supported          → emerald (#10b981)
 *   Partially Supported → yellow  (#f59e0b)
 *   Contradicted       → red     (#ef4444)
 *   Ambiguous          → slate   (#64748b)
 *   Insufficient Evidence → slate (#64748b)
 *   Needs Expert Review → orange (#f97316)
 *   Out of Scope       → slate   (#64748b)
 */

import type { Express, Request, Response } from "express";
import { getClaimById } from "./db";

const VERDICT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  Supported: { bg: "#10b981", text: "#ffffff", label: "Supported" },
  "Partially Supported": { bg: "#f59e0b", text: "#ffffff", label: "Partial" },
  Contradicted: { bg: "#ef4444", text: "#ffffff", label: "Contradicted" },
  Ambiguous: { bg: "#64748b", text: "#ffffff", label: "Ambiguous" },
  "Insufficient Evidence": { bg: "#64748b", text: "#ffffff", label: "Insufficient" },
  "Needs Expert Review": { bg: "#f97316", text: "#ffffff", label: "Expert Review" },
  "Out of Scope": { bg: "#64748b", text: "#ffffff", label: "Out of Scope" },
};

const DEFAULT_COLOR = { bg: "#64748b", text: "#ffffff", label: "Unverified" };

function buildBadgeSvg(claimId: number, verdict: string | null, claimText: string | null): string {
  const cfg = VERDICT_COLORS[verdict ?? ""] ?? DEFAULT_COLOR;
  const label = cfg.label;

  // Truncate claim text for the badge tooltip
  const tooltip = (claimText ?? `Claim #${claimId}`).slice(0, 120).replace(/"/g, "&quot;");

  // Measure text widths (approximate monospace)
  const leftLabel = "Truth Desk";
  const leftW = leftLabel.length * 6.5 + 20;
  const rightW = label.length * 6.5 + 20;
  const totalW = leftW + rightW;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${tooltip}">
  <title>${tooltip}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalW}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftW}" height="20" fill="#555"/>
    <rect x="${leftW}" width="${rightW}" height="20" fill="${cfg.bg}"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="${cfg.text}" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${leftW / 2}" y="15" fill="#010101" fill-opacity=".3" aria-hidden="true">${leftLabel}</text>
    <text x="${leftW / 2}" y="14">${leftLabel}</text>
    <text x="${leftW + rightW / 2}" y="15" fill="#010101" fill-opacity=".3" aria-hidden="true">${label}</text>
    <text x="${leftW + rightW / 2}" y="14">${label}</text>
  </g>
</svg>`;
}

export function registerBadgeRoute(app: Express): void {
  app.get("/badge/:claimId.svg", async (req: Request, res: Response) => {
    const claimId = parseInt(req.params.claimId ?? "", 10);

    let verdict: string | null = null;
    let claimText: string | null = null;

    if (!isNaN(claimId)) {
      const claim = await getClaimById(claimId);
      if (claim) {
        verdict = claim.verdict ?? null;
        claimText = claim.claimText ?? null;
      }
    }

    const svg = buildBadgeSvg(isNaN(claimId) ? 0 : claimId, verdict, claimText);

    res
      .set({
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "X-Content-Type-Options": "nosniff",
      })
      .status(200)
      .send(svg);
  });
}
