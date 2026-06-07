/**
 * CorpusGrowthWidget.tsx
 *
 * Real-time dashboard card showing today's corpus growth counters:
 * new claims, graph nodes, graph edges, and PubMed papers ingested today.
 * Refetches every 30 seconds so the numbers update as the autonomous loop runs.
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Layers, Link2, FileText, Database } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ─── Animated counter ─────────────────────────────────────────────────────────

function useAnimatedCount(target: number, duration = 800) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === target) return;
    prevRef.current = target;

    const diff = target - prev;
    const steps = Math.min(Math.abs(diff), 30);
    if (steps === 0) { setDisplay(target); return; }

    let step = 0;
    const interval = setInterval(() => {
      step++;
      const progress = step / steps;
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(prev + diff * eased));
      if (step >= steps) {
        clearInterval(interval);
        setDisplay(target);
      }
    }, duration / steps);

    return () => clearInterval(interval);
  }, [target, duration]);

  return display;
}

// ─── Single stat tile ─────────────────────────────────────────────────────────

function StatTile({
  label,
  todayValue,
  totalValue,
  icon: Icon,
  color,
}: {
  label: string;
  todayValue: number;
  totalValue: number;
  icon: React.ElementType;
  color: string;
}) {
  const animatedToday = useAnimatedCount(todayValue);
  const animatedTotal = useAnimatedCount(totalValue);

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3 hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className={`p-1.5 rounded-lg ${color}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold tabular-nums leading-none">
          +{animatedToday.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground mt-1">today</p>
      </div>
      <div className="pt-1 border-t">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{animatedTotal.toLocaleString()}</span> total
        </p>
      </div>
    </div>
  );
}

// ─── Widget ───────────────────────────────────────────────────────────────────

export default function CorpusGrowthWidget() {
  const { data, isLoading } = trpc.graph.corpusGrowthStats.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-600" />
            Live Corpus Growth
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const stats = data ?? {
    claimsToday: 0,
    graphNodesToday: 0,
    graphEdgesToday: 0,
    papersToday: 0,
    totalClaims: 0,
    totalGraphNodes: 0,
    totalGraphEdges: 0,
  };

  const tiles = [
    {
      label: "Claims",
      todayValue: stats.claimsToday,
      totalValue: stats.totalClaims,
      icon: Layers,
      color: "bg-blue-100 text-blue-600",
    },
    {
      label: "Graph Nodes",
      todayValue: stats.graphNodesToday,
      totalValue: stats.totalGraphNodes,
      icon: Database,
      color: "bg-purple-100 text-purple-600",
    },
    {
      label: "Graph Edges",
      todayValue: stats.graphEdgesToday,
      totalValue: stats.totalGraphEdges,
      icon: Link2,
      color: "bg-orange-100 text-orange-600",
    },
    {
      label: "Papers",
      todayValue: stats.papersToday,
      totalValue: stats.claimsToday + stats.papersToday, // approximate cumulative
      icon: FileText,
      color: "bg-green-100 text-green-600",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-green-600" />
          Live Corpus Growth
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            refreshes every 30s
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Every CopilotKit query grows the knowledge graph autonomously.
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <StatTile key={t.label} {...t} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
