/**
 * sitemapRoute.ts
 *
 * Serves /sitemap.xml — a dynamic sitemap listing all public audit report
 * pages (/reports/:id) plus static pages, so search engines and AI crawlers
 * discover every published audit automatically.
 */

import type { Express, Request, Response } from "express";
import { getCompletedPublicPapers } from "./db";

const DOMAIN = "https://protein-desk-5r5rzpyg.manus.space";

const STATIC_PAGES = [
  { url: "/", priority: "1.0", changefreq: "weekly" },
  { url: "/registry", priority: "0.9", changefreq: "daily" },
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

export function registerSitemapRoute(app: Express): void {
  app.get("/sitemap.xml", async (_req: Request, res: Response) => {
    try {
      const papers = await getCompletedPublicPapers();

      const staticEntries = STATIC_PAGES.map(
        (p) => `  <url>
    <loc>${DOMAIN}${p.url}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
      ).join("\n");

      const reportEntries = papers
        .filter((p) => p.documentId != null)
        .map((p) => {
          const lastmod = p.updatedAt
            ? new Date(p.updatedAt).toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0];
          return `  <url>
    <loc>${DOMAIN}/reports/${p.documentId}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
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
</urlset>`;

      res
        .set({
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
          "X-Robots-Tag": "noindex",
        })
        .status(200)
        .send(xml);
    } catch (err) {
      console.error("[sitemapRoute] Error generating sitemap:", err);
      res.status(500).send("<?xml version=\"1.0\"?><urlset/>");
    }
  });
}
