/**
 * WikiSlugPage.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * DB-backed LLM wiki page detail view.
 * Route: /wiki/:slug
 *
 * Shows:
 *   - Full markdown content (rendered via Streamdown)
 *   - Confidence badge, source count, vertical domain
 *   - Inbound links panel (pages that link here)
 *   - Link back to wiki index
 */

import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";
import { Streamdown } from "streamdown";
import { TopNav } from "@/components/TopNav";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  entity: "Entity",
  concept: "Concept",
  synthesis: "Synthesis",
  source_summary: "Source Summary",
};

const CATEGORY_COLORS: Record<string, string> = {
  entity: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  concept: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  synthesis: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  source_summary: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

function confidenceColor(conf: number): string {
  if (conf >= 0.8) return "text-green-600 dark:text-green-400";
  if (conf >= 0.5) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export default function WikiSlugPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";

  const { data: page, isLoading, isError } = trpc.wiki.getPageBySlug.useQuery(
    { slug },
    { enabled: !!slug }
  );

  // Update page title
  useEffect(() => {
    if (page?.title) {
      document.title = `${page.title} — Truth Desk Wiki`;
    }
    return () => {
      document.title = "Truth Desk";
    };
  }, [page?.title]);

  // Inject JSON-LD
  useEffect(() => {
    if (!page) return;
    const existing = document.getElementById("wiki-slug-jsonld");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.id = "wiki-slug-jsonld";
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: page.title,
      description: page.content.slice(0, 200).replace(/\n/g, " "),
      url: window.location.href,
      dateModified: new Date(page.updatedAt).toISOString(),
      creator: {
        "@type": "Organization",
        name: "Truth Desk",
        url: window.location.origin,
      },
      keywords: [page.category, page.verticalDomain, "scientific claims", "verification"],
    });
    document.head.appendChild(script);
    return () => {
      const s = document.getElementById("wiki-slug-jsonld");
      if (s) s.remove();
    };
  }, [page]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <TopNav />
        <div className="max-w-4xl mx-auto px-4 py-10 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !page) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <TopNav />
        <div className="max-w-4xl mx-auto px-4 py-10">
          <p className="text-muted-foreground text-sm">
            Wiki page not found. It may not have been compiled yet.
          </p>
          <Link href="/wiki" className="text-sm text-primary hover:underline mt-2 inline-block">
            ← Back to Wiki
          </Link>
        </div>
      </div>
    );
  }

  const inboundLinks: string[] = Array.isArray(page.inboundLinks) ? page.inboundLinks : [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Main content */}
          <article className="flex-1 min-w-0">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
              <Link href="/wiki" className="hover:text-foreground transition-colors">
                Wiki
              </Link>
              <span>/</span>
              <span className="capitalize">{CATEGORY_LABELS[page.category] ?? page.category}</span>
              <span>/</span>
              <span className="text-foreground font-medium truncate">{page.title}</span>
            </div>

            {/* Title + badges */}
            <div className="flex flex-wrap items-start gap-3 mb-4">
              <h1 className="text-2xl font-bold tracking-tight">{page.title}</h1>
              <Badge
                className={cn(
                  "text-xs font-medium capitalize shrink-0",
                  CATEGORY_COLORS[page.category]
                )}
              >
                {CATEGORY_LABELS[page.category] ?? page.category}
              </Badge>
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-6 pb-4 border-b border-border">
              <span>{page.sourceCount} source{page.sourceCount !== 1 ? "s" : ""}</span>
              {page.avgConfidence != null && (
                <span className={confidenceColor(page.avgConfidence)}>
                  {(page.avgConfidence * 100).toFixed(0)}% avg confidence
                </span>
              )}
              <span className="capitalize">{page.verticalDomain.replace(/_/g, " ")}</span>
              <span>
                Updated {new Date(page.updatedAt).toLocaleDateString()}
              </span>
            </div>

            {/* Wiki content */}
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {page.content ? (
                <Streamdown>{page.content}</Streamdown>
              ) : (
                <p className="text-muted-foreground italic">This page has no content yet.</p>
              )}
            </div>
          </article>

          {/* Sidebar */}
          <aside className="lg:w-56 shrink-0 space-y-4">
            {/* Inbound links */}
            {inboundLinks.length > 0 && (
              <div className="border border-border rounded-lg p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Linked from
                </h3>
                <ul className="space-y-1.5">
                  {inboundLinks.map((linkSlug) => (
                    <li key={linkSlug}>
                      <Link
                        href={`/wiki/${linkSlug}`}
                        className="text-xs text-primary hover:underline break-all"
                      >
                        {linkSlug}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Navigation */}
            <div className="border border-border rounded-lg p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Navigation
              </h3>
              <ul className="space-y-1.5 text-xs">
                <li>
                  <Link href="/wiki" className="text-primary hover:underline">
                    ← Wiki Index
                  </Link>
                </li>
                <li>
                  <Link href="/graph" className="text-primary hover:underline">
                    Knowledge Graph
                  </Link>
                </li>
                <li>
                  <Link href="/search" className="text-primary hover:underline">
                    Search Claims
                  </Link>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
