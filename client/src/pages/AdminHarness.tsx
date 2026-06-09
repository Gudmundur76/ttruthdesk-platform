/**
 * AdminHarness — Session Continuity Dashboard
 *
 * Displays the health of the session-management harness:
 * - CONTEXT_SNAPSHOT.md age and line count
 * - HANDOFF.md presence and preview
 * - Last session-audit result
 * - Todo.md progress
 *
 * Provides a "Refresh Snapshot" button that triggers
 * `trpc.admin.refreshSnapshot` on the server.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  FileText,
  Clock,
  ClipboardList,
  Activity,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      variant={ok ? "default" : "destructive"}
      className="gap-1 text-xs font-medium"
    >
      {ok ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
      {label}
    </Badge>
  );
}

function MetricCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-card/60 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminHarness() {
  const [autoRefreshTick, setAutoRefreshTick] = useState(0);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const id = setInterval(() => setAutoRefreshTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading, refetch } = trpc.admin.harnessStatus.useQuery(
    undefined,
    {
      refetchOnWindowFocus: false,
    }
  );

  // Trigger a manual refetch whenever the auto-refresh tick fires
  useEffect(() => {
    if (autoRefreshTick > 0) void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshTick]);

  const refreshMutation = trpc.admin.refreshSnapshot.useMutation({
    onSuccess: result => {
      if (result.success) {
        toast.success("Context snapshot refreshed successfully.");
        void refetch();
      } else {
        toast.error(`Snapshot failed: ${result.message}`);
      }
    },
    onError: err => {
      toast.error(`Error: ${err.message}`);
    },
  });

  const handleRefresh = () => {
    refreshMutation.mutate();
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Session Harness
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Context continuity, session audit, and todo progress at a glance.
            </p>
          </div>
          <Button
            onClick={handleRefresh}
            disabled={refreshMutation.isPending}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshMutation.isPending ? "animate-spin" : ""}`}
            />
            Refresh Snapshot
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : data ? (
          <>
            {/* Row 1: Snapshot + Handoff */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Context Snapshot */}
              <MetricCard icon={FileText} title="Context Snapshot">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      ok={data.snapshot.healthy}
                      label={
                        data.snapshot.healthy ? "Healthy" : "Stale / Missing"
                      }
                    />
                    {data.snapshot.exists && (
                      <span className="text-xs text-muted-foreground">
                        {data.snapshot.lines} lines
                      </span>
                    )}
                  </div>
                  {data.snapshot.ageMinutes !== null ? (
                    <div className="flex items-center gap-1.5 text-sm">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>
                        Last updated{" "}
                        <strong>
                          {data.snapshot.ageMinutes < 1
                            ? "< 1 min"
                            : `${data.snapshot.ageMinutes} min`}{" "}
                          ago
                        </strong>
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-destructive flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      CONTEXT_SNAPSHOT.md not found — run{" "}
                      <code className="font-mono bg-muted px-1 rounded text-xs">
                        pnpm context:snapshot
                      </code>
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Snapshots older than 2 hours are marked stale.
                  </p>
                </div>
              </MetricCard>

              {/* HANDOFF.md */}
              <MetricCard icon={ClipboardList} title="Handoff Document">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    {data.handoff.exists ? (
                      <Badge
                        variant="outline"
                        className="gap-1 text-xs border-amber-500 text-amber-500"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        Pending handoff
                      </Badge>
                    ) : (
                      <Badge
                        variant="default"
                        className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-600"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Clear — no pending work
                      </Badge>
                    )}
                  </div>
                  {data.handoff.exists && data.handoff.preview && (
                    <pre className="text-xs bg-muted/60 rounded p-2 overflow-auto max-h-24 whitespace-pre-wrap font-mono leading-relaxed">
                      {data.handoff.preview}
                    </pre>
                  )}
                  {!data.handoff.exists && (
                    <p className="text-xs text-muted-foreground">
                      No HANDOFF.md found — session is clean.
                    </p>
                  )}
                </div>
              </MetricCard>
            </div>

            {/* Row 2: Session Audit + Todo */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Last Session Audit */}
              <MetricCard icon={Activity} title="Last Session Audit">
                {data.lastAudit ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        ok={data.lastAudit.passed === true}
                        label={
                          data.lastAudit.passed === true
                            ? "Passed"
                            : "Failed / Issues found"
                        }
                      />
                      {typeof data.lastAudit.timestamp === "string" && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(data.lastAudit.timestamp).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {Array.isArray(data.lastAudit.issues) &&
                      (data.lastAudit.issues as string[]).length > 0 && (
                        <ul className="text-xs text-destructive space-y-0.5 list-disc list-inside">
                          {(data.lastAudit.issues as string[])
                            .slice(0, 5)
                            .map((issue, i) => (
                              <li key={i}>{issue}</li>
                            ))}
                        </ul>
                      )}
                    {typeof data.lastAudit.summary === "string" && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {data.lastAudit.summary}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    No audit result found — run{" "}
                    <code className="font-mono bg-muted px-1 rounded text-xs">
                      pnpm session:audit
                    </code>
                  </p>
                )}
              </MetricCard>

              {/* Todo Progress */}
              <MetricCard icon={ClipboardList} title="Todo Progress">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {data.todo.done} done /{" "}
                      {data.todo.done + data.todo.pending} total
                    </span>
                    <span className="font-semibold tabular-nums">
                      {data.todo.percentComplete}%
                    </span>
                  </div>
                  <Progress value={data.todo.percentComplete} className="h-2" />
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      {data.todo.done} completed
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-amber-500" />
                      {data.todo.pending} pending
                    </span>
                  </div>
                </div>
              </MetricCard>
            </div>

            {/* Footer: last checked */}
            <p className="text-xs text-muted-foreground text-right">
              Last checked: {new Date(data.checkedAt).toLocaleString()} ·
              Auto-refreshes every 60 s
            </p>
          </>
        ) : (
          <p className="text-sm text-destructive">
            Failed to load harness status. Check server logs.
          </p>
        )}
      </div>
    </DashboardLayout>
  );
}
