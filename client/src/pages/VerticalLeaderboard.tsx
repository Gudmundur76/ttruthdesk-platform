import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Trophy, Atom, FlaskConical, Microscope, Globe, Link2, User, BookOpen, Layers } from "lucide-react";
import { TopNav } from "@/components/TopNav";

const ENTITY_TYPE_ICONS: Record<string, React.ReactNode> = {
  protein: <Atom className="h-4 w-4" />,
  pdb_id: <Layers className="h-4 w-4" />,
  method: <FlaskConical className="h-4 w-4" />,
  organism: <Globe className="h-4 w-4" />,
  ligand: <Link2 className="h-4 w-4" />,
  author: <User className="h-4 w-4" />,
  concept: <BookOpen className="h-4 w-4" />,
  document: <Microscope className="h-4 w-4" />,
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  protein: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  pdb_id: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  method: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  organism: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  ligand: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  author: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  concept: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  document: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

const VERTICAL_LABELS: Record<string, string> = {
  structural_biology: "Structural Biology",
  protein_supplement: "Protein Supplements",
  creatine_ergogenics: "Creatine & Ergogenics",
  gut_microbiome: "Gut Microbiome",
  collagen_peptides: "Collagen & Peptides",
  plant_based_protein: "Plant-Based Protein",
  sports_nutrition_rct: "Sports Nutrition RCTs",
};

type EntityType = "protein" | "pdb_id" | "method" | "organism" | "ligand" | "author" | "concept" | "document";

export default function VerticalLeaderboard() {
  const [selectedVertical, setSelectedVertical] = useState<string>("all");
  const [selectedEntityType, setSelectedEntityType] = useState<string>("all");
  const [limit, setLimit] = useState(20);

  const { data: summary, isLoading: summaryLoading } = trpc.leaderboard.verticalSummary.useQuery();

  const { data: topEntities, isLoading: entitiesLoading } = trpc.leaderboard.topEntities.useQuery({
    vertical: selectedVertical === "all" ? undefined : selectedVertical,
    entityType: selectedEntityType === "all" ? undefined : (selectedEntityType as EntityType),
    limit,
  });

  const getRankMedal = (rank: number) => {
    if (rank === 1) return <span className="text-yellow-500 font-bold text-lg">🥇</span>;
    if (rank === 2) return <span className="text-gray-400 font-bold text-lg">🥈</span>;
    if (rank === 3) return <span className="text-amber-600 font-bold text-lg">🥉</span>;
    return <span className="text-muted-foreground font-mono text-sm w-6 text-center">{rank}</span>;
  };

  const getTrendIcon = (trend: "up" | "down" | "stable", delta: number) => {
    if (trend === "up") return (
      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
        <TrendingUp className="h-3.5 w-3.5" />+{delta}
      </span>
    );
    if (trend === "down") return (
      <span className="flex items-center gap-1 text-red-500 dark:text-red-400 text-xs font-medium">
        <TrendingDown className="h-3.5 w-3.5" />{delta}
      </span>
    );
    return (
      <span className="flex items-center gap-1 text-muted-foreground text-xs">
        <Minus className="h-3.5 w-3.5" />0
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="container max-w-5xl py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Trophy className="h-7 w-7 text-yellow-500" />
            <h1 className="text-3xl font-bold tracking-tight">Vertical Leaderboard</h1>
          </div>
          <p className="text-muted-foreground">
            Most-cited entities across all research verticals, ranked by total citation count with 30-day trend arrows.
          </p>
        </div>

        {/* Vertical summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
          {summaryLoading
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
            : summary?.map((v) => (
                <button
                  key={v.vertical}
                  onClick={() => setSelectedVertical(v.vertical === selectedVertical ? "all" : v.vertical)}
                  className={`rounded-xl border p-3 text-left transition-all hover:shadow-md ${
                    selectedVertical === v.vertical
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="text-xs text-muted-foreground mb-1 truncate">
                    {VERTICAL_LABELS[v.vertical] ?? v.vertical}
                  </div>
                  <div className="font-bold text-lg">{v.citationCount.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{v.entityCount} entities</div>
                </button>
              ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Select value={selectedVertical} onValueChange={setSelectedVertical}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All verticals" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All verticals</SelectItem>
              {Object.entries(VERTICAL_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedEntityType} onValueChange={setSelectedEntityType}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.keys(ENTITY_TYPE_ICONS).map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">Top 10</SelectItem>
              <SelectItem value="20">Top 20</SelectItem>
              <SelectItem value="50">Top 50</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Leaderboard table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              {selectedVertical === "all"
                ? "All Verticals"
                : VERTICAL_LABELS[selectedVertical] ?? selectedVertical}
              {selectedEntityType !== "all" && ` · ${selectedEntityType}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {entitiesLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
              </div>
            ) : !topEntities || topEntities.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <Trophy className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No entities found for this filter combination.</p>
                <p className="text-sm mt-1">Try a different vertical or entity type.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {topEntities.map((entity) => (
                  <div
                    key={entity.id}
                    className="flex items-center gap-4 px-6 py-3 hover:bg-muted/40 transition-colors"
                  >
                    {/* Rank */}
                    <div className="w-8 flex justify-center flex-shrink-0">
                      {getRankMedal(entity.rank)}
                    </div>

                    {/* Entity info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/graph?entity=${encodeURIComponent(entity.canonicalName)}`}
                          className="font-medium text-sm hover:underline truncate max-w-xs"
                        >
                          {entity.canonicalName}
                        </Link>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            ENTITY_TYPE_COLORS[entity.entityType] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {ENTITY_TYPE_ICONS[entity.entityType]}
                          {entity.entityType}
                        </span>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-6 flex-shrink-0">
                      {/* 30-day trend */}
                      <div className="text-right hidden sm:block">
                        <div className="text-xs text-muted-foreground mb-0.5">30d</div>
                        {getTrendIcon(entity.trend, entity.trendDelta)}
                      </div>

                      {/* Recent citations */}
                      <div className="text-right hidden md:block">
                        <div className="text-xs text-muted-foreground mb-0.5">Recent</div>
                        <div className="text-sm font-medium">{entity.recentCitations}</div>
                      </div>

                      {/* Total citations */}
                      <div className="text-right w-20">
                        <div className="text-xs text-muted-foreground mb-0.5">Total</div>
                        <div className="text-sm font-bold">{entity.totalCitations.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer note */}
        <p className="text-xs text-muted-foreground text-center mt-6">
          Citation counts reflect edges in the knowledge graph. Trend compares the last 30 days to the prior 30 days.
          Click any entity name to explore it in the Knowledge Graph.
        </p>
      </div>
    </div>
  );
}
