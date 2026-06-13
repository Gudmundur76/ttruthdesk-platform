import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Moon,
  Zap,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Brain,
  Network,
  FlaskConical,
  TrendingDown,
  Layers,
} from "lucide-react";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "Never";
  return new Date(d).toLocaleString();
}

function wakeReasonBadge(reason: string | null | undefined) {
  if (!reason || reason === "in_progress") return <Badge variant="outline">In Progress</Badge>;
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    max_cycles: { label: "Max Cycles", variant: "default" },
    critical_pattern: { label: "Critical Pattern", variant: "destructive" },
    duration_cap: { label: "Duration Cap", variant: "secondary" },
    external_event: { label: "External Event", variant: "secondary" },
    health_drop: { label: "Health Drop", variant: "destructive" },
    error: { label: "Error", variant: "destructive" },
  };
  const entry = map[reason] ?? { label: reason, variant: "outline" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}

// ─── Session Row ───────────────────────────────────────────────────────────────

function SessionRow({ sessionId }: { sessionId: number }) {
  const [expanded, setExpanded] = useState(false);
  const { data: session, isLoading } = trpc.dream.getSession.useQuery(
    { id: sessionId },
    { enabled: expanded }
  );

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <Moon className="h-4 w-4 text-indigo-400" />
          <span className="font-mono text-sm text-muted-foreground">#{sessionId}</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t bg-muted/20">
          {isLoading ? (
            <div className="space-y-2 pt-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : session ? (
            <div className="pt-3 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Started</p>
                  <p className="font-medium">{formatDate(session.startedAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Duration</p>
                  <p className="font-medium">{formatDuration(session.durationMs)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Cycles</p>
                  <p className="font-medium">{session.cyclesCompleted} / 5</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Wake Reason</p>
                  {wakeReasonBadge(session.reasonForWaking)}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                {[
                  { label: "Patterns", value: session.patternsFound, icon: Brain },
                  { label: "Hypotheses", value: session.hypothesesGenerated, icon: FlaskConical },
                  { label: "Graph Opts", value: session.graphOptimizations, icon: Network },
                  { label: "Recalibrations", value: session.confidenceRecalibrations, icon: TrendingDown },
                  { label: "Simulations", value: session.simulatedScenarios, icon: Layers },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="flex items-center gap-2 bg-background rounded p-2 border">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-semibold text-sm">{value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {session.patternLog && session.patternLog.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Pattern Log
                  </p>
                  <div className="space-y-1.5">
                    {session.patternLog.map((p, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <Badge
                          variant={
                            p.urgency === "critical"
                              ? "destructive"
                              : p.urgency === "high"
                              ? "default"
                              : "secondary"
                          }
                          className="text-xs shrink-0 mt-0.5"
                        >
                          {p.urgency}
                        </Badge>
                        <span className="text-muted-foreground">{p.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {session.simulationLog && session.simulationLog.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Simulation Log
                  </p>
                  <div className="space-y-2">
                    {session.simulationLog.map((s, i) => (
                      <div key={i} className="text-sm border rounded p-2 bg-background">
                        <p className="font-medium text-xs">{s.scenario}</p>
                        <p className="text-muted-foreground text-xs mt-1">{s.recommendation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground pt-3">Session not found.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export default function DreamDashboard() {
  const [healthScore] = useState(80);
  const [triggering, setTriggering] = useState(false);

  const { data: stats, refetch: refetchStats } = trpc.dream.getStats.useQuery();
  const { data: sessions, isLoading: sessionsLoading, refetch: refetchSessions } =
    trpc.dream.getSessions.useQuery({ limit: 20 });
  const { data: eligibility, refetch: refetchEligibility } =
    trpc.dream.checkEligibility.useQuery({ healthScore });

  const triggerMutation = trpc.dream.triggerSession.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Dream session #${result.sessionId} complete — ${result.cyclesCompleted} cycles, ${result.patternsFound} patterns found`
      );
      refetchStats();
      refetchSessions();
      refetchEligibility();
    },
    onError: (err) => {
      toast.error(`Dream session failed: ${err.message}`);
    },
    onSettled: () => setTriggering(false),
  });

  const handleTrigger = () => {
    setTriggering(true);
    triggerMutation.mutate({ healthScore });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10">
              <Moon className="h-6 w-6 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Dream State</h1>
              <p className="text-sm text-muted-foreground">
                Layer 5 — Offline graph consolidation &amp; latent pattern discovery
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { refetchStats(); refetchSessions(); refetchEligibility(); }}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={handleTrigger}
              disabled={triggering || !eligibility?.eligible}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {triggering ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                  Dreaming…
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-1.5" />
                  Trigger Dream
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Eligibility Banner */}
        {eligibility && (
          <div
            className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm border ${
              eligibility.eligible
                ? "bg-green-500/10 border-green-500/30 text-green-400"
                : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
            }`}
          >
            {eligibility.eligible ? (
              <CheckCircle className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>
              <strong>{eligibility.eligible ? "Eligible" : "Not eligible"}:</strong>{" "}
              {eligibility.reason}
              {eligibility.lastSessionAt && (
                <> · Last session: {formatDate(eligibility.lastSessionAt)}</>
              )}
            </span>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "Total Sessions",
              value: stats?.totalSessions ?? 0,
              icon: Moon,
              color: "text-indigo-400",
            },
            {
              label: "Patterns Found",
              value: stats?.totalPatterns ?? 0,
              icon: Brain,
              color: "text-purple-400",
            },
            {
              label: "Hypotheses Queued",
              value: stats?.totalHypotheses ?? 0,
              icon: FlaskConical,
              color: "text-blue-400",
            },
            {
              label: "Recalibrations",
              value: stats?.totalRecalibrations ?? 0,
              icon: TrendingDown,
              color: "text-orange-400",
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 ${color}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <p className="text-2xl font-bold">{value.toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Avg Session Duration</span>
              </div>
              <p className="text-xl font-bold">{formatDuration(stats?.avgDurationMs)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Simulations Run</span>
              </div>
              <p className="text-xl font-bold">{(stats?.totalSimulations ?? 0).toLocaleString()}</p>
            </CardContent>
          </Card>
        </div>

        <Separator />

        {/* Architecture Overview */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-400" />
              5-Cycle Architecture
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
              {[
                {
                  cycle: "C1",
                  name: "Graph Consolidation",
                  desc: "Orphaned nodes, duplicate edges, stale confidence",
                  icon: Network,
                },
                {
                  cycle: "C2",
                  name: "Pattern Detection",
                  desc: "Contradiction clusters, temporal drift, evidence deserts",
                  icon: Brain,
                },
                {
                  cycle: "C3",
                  name: "Hypothesis Generation",
                  desc: "Topology-derived claims queued for evidence pursuit",
                  icon: FlaskConical,
                },
                {
                  cycle: "C4",
                  name: "Confidence Recalibration",
                  desc: "Temporal decay + contradiction pressure adjustments",
                  icon: TrendingDown,
                },
                {
                  cycle: "C5",
                  name: "Contradiction Simulation",
                  desc: "What-if stress tests with LLM-generated recommendations",
                  icon: Layers,
                },
              ].map(({ cycle, name, desc, icon: Icon }) => (
                <div
                  key={cycle}
                  className="flex flex-col gap-1.5 p-3 rounded-lg border bg-muted/30"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-indigo-400">{cycle}</span>
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-xs">{name}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Separator />

        {/* Session History */}
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Moon className="h-4 w-4 text-indigo-400" />
            Session History
          </h2>
          {sessionsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : !sessions || sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
              <Moon className="h-10 w-10 text-indigo-400/50 mb-3" />
              <p className="font-medium text-muted-foreground">No dream sessions yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Sessions run automatically when the system converges, or trigger one manually above.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Moon className="h-4 w-4 text-indigo-400" />
                      <span className="font-mono text-sm text-muted-foreground">#{s.id}</span>
                      <span className="text-sm">{formatDate(s.startedAt)}</span>
                      {s.manualTrigger && (
                        <Badge variant="outline" className="text-xs">Manual</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {s.cyclesCompleted} cycles · {s.patternsFound} patterns · {formatDuration(s.durationMs)}
                      </span>
                      {wakeReasonBadge(s.reasonForWaking)}
                    </div>
                  </div>
                  {(s.patternLog && s.patternLog.length > 0) || (s.simulationLog && s.simulationLog.length > 0) ? (
                    <SessionRow sessionId={s.id} />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
