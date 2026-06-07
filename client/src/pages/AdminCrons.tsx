import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Clock, Play, RefreshCw, CheckCircle2, AlertCircle, Timer } from "lucide-react";

function formatNextRun(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "overdue";
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `in ${diffH}h ${diffMin % 60}m`;
  return d.toLocaleDateString();
}

function formatLastRun(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

const CRON_DESCRIPTIONS: Record<string, string> = {
  "pmc-feed-nightly": "Queries PubMed for each vertical's MeSH terms, fetches abstracts, deduplicates, queues new papers through the audit pipeline.",
  "quality-pass-nightly": "Re-processes draft-tier documents with Kimi K2, upgrades qualityTier to verified.",
  "quality-scorer-6h": "Scores all unscored claims and re-scores claims whose evidence is >7 days old.",
  "autonomous-loop-tick": "Drains up to 20 pending events, triggers Dream State if system is converged.",
  "frontier-engine": "Gap mapping → gap ranking → evidence pursuit → hypothesis generation → stale cleanup.",
  "swarm-tick-daily": "Meta-agent swarm: code drift detection, stub ledger, pipeline invariants, health score.",
  "wiki-engine-lint-weekly": "Contradiction detection, orphan pages, stale claims, missing cross-refs, index rebuild.",
  "discovery-loop-daily": "Queries PubMed + bioRxiv + PDB simultaneously, applies signal-density gate, submits new papers.",
  "pubmed-decode-weekly": "deCODE Genetics-specific PubMed scan.",
};

export default function AdminCrons() {
  const { user } = useAuth();
  const [runningUids, setRunningUids] = useState<Set<string>>(new Set());

  const { data, isLoading, error, refetch } = trpc.crons.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const runNow = trpc.crons.runNow.useMutation({
    onMutate: ({ taskUid }) => {
      setRunningUids((prev) => { const s = new Set(prev); s.add(taskUid); return s; });
    },
    onSuccess: (_, { taskUid }) => {
      setRunningUids((prev) => { const s = new Set(prev); s.delete(taskUid); return s; });
      toast.success("Job triggered — it will run within seconds.");
      setTimeout(() => refetch(), 3000);
    },
    onError: (err, { taskUid }) => {
      setRunningUids((prev) => { const s = new Set(prev); s.delete(taskUid); return s; });
      toast.error(`Failed to trigger job: ${err.message}`);
    },
  });

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-6 h-6 text-primary" />
            Cron Health Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {data?.total ?? "—"} scheduled jobs · auto-refreshes every 30s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="grid gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 flex items-center gap-3 text-destructive">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>Failed to load cron jobs: {error.message}</span>
          </CardContent>
        </Card>
      )}

      {data && (
        <div className="grid gap-4">
          {data.jobs.map((job) => {
            const isRunning = runningUids.has(job.taskUid);
            const nextIn = formatNextRun(job.nextExecutionAt);
            const isOverdue = nextIn === "overdue";
            return (
              <Card
                key={job.taskUid}
                className="transition-all hover:shadow-md border-border/60"
              >
                <CardHeader className="pb-2 flex flex-row items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-semibold flex items-center gap-2 flex-wrap">
                      {job.name}
                      <Badge
                        variant="outline"
                        className="font-mono text-xs shrink-0"
                      >
                        {job.cronExpression}
                      </Badge>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {CRON_DESCRIPTIONS[job.name] ?? "Scheduled background job."}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5"
                    disabled={isRunning}
                    onClick={() => runNow.mutate({ taskUid: job.taskUid })}
                  >
                    {isRunning ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    Run Now
                  </Button>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-6 text-sm flex-wrap">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      Last run: <span className="text-foreground font-medium">{formatLastRun(job.lastExecutedAt)}</span>
                    </span>
                    <span className={`flex items-center gap-1.5 ${isOverdue ? "text-destructive" : "text-muted-foreground"}`}>
                      <Timer className={`w-3.5 h-3.5 ${isOverdue ? "text-destructive" : "text-amber-500"}`} />
                      Next run: <span className="font-medium">{nextIn}</span>
                    </span>
                    <span className="text-muted-foreground font-mono text-xs ml-auto">
                      uid: {job.taskUid.slice(0, 12)}…
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
