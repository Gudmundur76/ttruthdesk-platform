/**
 * Frontier.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontier Engine Dashboard — Admin-only view of Layer 3 operations.
 *
 * Sections:
 *   1. Metrics overview (gaps detected, closed, hypothesis success rate)
 *   2. Top priority gaps table with status badges and type icons
 *   3. Recent activity log (frontier_log entries)
 *   4. Manual "Run Frontier Engine" trigger
 *
 * Architecture note: This page is read-only for the knowledge graph.
 * The Frontier Engine only writes to knowledge_gaps and frontier_log.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────

type GapStatus =
  | "open"
  | "pursued"
  | "narrowing"
  | "closed_verified"
  | "closed_resolved"
  | "stale"
  | "all";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    open: { label: "Open", variant: "destructive" },
    pursued: { label: "Pursued", variant: "default" },
    narrowing: { label: "Narrowing", variant: "secondary" },
    closed_verified: { label: "Verified", variant: "outline" },
    closed_resolved: { label: "Resolved", variant: "outline" },
    stale: { label: "Stale", variant: "secondary" },
  };
  const cfg = map[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function gapTypeIcon(gapType: string) {
  const icons: Record<string, string> = {
    structural: "🔗",
    evidence: "🔬",
    contradiction: "⚡",
    temporal: "⏳",
    hypothesis: "💡",
  };
  return icons[gapType] ?? "❓";
}

function actionTypeLabel(actionType: string) {
  const labels: Record<string, string> = {
    gap_detected: "Gap detected",
    hypothesis_queued: "Hypothesis queued",
    priority_adjusted: "Priority adjusted",
    gap_closed: "Gap closed",
    hypothesis_verified: "Hypothesis verified",
    hypothesis_refuted: "Hypothesis refuted",
    evidence_found: "Evidence found",
    search_expanded: "Search expanded",
  };
  return labels[actionType] ?? actionType;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function days(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} days`;
}

// ─── Metrics Card ─────────────────────────────────────────────────────────────

function MetricsSection() {
  const { data: metrics, isLoading } = trpc.frontier.metrics.useQuery();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-4 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!metrics) return null;

  const cards = [
    { label: "Total Gaps Detected", value: metrics.totalGapsDetected, color: "text-foreground" },
    { label: "Open Gaps", value: metrics.openGaps, color: "text-destructive" },
    { label: "Pursued Gaps", value: metrics.pursuedGaps, color: "text-blue-500" },
    { label: "Closed (Verified)", value: metrics.closedVerified, color: "text-green-500" },
    { label: "Hypotheses Queued", value: metrics.hypothesesQueued, color: "text-foreground" },
    { label: "Hypotheses Verified", value: metrics.hypothesesVerified, color: "text-green-500" },
    { label: "Closure Rate (30d)", value: pct(metrics.closureRate30Days), color: "text-blue-500" },
    { label: "Avg Days to Close", value: days(metrics.avgDaysToClosureHigh), color: "text-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="pt-6">
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-sm text-muted-foreground mt-1">{c.label}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Gaps Table ───────────────────────────────────────────────────────────────

function GapsTable() {
  const [statusFilter, setStatusFilter] = useState<GapStatus>("all");
  const [offset, setOffset] = useState(0);
  const limit = 15;

  const { data, isLoading } = trpc.frontier.listGaps.useQuery({
    status: statusFilter,
    limit,
    offset,
  });

  const total = data?.total ?? 0;
  const gaps = data?.gaps ?? [];
  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as GapStatus);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="pursued">Pursued</SelectItem>
            <SelectItem value="narrowing">Narrowing</SelectItem>
            <SelectItem value="closed_verified">Closed (Verified)</SelectItem>
            <SelectItem value="closed_resolved">Closed (Resolved)</SelectItem>
            <SelectItem value="stale">Stale</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} gaps total</span>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-20 text-right">Priority</TableHead>
              <TableHead className="w-20 text-right">Attempts</TableHead>
              <TableHead className="w-32">Opened</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : gaps.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No gaps found. Run the Frontier Engine to detect gaps.
                </TableCell>
              </TableRow>
            ) : (
              gaps.map((gap) => (
                <TableRow key={gap.id}>
                  <TableCell className="text-lg" title={gap.gapType}>
                    {gapTypeIcon(gap.gapType)}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <div className="truncate text-sm" title={gap.description}>
                      {gap.description}
                    </div>
                  </TableCell>
                  <TableCell>{statusBadge(gap.status)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {gap.priorityScore.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {gap.evidenceAttempts}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(gap.openedAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

function ActivityLog() {
  const { data: log, isLoading } = trpc.frontier.recentLog.useQuery({ limit: 30 });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!log || log.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No activity yet. Run the Frontier Engine to generate log entries.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {[...log].reverse().map((entry) => (
        <div
          key={entry.id}
          className="flex items-start gap-3 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
        >
          <div className="text-xs text-muted-foreground w-32 shrink-0 pt-0.5">
            {new Date(entry.createdAt).toLocaleString()}
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sm">{actionTypeLabel(entry.actionType)}</span>
            {entry.gapId && (
              <span className="text-xs text-muted-foreground ml-2">Gap #{entry.gapId}</span>
            )}
            {entry.outcome && (
              <div className="text-xs text-muted-foreground truncate mt-0.5">{entry.outcome}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Frontier() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const runMutation = trpc.frontier.run.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Frontier Engine complete: ${result.gapMapping.newGapsCreated} new gaps, ` +
          `${result.hypothesisGeneration.queueItemsCreated} hypotheses queued (${result.durationMs}ms)`
      );
      utils.frontier.metrics.invalidate();
      utils.frontier.listGaps.invalidate();
      utils.frontier.recentLog.invalidate();
      utils.frontier.topGaps.invalidate();
    },
    onError: (err) => {
      toast.error(`Frontier Engine failed: ${err.message}`);
    },
  });

  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <div className="text-2xl font-bold">Access Restricted</div>
          <div className="text-muted-foreground">
            The Frontier Engine dashboard is only accessible to administrators.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Frontier Engine</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Layer 3 of the three-layer architecture. Detects knowledge gaps, ranks them by priority,
            pursues evidence, and generates testable hypotheses — all without ever writing to the
            knowledge graph directly.
          </p>
        </div>
        <Button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          className="shrink-0"
        >
          {runMutation.isPending ? "Running…" : "Run Frontier Engine"}
        </Button>
      </div>

      {/* Architecture note */}
      <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20">
        <CardContent className="pt-4 pb-4">
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Authority boundary:</strong> The Frontier Engine writes only to{" "}
            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">knowledge_gaps</code>,{" "}
            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">coord_queue</code>, and{" "}
            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">frontier_log</code>. It
            never writes to <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">graph_entities</code>,{" "}
            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">graphRelations</code>,{" "}
            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">claims</code>, or{" "}
            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">verdicts</code>. Every
            hypothesis must pass through Friction → Truth → Verdict before entering the graph.
          </div>
        </CardContent>
      </Card>

      {/* Metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Metrics</h2>
        <MetricsSection />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="gaps">
        <TabsList>
          <TabsTrigger value="gaps">Knowledge Gaps</TabsTrigger>
          <TabsTrigger value="log">Activity Log</TabsTrigger>
        </TabsList>

        <TabsContent value="gaps" className="mt-4">
          <GapsTable />
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Frontier Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityLog />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
