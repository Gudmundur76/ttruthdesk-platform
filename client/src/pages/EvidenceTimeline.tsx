/**
 * EvidenceTimeline — chronological view of how evidence for a claim or entity
 * has evolved across papers over time.
 *
 * Routes:
 *   /timeline?q=<claimText>          — search by claim text
 *   /timeline/entity/<canonicalName> — search by entity
 */

import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  Search,
  ExternalLink,
  BookOpen,
  Calendar,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";

// ─── Verdict colour map ───────────────────────────────────────────────────────
const VERDICT_COLORS: Record<string, string> = {
  Supported: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Contradicted: "bg-red-100 text-red-800 border-red-200",
  "Partially Supported": "bg-amber-100 text-amber-800 border-amber-200",
  Ambiguous: "bg-purple-100 text-purple-800 border-purple-200",
  "Insufficient Evidence": "bg-slate-100 text-slate-700 border-slate-200",
  "Out of Scope": "bg-gray-100 text-gray-600 border-gray-200",
  "Needs Expert Review": "bg-orange-100 text-orange-800 border-orange-200",
};

const VERDICT_DOT: Record<string, string> = {
  Supported: "bg-emerald-500",
  Contradicted: "bg-red-500",
  "Partially Supported": "bg-amber-500",
  Ambiguous: "bg-purple-500",
  "Insufficient Evidence": "bg-slate-400",
  "Out of Scope": "bg-gray-400",
  "Needs Expert Review": "bg-orange-500",
};

// ─── Confidence bar ───────────────────────────────────────────────────────────
function ConfidenceBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.round(score * 100);
  const color =
    pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
    </div>
  );
}

// ─── Trend icon ───────────────────────────────────────────────────────────────
function TrendIcon({ trend }: { trend: string }) {
  if (trend === "improving") return <TrendingUp className="h-4 w-4 text-emerald-600" />;
  if (trend === "declining") return <TrendingDown className="h-4 w-4 text-red-500" />;
  if (trend === "stable") return <Minus className="h-4 w-4 text-slate-500" />;
  return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
}

// ─── Timeline event card ──────────────────────────────────────────────────────
type TimelineEvent = {
  claimId: number;
  claimText: string;
  verdict: string | null;
  confidenceScore: number | null;
  verdictRationale: string | null;
  documentId: number;
  documentTitle: string;
  verticalDomain: string;
  pmid: string | null;
  pubYear: string | null;
  journal: string | null;
  authors: string | null;
  date: string;
};

