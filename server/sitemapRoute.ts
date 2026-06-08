/**
 * sitemapRoute.ts
 *
 * Serves /sitemap.xml — a dynamic sitemap listing:
 *   - Static pages (/, /registry, /pricing, /submit, /graph, /verticals)
 *   - Public audit report pages (/reports/:id) with lastmod
 *   - Verified claim pages (/claim/:id) with lastmod
 *   - Wiki entity pages (/wiki/:type/:slug) with lastmod
 *
 * All dynamic entries include <lastmod> from DB timestamps, which is the
 * strongest freshness signal for Bing/Perplexity re-indexing priority.
 */

import type { Express, Request, Response } from "express";
import { getCompletedPublicPapers, getAllGraphEntities, getVerifiedClaimsForSitemap } from "./db";
import { slugify } from "./wikiCompiler";

/** Resolve the canonical domain from the incoming request (supports custom domains). */
function getDomain(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] ?? req.protocol ?? "https") as string;
  const host = (req.headers["x-forwarded-host"] ?? req.headers.host ?? "truthdesk.claims") as string;
  return `${proto}://${host}`;
}

const STATIC_PAGES = [
  { url: "/", priority: "1.0", changefreq: "weekly" },
  { url: "/registry", priority: "0.9", changefreq: "daily" },
  { url: "/graph", priority: "0.8", changefreq: "daily" },
  { url: "/verticals", priority: "0.7", changefreq: "weekly" },
  { url: "/pricing", priority: "0.7", changefreq: "monthly" },
  { url: "/submit", priority: "0.6", changefreq: "monthly" },
];

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toLastmod(date: Date | null | undefined): string {
  return (date ?? new Date()).toISOString().split("T")[0]!;
}

export function registerSitemapRoute(app: Express): void {
  app.get("/sitemap.xml", async (req: Request, res: Response) => {
    const DOMAIN = getDomain(req);
    try {
      const [papers, entities, claimRows] = await Promise.all([
        getCompletedPublicPapers(),
        getAllGraphEntities(2000),
        getVerifiedClaimsForSitemap(5000),
      ]);

      // Static pages (no lastmod — they rarely change)
      const staticEntries = STATIC_PAGES.map(
        (p) => `  <url>
    <loc>${DOMAIN}${p.url}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
      ).join("\n");

      // Report pages
      const reportEntries = papers
        .filter((p) => p.documentId != null)
        .map((p) => {
          const lastmod = toLastmod(p.updatedAt ? new Date(p.updatedAt) : null);
          return `  <url>
    <loc>${DOMAIN}/reports/${p.documentId}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
        })
        .join("\n");

      // Claim pages — highest value for Perplexity citations
      const claimEntries = claimRows
        .map((c) => {
          const lastmod = toLastmod(c.updatedAt ?? c.createdAt);
          return `  <url>
    <loc>${DOMAIN}/claim/${c.id}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`;
        })
        .join("\n");

      // Wiki entity pages — only include entities that have a wiki page
      const wikiEntries = entities
        .filter((e) => e.wikiPagePath != null)
        .map((e) => {
          const lastmod = toLastmod(e.updatedAt ?? e.createdAt);
          const slug = escapeXml(slugify(e.canonicalName));
          return `  <url>
    <loc>${DOMAIN}/wiki/${e.entityType}/${slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
        })
        .join("\n");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${staticEntries}
${reportEntries}
${claimEntries}
${wikiEntries}
</urlset>`;

      res
        .set({
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
        })
        .status(200)
        .send(xml);
    } catch (err) {
      console.error("[sitemapRoute] Error generating sitemap:", err);
      res.status(500).send("<?xml version=\"1.0\"?><urlset/>");
    }
  });
}
