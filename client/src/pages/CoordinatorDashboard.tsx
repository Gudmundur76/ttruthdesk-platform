import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  RefreshCw,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";

// ─── Status badge helpers ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  running: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  stalled: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  completed: "bg-sky-500/15 text-sky-400 border-sky-500/30",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

// ─── Queue stats table ────────────────────────────────────────────────────────

function QueueStatsTable({
  stats,
}: {
  stats: Record<string, Record<string, number>>;
}) {
  const verticals = Object.keys(stats);
  if (verticals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No queue data yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-2 pr-4 font-medium">Vertical</th>
            <th className="text-right py-2 px-3 font-medium">Pending</th>
            <th className="text-right py-2 px-3 font-medium">Claimed</th>
            <th className="text-right py-2 px-3 font-medium">Completed</th>
            <th className="text-right py-2 px-3 font-medium">Failed</th>
            <th className="text-right py-2 pl-3 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {verticals.map((v) => {
            const s = stats[v];
            return (
              <tr key={v} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-2 pr-4 font-mono text-xs">{v}</td>
                <td className="text-right py-2 px-3 text-amber-400">{s.pending ?? 0}</td>
                <td className="text-right py-2 px-3 text-sky-400">{s.claimed ?? 0}</td>
                <td className="text-right py-2 px-3 text-emerald-400">{s.completed ?? 0}</td>
                <td className="text-right py-2 px-3 text-red-400">{s.failed ?? 0}</td>
                <td className="text-right py-2 pl-3 text-foreground font-medium">{s.total ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────

type CoordTask = {
  id: number;
  taskId: string;
  manusTaskId: string | null;
  vertical: string;
  phase: string;
  status: string;
  itemsCompleted: number;
  startedAt: Date | string;
  lastHeartbeatAt: Date | string;
  completedAt: Date | string | null;
  errorMsg: string | null;
};

function TaskRow({
  task,
  onForceFail,
  onDelete,
}: {
  task: CoordTask;
  onForceFail: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}) {
  const isStale =
    task.status === "running" &&
    Date.now() - new Date(task.lastHeartbeatAt).getTime() > 5 * 60_000;

  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 text-sm">
      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground max-w-[120px] truncate">
        {task.taskId}
      </td>
      <td className="py-2 pr-3 font-mono text-xs">{task.vertical}</td>
      <td className="py-2 pr-3">
        <StatusBadge status={isStale ? "stalled" : task.status} />
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{task.phase}</td>
      <td className="py-2 pr-3 text-right text-xs">{task.itemsCompleted}</td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">
        {relativeTime(task.lastHeartbeatAt)}
        {isStale && (
          <span className="ml-1 text-orange-400 text-[10px]">⚠ stale</span>
        )}
      </td>
      <td className="py-2 pl-1 flex gap-1 justify-end">
        {task.status !== "completed" && task.status !== "failed" && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-orange-400 hover:text-orange-300"
            title="Force fail"
            onClick={() => onForceFail(task.taskId)}
          >
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-red-400"
          title="Delete"
          onClick={() => onDelete(task.taskId)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export default function CoordinatorDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState("tasks");

  const { data, isLoading, refetch } = trpc.coordinator.summary.useQuery(
    undefined,
    { refetchInterval: 15_000 }
  );

  const forceFail = trpc.coordinator.forceFailTask.useMutation({
    onSuccess: () => {
      toast.success("Task marked as failed");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteTask = trpc.coordinator.deleteTask.useMutation({
    onSuccess: () => {
      toast.success("Task deleted");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!user || (user.role !== "admin" && user.openId !== undefined)) {
    // Non-admin users see a minimal message; the server will also reject the query
  }

  const tasks = (data?.tasks ?? []) as CoordTask[];
  const queueStats = data?.queueStats ?? {};
  const recentErrors = (data?.recentErrors ?? []) as CoordTask[];

  // Summary metrics
  const runningCount = tasks.filter((t) => t.status === "running").length;
  const stalledCount = tasks.filter(
    (t) =>
      t.status === "running" &&
      Date.now() - new Date(t.lastHeartbeatAt).getTime() > 5 * 60_000
  ).length;
  const totalPending = Object.values(queueStats).reduce(
    (acc, v) => acc + (v.pending ?? 0),
    0
  );
  const totalCompleted = Object.values(queueStats).reduce(
    (acc, v) => acc + (v.completed ?? 0),
    0
  );

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Zap className="h-6 w-6 text-amber-400" />
              Coordinator
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Live view of Manus task swarm — queue depth, task health, and
              context store
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "Running Tasks",
              value: isLoading ? "—" : runningCount,
              icon: Activity,
              color: "text-emerald-400",
            },
            {
              label: "Stalled Tasks",
              value: isLoading ? "—" : stalledCount,
              icon: AlertTriangle,
              color: "text-orange-400",
            },
            {
              label: "Queue Pending",
              value: isLoading ? "—" : totalPending,
              icon: Clock,
              color: "text-amber-400",
            },
            {
              label: "Items Completed",
              value: isLoading ? "—" : totalCompleted,
              icon: CheckCircle2,
              color: "text-sky-400",
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="bg-card/60 border-border/60">
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className={`h-8 w-8 ${color} shrink-0`} />
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-muted/50">
            <TabsTrigger value="tasks">Active Tasks</TabsTrigger>
            <TabsTrigger value="queue">Queue Stats</TabsTrigger>
            <TabsTrigger value="errors">Recent Errors</TabsTrigger>
          </TabsList>

          {/* Active Tasks */}
          <TabsContent value="tasks" className="mt-4">
            <Card className="bg-card/60 border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-400" />
                  Active Tasks
                  {!isLoading && (
                    <Badge variant="secondary" className="ml-auto">
                      {tasks.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No active tasks. Spawn some Manus tasks to see them here.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-xs">
                          <th className="text-left py-2 pr-3 font-medium">Task ID</th>
                          <th className="text-left py-2 pr-3 font-medium">Vertical</th>
                          <th className="text-left py-2 pr-3 font-medium">Status</th>
                          <th className="text-left py-2 pr-3 font-medium">Phase</th>
                          <th className="text-right py-2 pr-3 font-medium">Done</th>
                          <th className="text-left py-2 pr-3 font-medium">Heartbeat</th>
                          <th className="text-right py-2 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((task) => (
                          <TaskRow
                            key={task.taskId}
                            task={task}
                            onForceFail={(id) =>
                              forceFail.mutate({ taskId: id })
                            }
                            onDelete={(id) =>
                              deleteTask.mutate({ taskId: id })
                            }
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Queue Stats */}
          <TabsContent value="queue" className="mt-4">
            <Card className="bg-card/60 border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4 text-amber-400" />
                  Work Queue by Vertical
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-2">
                    {[...Array(6)].map((_, i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : (
                  <QueueStatsTable stats={queueStats} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Recent Errors */}
          <TabsContent value="errors" className="mt-4">
            <Card className="bg-card/60 border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                  Recent Failures (last 1h)
                  {!isLoading && recentErrors.length > 0 && (
                    <Badge variant="destructive" className="ml-auto">
                      {recentErrors.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : recentErrors.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    No failures in the last hour.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {recentErrors.map((t) => (
                      <div
                        key={t.taskId}
                        className="rounded-lg border border-red-500/20 bg-red-500/5 p-3"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-mono text-xs text-muted-foreground">
                            {t.taskId}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {relativeTime(t.completedAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="text-[10px]">
                            {t.vertical}
                          </Badge>
                          <span className="text-muted-foreground">{t.phase}</span>
                        </div>
                        {t.errorMsg && (
                          <p className="mt-1.5 text-xs text-red-400 font-mono break-all">
                            {t.errorMsg}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