function EventCard({ event, index }: { event: TimelineEvent; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const verdictClass = event.verdict ? VERDICT_COLORS[event.verdict] ?? "bg-slate-100 text-slate-700" : "";
  const dotClass = event.verdict ? VERDICT_DOT[event.verdict] ?? "bg-slate-400" : "bg-slate-300";

  return (
    <div className="relative flex gap-4">
      {/* Timeline spine */}
      <div className="flex flex-col items-center">
        <div className={`mt-1.5 h-3 w-3 rounded-full border-2 border-background shadow-sm shrink-0 ${dotClass}`} />
        {/* Vertical line — hidden for last item via parent */}
        <div className="w-px flex-1 bg-border mt-1" />
      </div>

      {/* Card */}
      <div className="pb-6 flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {event.pubYear ?? event.date.slice(0, 4)}
          </span>
          {event.verdict && (
            <Badge variant="outline" className={`text-xs shrink-0 ${verdictClass}`}>
              {event.verdict}
            </Badge>
          )}
        </div>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => setExpanded(!expanded)}
        >
          <CardContent className="p-3">
            <p className="text-sm font-medium leading-snug line-clamp-2">
              {event.claimText}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {event.journal && (
                <span className="text-xs text-muted-foreground italic truncate max-w-[180px]">
                  {event.journal}
                </span>
              )}
              {event.authors && (
                <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                  {event.authors}
                </span>
              )}
              <ConfidenceBar score={event.confidenceScore} />
            </div>

            {expanded && (
              <div className="mt-3 pt-3 border-t space-y-2">
                {event.verdictRationale && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground">Rationale: </span>
                    {event.verdictRationale}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {event.pmid && (
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${event.pmid}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3 w-3" />
                      PubMed {event.pmid}
                    </a>
                  )}
                  <a
                    href={`/audit/${event.documentId}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <BookOpen className="h-3 w-3" />
                    Full audit
                  </a>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Summary panel ────────────────────────────────────────────────────────────
type Summary = {
  totalEvents: number;
  verdictDistribution: Record<string, number>;
  averageConfidence?: number | null;
  confidenceTrend?: string;
  earliestYear?: string | null;
  latestYear?: string | null;
};

function SummaryPanel({ summary }: { summary: Summary }) {
  const topVerdicts = Object.entries(summary.verdictDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Evidence Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums">{summary.totalEvents}</p>
            <p className="text-xs text-muted-foreground">Papers</p>
          </div>
          {summary.averageConfidence != null && (
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums">
                {Math.round(summary.averageConfidence * 100)}%
              </p>
              <p className="text-xs text-muted-foreground">Avg confidence</p>
            </div>
          )}
          {summary.earliestYear && (
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums">{summary.earliestYear}</p>
              <p className="text-xs text-muted-foreground">First evidence</p>
            </div>
          )}
          {summary.latestYear && (
            <div className="text-center">
              <p className="text-2xl font-bold tabular-nums">{summary.latestYear}</p>
              <p className="text-xs text-muted-foreground">Latest evidence</p>
            </div>
          )}
        </div>

        {summary.confidenceTrend && (
          <div className="flex items-center gap-2 text-sm">
            <TrendIcon trend={summary.confidenceTrend} />
            <span className="capitalize text-muted-foreground">
              Confidence trend:{" "}
              <span className="text-foreground font-medium">
                {summary.confidenceTrend.replace("_", " ")}
              </span>
            </span>
          </div>
        )}

        {topVerdicts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {topVerdicts.map(([verdict, count]) => (
              <Badge
                key={verdict}
                variant="outline"
                className={`text-xs ${VERDICT_COLORS[verdict] ?? ""}`}
              >
                {verdict} ({count})
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function EvidenceTimeline() {
  const searchStr = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(searchStr);
  const initialQuery = params.get("q") ?? "";

  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);

  // Sync URL → state when navigating back
  useEffect(() => {
    const q = new URLSearchParams(searchStr).get("q") ?? "";
    setSubmittedQuery(q);
    setQuery(q);
  }, [searchStr]);

  const { data, isLoading, isFetching } = trpc.timeline.forClaim.useQuery(
    { claimText: submittedQuery },
    { enabled: submittedQuery.length >= 3 }
  );

  const handleSearch = () => {
    if (query.trim().length < 3) return;
    setSubmittedQuery(query.trim());
    setLocation(`/timeline?q=${encodeURIComponent(query.trim())}`);
  };

  const groupedByYear = useMemo(() => {
    if (!data?.events) return [];
    const map = new Map<string, TimelineEvent[]>();
    for (const ev of data.events) {
      const yr = ev.pubYear ?? ev.date.slice(0, 4);
      if (!map.has(yr)) map.set(yr, []);
      map.get(yr)!.push(ev);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data?.events]);

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <div className="border-b bg-background/95 backdrop-blur sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/")}
            className="gap-1 text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm">Evidence Timeline</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Search bar */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight mb-1">Evidence Timeline</h1>
          <p className="text-muted-foreground text-sm mb-4">
            Track how scientific evidence for a claim has evolved across papers over time.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Enter a claim, e.g. 'whey protein increases muscle protein synthesis'"
                className="pl-9"
              />
            </div>
            <Button onClick={handleSearch} disabled={query.trim().length < 3}>
              Search
            </Button>
          </div>
        </div>

        {/* Loading state */}
        {(isLoading || isFetching) && submittedQuery.length >= 3 && (
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-3 w-3 rounded-full mt-1.5 shrink-0" />
                <Skeleton className="h-20 flex-1 rounded-lg" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isFetching && submittedQuery.length >= 3 && data?.events.length === 0 && (
          <div className="text-center py-16">
            <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No timeline data found</p>
            <p className="text-sm text-muted-foreground mt-1">
              No papers in the database contain evidence matching this claim.
            </p>
          </div>
        )}

        {/* Initial empty state */}
        {submittedQuery.length < 3 && (
          <div className="text-center py-16 text-muted-foreground">
            <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Enter a claim above to see its evidence history.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                "whey protein muscle synthesis",
                "creatine strength performance",
                "collagen skin elasticity",
                "probiotics gut inflammation",
              ].map((example) => (
                <button
                  key={example}
                  onClick={() => {
                    setQuery(example);
                    setSubmittedQuery(example);
                    setLocation(`/timeline?q=${encodeURIComponent(example)}`);
                  }}
                  className="text-xs px-3 py-1.5 rounded-full border hover:bg-accent transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {!isLoading && !isFetching && data && data.events.length > 0 && (
          <>
            {data.summary && <SummaryPanel summary={data.summary} />}

            {/* Year-grouped timeline */}
            <div className="space-y-0">
              {groupedByYear.map(([year, events], groupIdx) => (
                <div key={year}>
                  {/* Year label */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{year}</span>
                      <span className="text-xs text-muted-foreground">
                        ({events.length} paper{events.length !== 1 ? "s" : ""})
                      </span>
                    </div>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  {/* Events in this year */}
                  <div className="pl-2">
                    {events.map((event, idx) => (
                      <div
                        key={event.claimId}
                        className={
                          // Hide the spine line on the very last event
                          groupIdx === groupedByYear.length - 1 && idx === events.length - 1
                            ? "[&_.flex-1.bg-border]:hidden"
                            : ""
                        }
                      >
                        <EventCard event={event} index={idx} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer note */}
            <div className="mt-8 pt-4 border-t text-center">
              <p className="text-xs text-muted-foreground">
                Showing {data.events.length} evidence point{data.events.length !== 1 ? "s" : ""}.{" "}
                <button
                  className="text-primary hover:underline"
                  onClick={() => setLocation("/search")}
                >
                  Search all claims <ChevronRight className="inline h-3 w-3" />
                </button>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
