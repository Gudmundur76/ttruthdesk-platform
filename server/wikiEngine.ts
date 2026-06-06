/**
 * wikiEngine.ts
 *
 * Implements the LLM Wiki pattern (Karpathy, 2026) as the internal knowledge
 * layer for Truth Desk.  The LLM writes and maintains all wiki pages; humans
 * read them.
 *
 * Three layers:
 *   Raw sources   → documents table (immutable after ingest)
 *   Wiki          → wiki_pages table (LLM-owned markdown)
 *   Schema/config → this file + WIKI_SCHEMA constant
 *
 * Operations:
 *   ingestSourceToWiki()  — compile a processed document into wiki pages
 *   updateEntityPage()    — upsert a single entity/concept page
 *   lintWiki()            — health-check: contradictions, orphans, stale claims
 *   buildIndex()          — rebuild the wiki_index catalog
 *   appendLog()           — append an entry to wiki_log
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { wikiPages, wikiLog, wikiIndex } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import type { WikiPage, WikiIndex as WikiIndexRow } from "../drizzle/schema";
import type { Claim, Document } from "../drizzle/schema";

// ─── Wiki Schema (CLAUDE.md equivalent) ──────────────────────────────────────

const WIKI_SCHEMA = `
# Truth Desk Wiki — Schema & Conventions

## Page categories
- entity        : A specific protein, compound, organism, study, or named object
- concept       : A scientific concept, method, or domain (e.g. "X-ray crystallography")
- synthesis     : A cross-cutting analysis, comparison, or derived insight
- source_summary: A summary of a single source document

## Slug conventions
- entity pages   : entity-{kebab-case-name}  (e.g. entity-human-lysozyme)
- concept pages  : concept-{kebab-case-name} (e.g. concept-x-ray-crystallography)
- synthesis pages: synthesis-{kebab-case-name}
- source summaries: source-{document-id}

## Page format
Each page is a markdown document with:
1. A # Title heading
2. A brief one-paragraph summary
3. Sections relevant to the category (e.g. ## Structure, ## Evidence, ## Claims)
4. ## Sources section listing contributing document titles
5. ## Related Pages section with [[wiki-link]] style cross-references

## Cross-reference style
Use [[slug|Display Name]] for intra-wiki links.
Example: [[entity-human-lysozyme|Human Lysozyme]]

## Evidence quality markers
- ✅ Supported   : claim verified against authoritative database
- ❌ Contradicted: claim contradicted by authoritative database
- ⚠️ Insufficient: insufficient evidence to verify
- 🔬 Structural  : verified via protein structure database (PDB/UniProt)
- 📊 Clinical    : verified via clinical trial registry or systematic review
- 🧪 Chemical    : verified via chemical compound database (PubChem)

## Update rules
- When ingesting a new source, UPDATE existing pages rather than creating duplicates
- Note contradictions explicitly with a ## Contradictions section
- Increment sourceCount on every update
- Maintain outboundLinks as a list of all [[slug]] references in the content
`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WikiIngestResult {
  pagesCreated: number;
  pagesUpdated: number;
  slugs: string[];
  logId: number;
}

export interface WikiLintResult {
  contradictions: string[];
  orphanSlugs: string[];
  stalePageSlugs: string[];
  missingCrossRefs: string[];
  summary: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractOutboundLinks(content: string): string[] {
  const matches = Array.from(content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g));
  return Array.from(new Set(matches.map((m) => m[1].trim())));
}

function extractLLMText(content: string | unknown[]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const first = content[0] as { type?: string; text?: string };
    if (first?.type === "text" && typeof first.text === "string") return first.text;
  }
  return "";
}

// ─── appendLog ────────────────────────────────────────────────────────────────

export async function appendLog(
  action: "ingest" | "lint" | "query" | "update",
  summary: string,
  pagesAffected: number,
  slug?: string,
  documentId?: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.insert(wikiLog).values({
    action,
    summary,
    pagesAffected,
    slug: slug ?? null,
    documentId: documentId ?? null,
  });
  return (result as { insertId: number }).insertId;
}

// ─── updateEntityPage ─────────────────────────────────────────────────────────

export async function updateEntityPage(
  slug: string,
  title: string,
  category: "entity" | "concept" | "synthesis" | "source_summary",
  newContent: string,
  verticalDomain: string,
  avgConfidence?: number
): Promise<"created" | "updated"> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const existing = await db
    .select()
    .from(wikiPages)
    .where(eq(wikiPages.slug, slug))
    .limit(1);

  const outboundLinks = extractOutboundLinks(newContent);

  if (existing.length === 0) {
    await db.insert(wikiPages).values({
      slug,
      title,
      category,
      content: newContent,
      sourceCount: 1,
      inboundLinks: [],
      outboundLinks,
      avgConfidence: avgConfidence ?? 0,
      verticalDomain,
      lastCompiledAt: new Date(),
    });

    // Update inbound links on referenced pages
    for (const targetSlug of outboundLinks) {
      await db
        .update(wikiPages)
        .set({
          inboundLinks: sql`JSON_ARRAY_APPEND(COALESCE(inboundLinks, JSON_ARRAY()), '$', ${slug})`,
        })
        .where(eq(wikiPages.slug, targetSlug));
    }

    return "created";
  } else {
    const prev = existing[0] as WikiPage;
    const prevOutbound = (prev.outboundLinks as string[]) ?? [];

    // Remove stale inbound links from pages no longer referenced
    const removed = prevOutbound.filter((s) => !outboundLinks.includes(s));
    for (const targetSlug of removed) {
      const target = await db
        .select()
        .from(wikiPages)
        .where(eq(wikiPages.slug, targetSlug))
        .limit(1);
      if (target.length > 0) {
        const updated = ((target[0] as WikiPage).inboundLinks as string[] ?? []).filter(
          (s) => s !== slug
        );
        await db
          .update(wikiPages)
          .set({ inboundLinks: updated })
          .where(eq(wikiPages.slug, targetSlug));
      }
    }

    // Add new inbound links
    const added = outboundLinks.filter((s) => !prevOutbound.includes(s));
    for (const targetSlug of added) {
      await db
        .update(wikiPages)
        .set({
          inboundLinks: sql`JSON_ARRAY_APPEND(COALESCE(inboundLinks, JSON_ARRAY()), '$', ${slug})`,
        })
        .where(eq(wikiPages.slug, targetSlug));
    }

    await db
      .update(wikiPages)
      .set({
        title,
        content: newContent,
        outboundLinks,
        sourceCount: (prev.sourceCount ?? 0) + 1,
        avgConfidence: avgConfidence ?? prev.avgConfidence ?? 0,
        verticalDomain,
        lastCompiledAt: new Date(),
      })
      .where(eq(wikiPages.slug, slug));

    return "updated";
  }
}

// ─── ingestSourceToWiki ───────────────────────────────────────────────────────

export async function ingestSourceToWiki(
  document: Document,
  claims: Claim[]
): Promise<WikiIngestResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  if (claims.length === 0) {
    const logId = await appendLog(
      "ingest",
      `Skipped document "${document.title}" — no claims to compile`,
      0,
      undefined,
      document.id
    );
    return { pagesCreated: 0, pagesUpdated: 0, slugs: [], logId };
  }

  // Build a structured summary of claims for the LLM
  const claimSummary = claims
    .slice(0, 50)
    .map(
      (c, i) =>
        `${i + 1}. [${c.verdict ?? "unverified"}] (confidence: ${((c.confidenceScore ?? 0) * 100).toFixed(0)}%) ${c.claimText}`
    )
    .join("\n");

  const existingIndex = await db
    .select({ slug: wikiPages.slug, title: wikiPages.title })
    .from(wikiPages)
    .limit(200);

  const existingPageList = existingIndex
    .map((p: { slug: string; title: string }) => `- [[${p.slug}|${p.title}]]`)
    .join("\n");

  // Ask the LLM to identify which pages to create/update
  const planResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a wiki maintenance agent for Truth Desk, a scientific claim verification platform.\n${WIKI_SCHEMA}\n\nYour task: given a processed document and its verified claims, identify which wiki pages should be created or updated.\n\nRespond with a JSON object:\n{\n  "pages": [\n    {\n      "slug": "entity-human-lysozyme",\n      "title": "Human Lysozyme",\n      "category": "entity",\n      "reason": "New entity mentioned in 3 claims"\n    }\n  ]\n}\n\nOnly include pages that are genuinely warranted by the claims. Maximum 10 pages per document.`,
      },
      {
        role: "user",
        content: `Document: "${document.title}"\nVertical domain: ${document.verticalDomain}\nNumber of claims: ${claims.length}\n\nVerified claims:\n${claimSummary}\n\nExisting wiki pages (for cross-reference):\n${existingPageList || "(wiki is empty)"}\n\nWhich pages should be created or updated?`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "wiki_page_plan",
        strict: true,
        schema: {
          type: "object",
          properties: {
            pages: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  slug: { type: "string" },
                  title: { type: "string" },
                  category: {
                    type: "string",
                    enum: ["entity", "concept", "synthesis", "source_summary"],
                  },
                  reason: { type: "string" },
                },
                required: ["slug", "title", "category", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: ["pages"],
          additionalProperties: false,
        },
      },
    },
  });

  type PagePlanItem = {
    slug: string;
    title: string;
    category: "entity" | "concept" | "synthesis" | "source_summary";
    reason: string;
  };

  let pagePlan: PagePlanItem[] = [];

  try {
    const raw = extractLLMText(planResponse.choices[0]?.message?.content ?? "{}");
    const parsed = JSON.parse(raw) as { pages: PagePlanItem[] };
    pagePlan = parsed.pages ?? [];
  } catch {
    pagePlan = [];
  }

  // Always add a source_summary page for the document itself
  const sourceSummarySlug = `source-${document.id}`;
  if (!pagePlan.find((p) => p.slug === sourceSummarySlug)) {
    pagePlan.push({
      slug: sourceSummarySlug,
      title: `Source: ${document.title}`,
      category: "source_summary",
      reason: "Source summary page for every processed document",
    });
  }

  const slugs: string[] = [];
  let pagesCreated = 0;
  let pagesUpdated = 0;

  // Write each page
  for (const page of pagePlan) {
    const relevantClaims = claims
      .filter(
        (c) =>
          c.claimText.toLowerCase().includes(page.title.toLowerCase()) ||
          page.category === "source_summary"
      )
      .slice(0, 20);

    const relevantClaimText = relevantClaims
      .map(
        (c) =>
          `- [${c.verdict ?? "unverified"}] ${c.claimText} (confidence: ${((c.confidenceScore ?? 0) * 100).toFixed(0)}%)`
      )
      .join("\n");

    const contentResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a wiki page writer for Truth Desk.\n${WIKI_SCHEMA}\n\nWrite a complete, well-structured markdown wiki page. Use [[slug|Title]] for cross-references.\nBe factual and precise. Only state what is supported by the claims provided.\nInclude evidence quality markers (✅ ❌ ⚠️) next to each claim.`,
        },
        {
          role: "user",
          content: `Write a wiki page for: "${page.title}"\nCategory: ${page.category}\nVertical domain: ${document.verticalDomain}\nSource document: "${document.title}"\n\nRelevant verified claims:\n${relevantClaimText || "(no directly relevant claims — write a brief stub)"}\n\nExisting wiki pages for cross-reference:\n${existingPageList || "(wiki is empty)"}`,
        },
      ],
    });

    const content = extractLLMText(
      contentResponse.choices[0]?.message?.content ?? `# ${page.title}\n\n*No content generated.*`
    ) || `# ${page.title}\n\n*No content generated.*`;

    // Compute average confidence for claims on this page
    const avgConf =
      relevantClaims.length > 0
        ? relevantClaims.reduce((sum, c) => sum + (c.confidenceScore ?? 0), 0) /
          relevantClaims.length
        : 0;

    const result = await updateEntityPage(
      page.slug,
      page.title,
      page.category,
      content,
      document.verticalDomain,
      avgConf
    );

    slugs.push(page.slug);
    if (result === "created") pagesCreated++;
    else pagesUpdated++;
  }

  // Rebuild index after ingest
  await buildIndex();

  const logId = await appendLog(
    "ingest",
    `Ingested "${document.title}" → ${pagesCreated} pages created, ${pagesUpdated} pages updated`,
    pagesCreated + pagesUpdated,
    undefined,
    document.id
  );

  return { pagesCreated, pagesUpdated, slugs, logId };
}

// ─── buildIndex ───────────────────────────────────────────────────────────────

export async function buildIndex(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const pages = await db
    .select({
      slug: wikiPages.slug,
      title: wikiPages.title,
      category: wikiPages.category,
      sourceCount: wikiPages.sourceCount,
      avgConfidence: wikiPages.avgConfidence,
      updatedAt: wikiPages.updatedAt,
    })
    .from(wikiPages)
    .orderBy(wikiPages.category, wikiPages.title);

  type PageRow = (typeof pages)[number];

  const byCategory: Record<string, PageRow[]> = {
    entity: [],
    concept: [],
    synthesis: [],
    source_summary: [],
  };

  for (const p of pages) {
    byCategory[p.category]?.push(p);
  }

  const lines: string[] = [
    "# Truth Desk Wiki — Index",
    "",
    `*${pages.length} pages · Last built: ${new Date().toISOString()}*`,
    "",
  ];

  const categoryLabels: Record<string, string> = {
    entity: "## Entities",
    concept: "## Concepts",
    synthesis: "## Synthesis",
    source_summary: "## Source Summaries",
  };

  for (const [cat, label] of Object.entries(categoryLabels)) {
    const catPages = byCategory[cat] ?? [];
    if (catPages.length === 0) continue;
    lines.push(label, "");
    for (const p of catPages) {
      const conf =
        p.avgConfidence != null
          ? ` · ${(p.avgConfidence * 100).toFixed(0)}% confidence`
          : "";
      lines.push(
        `- [[${p.slug}|${p.title}]] — ${p.sourceCount} source${p.sourceCount !== 1 ? "s" : ""}${conf}`
      );
    }
    lines.push("");
  }

  const content = lines.join("\n");

  // Upsert the single wiki_index row
  const existing = await db.select().from(wikiIndex).limit(1);
  if (existing.length === 0) {
    await db.insert(wikiIndex).values({ content, pageCount: pages.length });
  } else {
    const row = existing[0] as WikiIndexRow;
    await db
      .update(wikiIndex)
      .set({ content, pageCount: pages.length, lastBuiltAt: new Date() })
      .where(eq(wikiIndex.id, row.id));
  }
}

// ─── lintWiki ─────────────────────────────────────────────────────────────────

export async function lintWiki(): Promise<WikiLintResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const pages = (await db.select().from(wikiPages)) as WikiPage[];

  if (pages.length === 0) {
    const result: WikiLintResult = {
      contradictions: [],
      orphanSlugs: [],
      stalePageSlugs: [],
      missingCrossRefs: [],
      summary: "Wiki is empty — nothing to lint.",
    };
    await appendLog("lint", result.summary, 0);
    return result;
  }

  // Orphan detection: pages with no inbound links (excluding source_summary)
  const orphanSlugs = pages
    .filter(
      (p) =>
        p.category !== "source_summary" &&
        ((p.inboundLinks as string[]) ?? []).length === 0
    )
    .map((p) => p.slug);

  // Stale detection: pages not updated in 30+ days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const stalePageSlugs = pages
    .filter((p) => p.updatedAt < thirtyDaysAgo)
    .map((p) => p.slug);

  // Missing cross-refs: outbound links pointing to non-existent slugs
  const allSlugs = new Set(pages.map((p) => p.slug));
  const missingCrossRefs: string[] = [];
  for (const page of pages) {
    const outbound = (page.outboundLinks as string[]) ?? [];
    for (const target of outbound) {
      if (!allSlugs.has(target)) {
        missingCrossRefs.push(`${page.slug} → ${target} (missing)`);
      }
    }
  }

  // Contradiction detection via LLM (sample up to 20 pages)
  const samplePages = pages.slice(0, 20);
  const pageSnippets = samplePages
    .map((p) => `### ${p.title} (${p.slug})\n${p.content.slice(0, 400)}`)
    .join("\n\n");

  const lintResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a wiki health auditor for Truth Desk.\nYour task: identify contradictions between wiki pages — cases where two pages make conflicting factual claims.\n\nRespond with JSON:\n{\n  "contradictions": [\n    "entity-lysozyme claims resolution 1.8Å but entity-lysozyme-variant claims 2.1Å for the same structure"\n  ]\n}\n\nBe specific. Only report genuine factual contradictions, not differences in emphasis or scope.`,
      },
      {
        role: "user",
        content: `Check these ${samplePages.length} wiki pages for contradictions:\n\n${pageSnippets}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lint_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            contradictions: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["contradictions"],
          additionalProperties: false,
        },
      },
    },
  });

  let contradictions: string[] = [];
  try {
    const raw = extractLLMText(lintResponse.choices[0]?.message?.content ?? "{}");
    const parsed = JSON.parse(raw) as { contradictions: string[] };
    contradictions = parsed.contradictions ?? [];
  } catch {
    contradictions = [];
  }

  const issues =
    contradictions.length +
    orphanSlugs.length +
    stalePageSlugs.length +
    missingCrossRefs.length;

  const summary = [
    `Lint complete: ${pages.length} pages checked.`,
    contradictions.length > 0
      ? `${contradictions.length} contradiction(s) found.`
      : "No contradictions.",
    orphanSlugs.length > 0 ? `${orphanSlugs.length} orphan page(s).` : "No orphans.",
    stalePageSlugs.length > 0
      ? `${stalePageSlugs.length} stale page(s).`
      : "No stale pages.",
    missingCrossRefs.length > 0
      ? `${missingCrossRefs.length} broken cross-reference(s).`
      : "No broken cross-refs.",
    issues === 0 ? "Wiki is healthy." : `${issues} total issue(s) to review.`,
  ].join(" ");

  const result: WikiLintResult = {
    contradictions,
    orphanSlugs,
    stalePageSlugs,
    missingCrossRefs,
    summary,
  };

  await appendLog("lint", summary, pages.length);
  return result;
}

// ─── searchWiki ───────────────────────────────────────────────────────────────

export async function searchWiki(
  query: string,
  limit = 10
): Promise<Array<{ slug: string; title: string; category: string; snippet: string }>> {
  const db = await getDb();
  if (!db) return [];

  const pattern = `%${query}%`;
  const results = (await db
    .select({
      slug: wikiPages.slug,
      title: wikiPages.title,
      category: wikiPages.category,
      content: wikiPages.content,
    })
    .from(wikiPages)
    .where(
      sql`LOWER(${wikiPages.title}) LIKE LOWER(${pattern}) OR LOWER(${wikiPages.content}) LIKE LOWER(${pattern})`
    )
    .limit(limit)) as Array<{ slug: string; title: string; category: string; content: string }>;

  return results.map((r) => ({
    slug: r.slug,
    title: r.title,
    category: r.category,
    snippet: r.content.slice(0, 200).replace(/\n/g, " ").trim() + "…",
  }));
}
