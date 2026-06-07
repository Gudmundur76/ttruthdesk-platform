import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Cpu, Layers,
  Play, RefreshCw, Shield, ShieldOff, Zap, ChevronDown, ChevronRight,
  BarChart3, List, History
} from "lucide-react";

const EVENT_TYPE_COLORS: Record<string, string> = {
  document_submitted: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  verdict_complete: "bg-green-500/10 text-green-400 border-green-500/20",
  contradiction_found: "bg-red-500/10 text-red-400 border-red-500/20",
  gap_closed: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  source_status_change: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  hypothesis_resolved: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  paper_discovered: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  scheduled_tick: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  manual_trigger: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  loop_action_complete: "bg-teal-500/10 text-teal-400 border-teal-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  processing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  processed: "bg-green-500/10 text-green-400 border-green-500/20",
  skipped: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
};

const LAYER_NAMES = ["L0: Friction", "L1: Truth", "L2: Self-Prompt", "L3: Frontier", "L4: Meta"];

function layerBitmaskToNames(bitmask: number): string[] {
  return LAYER_NAMES.filter((_, i) => (bitmask >> i) & 1);
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelative(ts: Date | string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

export default function AutonomousLoopDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"events" | "runs" | "metrics">("events");
  const [triggerEventType, setTriggerEventType] = useState("scheduled_tick");
  const [safeModeReason, setSafeModeReason] = useState("");

  if (!user || user.role !== "admin") {
    navigate("/");
    return null;
  }

  const utils = trpc.useUtils();

  const { data: status, isLoading: statusLoading } = trpc.autonomousLoop.status.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const { data: eventLog, isLoading: eventsLoading } = trpc.autonomousLoop.eventLog.useQuery({
    limit: 100,
    eventType: eventTypeFilter !== "all" ? eventTypeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter as never : undefined,
  }, { refetchInterval: 15000 });

  const { data: runHistory, isLoading: runsLoading } = trpc.autonomousLoop.runHistory.useQuery(
    { limit: 30 },
    { refetchInterval: 15000 }
  );

  const triggerMutation = trpc.autonomousLoop.triggerEvent.useMutation({
    onSuccess: () => {
      toast.success(`Event "${triggerEventType}" triggered and processed`);
      utils.autonomousLoop.status.invalidate();
      utils.autonomousLoop.eventLog.invalidate();
      utils.autonomousLoop.runHistory.invalidate();
    },
    onError: (e) => toast.error(`Trigger failed: ${e.message}`),
  });

  const drainMutation = trpc.autonomousLoop.drainQueue.useMutation({
    onSuccess: (data) => {
      toast.success(`Drained ${data.processed} pending events`);
      utils.autonomousLoop.status.invalidate();
      utils.autonomousLoop.eventLog.invalidate();
      utils.autonomousLoop.runHistory.invalidate();
    },
    onError: (e) => toast.error(`Drain failed: ${e.message}`),
  });

  const safeModeMutation = trpc.autonomousLoop.setSafeMode.useMutation({
    onSuccess: (data) => {
      toast.success(data.safeMode ? "Safe mode enabled" : "Safe mode disabled");
      utils.autonomousLoop.status.invalidate();
    },
    onError: (e) => toast.error(`Safe mode toggle failed: ${e.message}`),
  });

  const handleSafeModeToggle = (enabled: boolean) => {
    safeModeMutation.mutate({ enabled, reason: safeModeReason || undefined });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <Activity className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Autonomous Loop</h1>
              <p className="text-xs text-muted-foreground">Event-driven orchestration across all 5 layers</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {status?.safeMode ? (
              <Badge className="bg-red-500/10 text-red-400 border-red-500/20 gap-1">
                <Shield className="h-3 w-3" /> Safe Mode Active
              </Badge>
            ) : (
              <Badge className="bg-green-500/10 text-green-400 border-green-500/20 gap-1">
                <Zap className="h-3 w-3" /> Running
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                utils.autonomousLoop.status.invalidate();
                utils.autonomousLoop.eventLog.invalidate();
                utils.autonomousLoop.runHistory.invalidate();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Metrics row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Last Run</span>
              </div>
              <p className="text-lg font-semibold">{statusLoading ? "…" : formatRelative(status?.lastRun?.createdAt)}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Total Events</span>
              </div>
              <p className="text-lg font-semibold">{statusLoading ? "…" : (status?.totalEvents ?? 0).toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Cpu className="h-4 w-4 text-yellow-400" />
                <span className="text-xs text-muted-foreground">Pending</span>
              </div>
              <p className="text-lg font-semibold text-yellow-400">{statusLoading ? "…" : (status?.pendingEvents ?? 0)}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Last Run Layers</span>
              </div>
              <p className="text-sm font-medium">
                {statusLoading ? "…" : status?.lastRun
                  ? layerBitmaskToNames(status.lastRun.layersExecuted).length + " layers"
                  : "—"}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main panel */}
          <div className="lg:col-span-2 space-y-4">
            {/* Tab bar */}
            <div className="flex gap-1 border-b border-border">
              {(["events", "runs", "metrics"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                    activeTab === tab
                      ? "border-violet-500 text-violet-400"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "events" && <List className="h-3.5 w-3.5 inline mr-1.5" />}
                  {tab === "runs" && <History className="h-3.5 w-3.5 inline mr-1.5" />}
                  {tab === "metrics" && <BarChart3 className="h-3.5 w-3.5 inline mr-1.5" />}
                  {tab}
                </button>
              ))}
            </div>

            {/* Events tab */}
            {activeTab === "events" && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
                    <SelectTrigger className="w-48 h-8 text-xs">
                      <SelectValue placeholder="Event type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {Object.keys(EVENT_TYPE_COLORS).map((t) => (
                        <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-36 h-8 text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="processed">Processed</SelectItem>
                      <SelectItem value="skipped">Skipped</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {eventsLoading ? (
                  <div className="flex justify-center py-12"><Spinner /></div>
                ) : !eventLog?.length ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">No events found</div>
                ) : (
                  <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
                    {eventLog.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/40 bg-card/30 hover:bg-card/60 transition-colors text-sm"
                      >
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${EVENT_TYPE_COLORS[ev.eventType] ?? "bg-muted text-muted-foreground"}`}>
                          {ev.eventType.replace(/_/g, " ")}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[ev.status] ?? ""}`}>
                          {ev.status}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto">{formatRelative(ev.createdAt)}</span>
                        {ev.skipReason && (
                          <span className="text-xs text-muted-foreground italic truncate max-w-32" title={ev.skipReason}>
                            {ev.skipReason}
                          </span>
                        )}
                        {ev.errorMessage && (
                          <span title={ev.errorMessage ?? undefined}><AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" /></span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Runs tab */}
            {activeTab === "runs" && (
              <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                {runsLoading ? (
                  <div className="flex justify-center py-12"><Spinner /></div>
                ) : !runHistory?.length ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">No runs yet</div>
                ) : (
                  runHistory.map((run) => (
                    <div key={run.id} className="border border-border/40 rounded-lg bg-card/30">
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-card/60 transition-colors rounded-lg"
                        onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                      >
                        {expandedRun === run.id ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${EVENT_TYPE_COLORS[run.eventType] ?? "bg-muted text-muted-foreground"}`}>
                          {run.eventType.replace(/_/g, " ")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {layerBitmaskToNames(run.layersExecuted).length} layers
                        </span>
                        {run.converged && (
                          <span title="Converged"><CheckCircle2 className="h-3.5 w-3.5 text-green-400" /></span>
                        )}
                        {run.safeModeTriggered && (
                          <span title="Safe mode triggered"><Shield className="h-3.5 w-3.5 text-red-400" /></span>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">{formatDuration(run.durationMs)}</span>
                        <span className="text-xs text-muted-foreground">{formatRelative(run.createdAt)}</span>
                      </button>

                      {expandedRun === run.id && (
                        <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3">
                          <div className="flex flex-wrap gap-1.5">
                            {layerBitmaskToNames(run.layersExecuted).map((l) => (
                              <span key={l} className="text-xs px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">{l}</span>
                            ))}
                          </div>
                          {run.convergenceReason && (
                            <p className="text-xs text-muted-foreground italic">Convergence: {run.convergenceReason}</p>
                          )}
                          {Array.isArray(run.actionsExecuted) && run.actionsExecuted.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</p>
                              {run.actionsExecuted.map((action, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs">
                                  <span className={`mt-0.5 flex-shrink-0 ${
                                    action.result === "success" ? "text-green-400" :
                                    action.result === "failed" ? "text-red-400" : "text-muted-foreground"
                                  }`}>
                                    {action.result === "success" ? "✓" : action.result === "failed" ? "✗" : "–"}
                                  </span>
                                  <span className="text-muted-foreground font-mono">[{action.type}]</span>
                                  <span>{action.description}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Metrics tab */}
            {activeTab === "metrics" && (
              <div className="space-y-4">
                {runsLoading ? (
                  <div className="flex justify-center py-12"><Spinner /></div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Total Runs", value: runHistory?.length ?? 0 },
                        { label: "Converged", value: runHistory?.filter(r => r.converged).length ?? 0 },
                        { label: "Safe Mode Triggered", value: runHistory?.filter(r => r.safeModeTriggered).length ?? 0 },
                        { label: "Avg Duration", value: formatDuration(
                          runHistory && runHistory.length > 0
                            ? Math.round(runHistory.reduce((s, r) => s + (r.durationMs ?? 0), 0) / runHistory.length)
                            : null
                        )},
                      ].map(({ label, value }) => (
                        <Card key={label} className="border-border/50">
                          <CardContent className="pt-3 pb-3">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className="text-xl font-semibold mt-0.5">{value}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    <Card className="border-border/50">
                      <CardHeader className="pb-2 pt-4 px-4">
                        <CardTitle className="text-sm">Layer Activation Frequency</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        {LAYER_NAMES.map((name, i) => {
                          const count = runHistory?.filter(r => (r.layersExecuted >> i) & 1).length ?? 0;
                          const pct = runHistory?.length ? Math.round((count / runHistory.length) * 100) : 0;
                          return (
                            <div key={name} className="flex items-center gap-3 py-1.5">
                              <span className="text-xs text-muted-foreground w-28 flex-shrink-0">{name}</span>
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-violet-500 rounded-full transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right sidebar — controls */}
          <div className="space-y-4">
            {/* Safe mode control */}
            <Card className="border-border/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  {status?.safeMode ? (
                    <Shield className="h-4 w-4 text-red-400" />
                  ) : (
                    <ShieldOff className="h-4 w-4 text-green-400" />
                  )}
                  Safe Mode
                </CardTitle>
                <CardDescription className="text-xs">
                  When enabled, the loop halts all autonomous actions
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={status?.safeMode ?? false}
                    onCheckedChange={handleSafeModeToggle}
                    disabled={safeModeMutation.isPending || statusLoading}
                  />
                  <Label className="text-sm">{status?.safeMode ? "Enabled" : "Disabled"}</Label>
                </div>
                {!status?.safeMode && (
                  <input
                    className="w-full text-xs bg-muted/50 border border-border rounded px-2 py-1.5 placeholder:text-muted-foreground"
                    placeholder="Reason (optional)"
                    value={safeModeReason}
                    onChange={(e) => setSafeModeReason(e.target.value)}
                  />
                )}
              </CardContent>
            </Card>

            {/* Manual trigger */}
            <Card className="border-border/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Play className="h-4 w-4 text-violet-400" /> Trigger Event
                </CardTitle>
                <CardDescription className="text-xs">
                  Publish and immediately process an event
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <Select value={triggerEventType} onValueChange={setTriggerEventType}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(EVENT_TYPE_COLORS).map((t) => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={triggerMutation.isPending || status?.safeMode}
                  onClick={() => triggerMutation.mutate({ eventType: triggerEventType })}
                >
                  {triggerMutation.isPending ? <Spinner className="h-3.5 w-3.5 mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                  Trigger
                </Button>
                {status?.safeMode && (
                  <p className="text-xs text-red-400 text-center">Disabled in safe mode</p>
                )}
              </CardContent>
            </Card>

            {/* Drain queue */}
            <Card className="border-border/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-400" /> Drain Queue
                </CardTitle>
                <CardDescription className="text-xs">
                  Process up to 10 pending events immediately
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={drainMutation.isPending || (status?.pendingEvents ?? 0) === 0}
                  onClick={() => drainMutation.mutate({ maxEvents: 10 })}
                >
                  {drainMutation.isPending ? <Spinner className="h-3.5 w-3.5 mr-1.5" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                  Drain ({status?.pendingEvents ?? 0} pending)
                </Button>
              </CardContent>
            </Card>

            {/* Layer legend */}
            <Card className="border-border/50">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm">Layer Architecture</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {[
                  { name: "L0: Friction", desc: "Intent & assumption gate", color: "bg-blue-500" },
                  { name: "L1: Truth", desc: "Re-verify changed sources", color: "bg-green-500" },
                  { name: "L2: Self-Prompt", desc: "Meaning-making & reasoning", color: "bg-violet-500" },
                  { name: "L3: Frontier", desc: "Gap mapping & evidence", color: "bg-orange-500" },
                  { name: "L4: Meta", desc: "Health checks & safe mode", color: "bg-red-500" },
                ].map(({ name, desc, color }) => (
                  <div key={name} className="flex items-start gap-2.5">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${color}`} />
                    <div>
                      <p className="text-xs font-medium">{name}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
