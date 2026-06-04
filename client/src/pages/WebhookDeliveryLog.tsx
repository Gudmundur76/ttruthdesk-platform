import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Trash2,
  Activity,
  Zap,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  timeout: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  retry_pending: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="w-3.5 h-3.5" />,
  failed: <XCircle className="w-3.5 h-3.5" />,
  timeout: <Clock className="w-3.5 h-3.5" />,
  retry_pending: <RefreshCw className="w-3.5 h-3.5" />,
};

type StatusFilter = "all" | "success" | "failed" | "timeout" | "retry_pending";

export default function WebhookDeliveryLog() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const PAGE_SIZE = 25;

  const utils = trpc.useUtils();

  const { data: stats, isLoading: statsLoading } = trpc.deliveryLog.stats.useQuery({});

  const { data: log, isLoading: logLoading } = trpc.deliveryLog.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const retryMutation = trpc.deliveryLog.retry.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      utils.deliveryLog.list.invalidate();
      utils.deliveryLog.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const pruneMutation = trpc.deliveryLog.prune.useMutation({
    onSuccess: (result) => {
      toast.success(`Pruned ${result.pruned} old log entries`);
      utils.deliveryLog.list.invalidate();
      utils.deliveryLog.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const totalPages = log ? Math.ceil(log.total / PAGE_SIZE) : 0;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Webhook Delivery Log</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor outbound webhook deliveries, retry failures, and manage log history.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => pruneMutation.mutate()}
            disabled={pruneMutation.isPending}
            className="gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Prune (90d+)
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}><CardContent className="pt-6"><Skeleton className="h-12 w-full" /></CardContent></Card>
            ))
          ) : stats ? (
            <>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <Activity className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Deliveries</p>
                      <p className="text-2xl font-bold">{stats.total.toLocaleString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Success Rate</p>
                      <p className="text-2xl font-bold">{stats.successRate}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                      <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Retry Pending</p>
                      <p className="text-2xl font-bold">{stats.retryPending}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                      <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Avg Latency</p>
                      <p className="text-2xl font-bold">{stats.avgLatency}ms</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>

        {/* Last 24h summary */}
        {stats && (
          <Card className="border-dashed">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-6 text-sm">
                <span className="text-muted-foreground font-medium">Last 24h:</span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  {stats.last24h.total} total
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {stats.last24h.success} succeeded
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {stats.last24h.failed} failed
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as StatusFilter); setPage(0); }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="timeout">Timeout</SelectItem>
              <SelectItem value="retry_pending">Retry Pending</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {log ? `${log.total.toLocaleString()} entries` : ""}
          </span>
        </div>

        {/* Log Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Delivery History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {logLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !log?.entries.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <AlertTriangle className="w-8 h-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">No delivery log entries found.</p>
                <p className="text-xs text-muted-foreground mt-1">Webhook deliveries will appear here once your first alert fires.</p>
              </div>
            ) : (
              <div className="divide-y">
                {log.entries.map((entry) => (
                  <div key={entry.id} className="group">
                    <div
                      className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                      {/* Status badge */}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[entry.status]}`}>
                        {STATUS_ICONS[entry.status]}
                        {entry.status.replace("_", " ")}
                      </span>

                      {/* Event type */}
                      <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        {entry.eventType}
                      </span>

                      {/* URL (truncated) */}
                      <span className="text-sm text-muted-foreground truncate flex-1 min-w-0">
                        {entry.url}
                      </span>

                      {/* Latency */}
                      {entry.latencyMs !== null && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {entry.latencyMs}ms
                        </span>
                      )}

                      {/* HTTP status */}
                      {entry.httpStatus !== null && (
                        <Badge variant={entry.httpStatus && entry.httpStatus < 300 ? "default" : "destructive"} className="text-xs">
                          {entry.httpStatus}
                        </Badge>
                      )}

                      {/* Attempt count */}
                      {(entry.attemptCount ?? 1) > 1 && (
                        <span className="text-xs text-muted-foreground">
                          attempt {entry.attemptCount}
                        </span>
                      )}

                      {/* Timestamp */}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>

                      {/* Retry button */}
                      {(entry.status === "failed" || entry.status === "timeout" || entry.status === "retry_pending") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            retryMutation.mutate({ deliveryLogId: entry.id });
                          }}
                          disabled={retryMutation.isPending}
                        >
                          <RefreshCw className="w-3 h-3" />
                          Retry
                        </Button>
                      )}
                    </div>

                    {/* Expanded detail */}
                    {expandedId === entry.id && (
                      <div className="px-4 pb-4 bg-muted/20 border-t space-y-3">
                        {entry.errorMsg && (
                          <div className="mt-3">
                            <p className="text-xs font-medium text-muted-foreground mb-1">Error</p>
                            <p className="text-sm text-red-600 dark:text-red-400 font-mono">{entry.errorMsg}</p>
                          </div>
                        )}
                        {entry.responseBody && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Response Body</p>
                            <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-32 font-mono">
                              {entry.responseBody}
                            </pre>
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Payload</p>
                          <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-48 font-mono">
                            {JSON.stringify(entry.payload, null, 2)}
                          </pre>
                        </div>
                        {entry.nextRetryAt && (
                          <p className="text-xs text-muted-foreground">
                            Next retry scheduled: {new Date(entry.nextRetryAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
