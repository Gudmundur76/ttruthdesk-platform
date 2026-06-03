/**
 * wikiPageRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers GET /api/wiki/:entityType/:entitySlug — returns wiki page content
 * with Link headers for agent discovery (llms.txt, mcp.json, api-catalog).
 *
 * Also adds Link headers to the existing wiki tRPC procedure responses via
 * Express middleware on /api/trpc/wiki.* paths.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { fetchWikiPage, slugify } from "./wikiCompiler";
import { getGraphEntityByTypeAndName } from "./db";

export function registerWikiPageRoute(app: Express): void {
  // Middleware: add Link headers to all /api/trpc/wiki.* and /api/wiki/* responses
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    if (
      path.startsWith("/api/trpc/wiki") ||
      path.startsWith("/api/wiki") ||
      path.startsWith("/api/claim") ||
      path === "/llms.txt"
    ) {
      const origin =
        process.env.VITE_APP_URL ??
        `${req.protocol}://${req.get("host") ?? "protein-desk-5r5rzpyg.manus.space"}`;

      res.setHeader(
        "Link",
        [
          `<${origin}/llms.txt>; rel="llms"`,
          `<${origin}/.well-known/mcp.json>; rel="mcp"`,
          `<${origin}/api/trpc>; rel="api-catalog"`,
        ].join(", ")
      );
    }
    next();
  });

  // Direct wiki page API endpoint (returns markdown + entity metadata)
  app.get("/api/wiki/:entityType/:entitySlug", async (req: Request, res: Response) => {
    const { entityType, entitySlug } = req.params as {
      entityType: string;
      entitySlug: string;
    };

    if (!entityType || !entitySlug) {
      res.status(400).json({ error: "entityType and entitySlug are required" });
      return;
    }

    const origin =
      process.env.VITE_APP_URL ??
      `${req.protocol}://${req.get("host") ?? "protein-desk-5r5rzpyg.manus.space"}`;

    // Decode slug back to canonical name (underscores → spaces)
    const canonicalName = decodeURIComponent(entitySlug).replace(/_/g, " ");

    // Look up entity in DB
    const validEntityType = entityType as
      | "protein"
      | "pdb_id"
      | "method"
      | "organism"
      | "ligand"
      | "author"
      | "concept"
      | "document";
    const entity = await getGraphEntityByTypeAndName(validEntityType, canonicalName);

    // Fetch wiki markdown from S3 using the wikiKey format
    const s3Key = `wiki/${entityType}_${slugify(canonicalName)}.md`;
    const markdown = await fetchWikiPage(s3Key);

    const jsonld = {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `Truth Desk Verification: ${entityType} ${canonicalName}`,
      description: `Autonomous evidence audit of claims about ${entityType} ${canonicalName}.`,
      url: `${origin}/wiki/${entityType}/${entitySlug}`,
      dateModified: entity?.updatedAt?.toISOString() ?? new Date().toISOString(),
      creator: {
        "@type": "Organization",
        name: "Truth Desk",
        url: origin,
      },
      license: "https://creativecommons.org/licenses/by/4.0/",
    };

    const lastModified = (entity?.updatedAt ?? new Date()).toUTCString();

    res
      .set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "Last-Modified": lastModified,
        Link: [
          `<${origin}/llms.txt>; rel="llms"`,
          `<${origin}/.well-known/mcp.json>; rel="mcp"`,
          `<${origin}/api/trpc>; rel="api-catalog"`,
        ].join(", "),
      })
      .json({
        entityType,
        canonicalName,
        slug: slugify(canonicalName),
        entity: entity ?? null,
        markdown: markdown ?? null,
        jsonld,
      });
  });
}
