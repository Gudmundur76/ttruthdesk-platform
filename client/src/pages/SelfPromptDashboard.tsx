import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Link } from "wouter";
import { ArrowLeft, Brain, Zap, CheckCircle2, XCircle, RotateCcw, Activity, Clock, TrendingDown } from "lucide-react";

const EVENT_TYPES = [
  "verdict_assigned",
  "contradiction_found",
  "gap_closed",
  "source_down",
  "meta_alert",
  "user_submitted",
  "scheduled_tick",
] as const;

type EventType = typeof EVENT_TYPES[number];

const ACTION_COLORS: Record<string, string> = {
  notify: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  wiki_update: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  frontier: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  reindex: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  alert: "bg-red-500/10 text-red-400 border-red-500/20",
  gap_map: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  meta_check: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  converge: "bg-green-500/10 text-green-400 border-green-500/20",
};

function MetricsCards() {
  const { data: metrics, isLoading } = trpc.selfPrompt.getMetrics.useQuery();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="border-border/40 bg-card/50">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Total Cycles</span>
          </div>
          <p className="text-2xl font-bold tabular-nums">{metrics.totalCycles}</p>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/50">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Convergence Rate</span>
          </div>
          <p className="text-2xl font-bold tabular-nums">
            {(metrics.convergenceRate * 100).toFixed(1)}%
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/50">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Avg Actions/Cycle</span>
          </div>
          <p className="text-2xl font-bold tabular-nums">{metrics.avgActionsGenerated}</p>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/50">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Avg Duration</span>
          </div>
          <p className="text-2xl font-bold tabular-nums">{metrics.avgDurationMs}ms</p>
        </CardContent>
      </Card>
    </div>
  );
}

function EventBreakdown() {
  const { data: metrics } = trpc.selfPrompt.getMetrics.useQuery();
  if (!metrics || Object.keys(metrics.eventBreakdown).length === 0) return null;

  const total = Object.values(metrics.eventBreakdown).reduce((s, v) => s + v, 0);
  const sorted = Object.entries(metrics.eventBreakdown).sort((a, b) => b[1] - a[1]);

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Event Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sorted.map(([event, count]) => (
          <div key={event} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-36 truncate">{event}</span>
            <div className="flex-1 bg-muted/30 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-primary/60 rounded-full transition-all"
                style={{ width: `${(count / total) * 100}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TriggerCyclePanel() {
  const [eventType, setEventType] = useState<EventType>("scheduled_tick");
  const [description, setDescription] = useState("Manual trigger from admin dashboard");
  const [claimId, setClaimId] = useState("");
  const [documentId, setDocumentId] = useState("");

  const utils = trpc.useUtils();
  const trigger = trpc.selfPrompt.triggerCycle.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Cycle complete: ${result.actionsGenerated} actions generated, ${result.actionsExecuted} executed, converged=${result.converged}`
      );
      utils.selfPrompt.listCycles.invalidate();
      utils.selfPrompt.getMetrics.invalidate();
    },
    onError: (err) => toast.error(`Trigger failed: ${err.message}`),
  });

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Brain className="h-4 w-4" />
          Manual Trigger
        </CardTitle>
        <CardDescription className="text-xs">
          Fire a self-prompt cycle with a specific event type for testing or manual intervention.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Event Type</label>
            <Select value={eventType} onValueChange={(v) => setEventType(v as EventType)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Claim ID</label>
              <Input
                className="h-8 text-xs"
                placeholder="optional"
                value={claimId}
                onChange={(e) => setClaimId(e.target.value)}
                type="number"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Document ID</label>
              <Input
                className="h-8 text-xs"
                placeholder="optional"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                type="number"
              />
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Description</label>
          <Textarea
            className="text-xs min-h-[60px] resize-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          className="w-full"
          disabled={trigger.isPending || !description.trim()}
          onClick={() =>
            trigger.mutate({
              eventType,
              description,
              claimId: claimId ? parseInt(claimId) : undefined,
              documentId: documentId ? parseInt(documentId) : undefined,
            })
          }
        >
          {trigger.isPending ? "Running cycle…" : "Run Self-Prompt Cycle"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CycleRow({ cycle }: { cycle: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const actions = (cycle.actions as Array<Record<string, unknown>>) ?? [];
  const results = (cycle.executionResults as Array<Record<string, unknown>>) ?? [];
  const converged = cycle.converged as boolean;
  const createdAt = cycle.createdAt ? new Date(cycle.createdAt as string) : null;

  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {converged ? (
            <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
          ) : (
            <RotateCcw className="h-4 w-4 text-amber-400 shrink-0" />
          )}
          <span className="text-xs font-medium truncate">{cycle.eventType as string}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {actions.length} actions
          </Badge>
          {converged && (
            <Badge className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20 shrink-0">
              converged
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums">
            {cycle.durationMs as number}ms
          </span>
          {createdAt && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              {createdAt.toLocaleString()}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3">
          {/* Reasoning */}
          <div>
            <p className="text-xs text-muted-foreground mb-1 font-medium">Reasoning</p>
            <p className="text-xs text-foreground/80 leading-relaxed">{cycle.reasoning as string}</p>
          </div>

          {/* Actions */}
          {actions.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Actions Generated</p>
              <div className="space-y-1.5">
                {actions.map((action, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${ACTION_COLORS[action.action as string] ?? ""}`}
                    >
                      {action.action as string}
                    </Badge>
                    <span className="text-xs text-foreground/70 leading-relaxed flex-1">
                      {action.reasoning as string}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      p={action.priority as number} ev={action.expectedValue as number}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Execution Results */}
          {results.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Execution Results</p>
              <div className="space-y-1">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {r.status === "ok" ? (
                      <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                    ) : r.status === "error" ? (
                      <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                    ) : (
                      <div className="h-3 w-3 rounded-full bg-muted shrink-0" />
                    )}
                    <span className="text-xs text-foreground/70">{r.detail as string}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SelfPromptDashboard() {
  const [limit, setLimit] = useState(50);
  const { data: cycles, isLoading } = trpc.selfPrompt.listCycles.useQuery({ limit });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Admin
            </Button>
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Self-Prompting Engine
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              State-driven autonomous orchestrator — reasons about what just happened and generates its own action list
            </p>
          </div>
        </div>

        {/* Metrics */}
        <MetricsCards />

        <div className="grid md:grid-cols-2 gap-4">
          <EventBreakdown />
          <TriggerCyclePanel />
        </div>

        {/* Cycle Log */}
        <Card className="border-border/40 bg-card/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Recent Cycles</CardTitle>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="h-7 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[20, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-xs">Last {n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              [...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)
            ) : !cycles || cycles.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No cycles recorded yet. Submit a document or use the manual trigger above.
              </div>
            ) : (
              cycles.map((cycle, i) => (
                <CycleRow key={i} cycle={cycle as Record<string, unknown>} />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
