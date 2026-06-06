/**
 * Wiki.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * LLM Wiki index page — lists all DB-backed wiki pages with category grid,
 * search, and links to individual pages.
 * Route: /wiki
 */

import { useState, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { TopNav } from "@/components/TopNav";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  entity: "Entities",
  concept: "Concepts",
  synthesis: "Synthesis",
  source_summary: "Source Summaries",
};

const CATEGORY_COLORS: Record<string, string> = {
  entity: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-200",
  concept: "bg-purple-50 border-purple-200 text-purple-800 dark:bg-purple-950 dark:border-purple-800 dark:text-purple-200",
  synthesis: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200",
  source_summary: "bg-green-50 border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200",
};

const BADGE_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  entity: "default",
  concept: "secondary",
  synthesis: "outline",
  source_summary: "outline",
};

export default function Wiki() {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);

  const { data: listData, isLoading: listLoading } = trpc.wiki.listPages.useQuery(
    { category: selectedCategory as "entity" | "concept" | "synthesis" | "source_summary" | undefined, limit: 100 },
    { enabled: query.length === 0 }
  );

  const { data: searchResults, isLoading: searchLoading } = trpc.wiki.search.useQuery(
    { query, limit: 30 },
    { enabled: query.length >= 2 }
  );

  const { data: indexData } = trpc.wiki.getIndex.useQuery();

  const isLoading = query.length >= 2 ? searchLoading : listLoading;

  type ListPage = NonNullable<typeof listData>["pages"][number];
  type SearchPage = NonNullable<typeof searchResults>[number];
  type AnyPage = ListPage | SearchPage;

  const pages = useMemo((): AnyPage[] => {
    if (query.length >= 2) return (searchResults ?? []) as AnyPage[];
    return (listData?.pages ?? []) as AnyPage[];
  }, [query, searchResults, listData]);

  const categories = useMemo(() => {
    if (query.length >= 2) return [];
    const cats = Array.from(new Set((listData?.pages ?? []).map((p) => p.category)));
    return cats.sort();
  }, [query, listData]);

  const pagesByCategory = useMemo(() => {
    const map: Record<string, typeof pages> = {};
    for (const p of pages) {
      if (!map[p.category]) map[p.category] = [];
      map[p.category].push(p);
    }
    return map;
  }, [pages]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <div className="max-w-5xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Truth Desk Wiki</h1>
          <p className="text-muted-foreground text-sm max-w-2xl">
            An LLM-maintained knowledge base compiled from verified scientific claims. Each page is
            written and updated by the system as new evidence is processed.
          </p>
          {indexData && (
            <p className="text-xs text-muted-foreground mt-1">
              {indexData.pageCount} pages · Last rebuilt:{" "}
              {new Date(indexData.lastBuiltAt).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Search */}
        <div className="mb-6">
          <Input
            placeholder="Search wiki pages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-md"
          />
        </div>

        {/* Category filter (only when not searching) */}
        {query.length < 2 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setSelectedCategory(undefined)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                !selectedCategory
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-muted-foreground border-border hover:border-foreground"
              )}
            >
              All
            </button>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSelectedCategory(selectedCategory === key ? undefined : key)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  selectedCategory === key
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-muted-foreground border-border hover:border-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        )}

        {/* Search results */}
        {!isLoading && query.length >= 2 && (
          <div>
            <p className="text-sm text-muted-foreground mb-3">
              {pages.length} result{pages.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {pages.map((p) => (
                <WikiCard key={p.slug} slug={p.slug} title={p.title} category={p.category} snippet={"snippet" in p ? (p as { snippet?: string }).snippet : undefined} />
              ))}
            </div>
            {pages.length === 0 && (
              <p className="text-muted-foreground text-sm">No pages match your search.</p>
            )}
          </div>
        )}

        {/* Category grid */}
        {!isLoading && query.length < 2 && (
          <div className="space-y-8">
            {(selectedCategory ? [selectedCategory] : categories).map((cat) => {
              const catPages = pagesByCategory[cat] ?? [];
              if (catPages.length === 0) return null;
              return (
                <section key={cat}>
                  <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    {CATEGORY_LABELS[cat] ?? cat}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({catPages.length})
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {catPages.map((p) => (
                      <WikiCard key={p.slug} slug={p.slug} title={p.title} category={p.category} sourceCount={"sourceCount" in p ? (p.sourceCount ?? 0) : 0} avgConfidence={"avgConfidence" in p ? (p.avgConfidence ?? null) : null} />
                    ))}
                  </div>
                </section>
              );
            })}
            {pages.length === 0 && !isLoading && (
              <div className="text-center py-16 text-muted-foreground">
                <p className="text-sm">No wiki pages yet.</p>
                <p className="text-xs mt-1">
                  Pages are compiled automatically as documents are processed.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface WikiCardProps {
  slug: string;
  title: string;
  category: string;
  snippet?: string;
  sourceCount?: number;
  avgConfidence?: number | null;
}

function WikiCard({ slug, title, category, snippet, sourceCount, avgConfidence }: WikiCardProps) {
  return (
    <Link href={`/wiki/${slug}`}>
      <div
        className={cn(
          "border rounded-lg p-4 cursor-pointer transition-all hover:shadow-sm hover:-translate-y-0.5",
          CATEGORY_COLORS[category] ?? "bg-card border-border"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-sm leading-snug">{title}</span>
          <Badge variant={BADGE_VARIANTS[category] ?? "outline"} className="shrink-0 text-xs capitalize">
            {CATEGORY_LABELS[category] ?? category}
          </Badge>
        </div>
        {snippet && (
          <p className="text-xs mt-1.5 opacity-70 line-clamp-2">{snippet}</p>
        )}
        {(sourceCount !== undefined || avgConfidence !== null) && (
          <div className="flex gap-3 mt-2 text-xs opacity-60">
            {sourceCount !== undefined && (
              <span>{sourceCount} source{sourceCount !== 1 ? "s" : ""}</span>
            )}
            {avgConfidence != null && (
              <span>{(avgConfidence * 100).toFixed(0)}% confidence</span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
