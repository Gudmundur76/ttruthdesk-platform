/**
 * SourceWhitelist.tsx
 * Admin page: Source Whitelist — shows all approved and pending sources,
 * their health status, failure mode, schema, approval gate, and approve/reject actions.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Database,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SourceEntry {
  id: string;
  displayName: string;
  description: string;
  apiBaseUrl: string;
  schema: string[];
  failureMode: "hard_stop" | "degrade";
  approved: boolean;
  approvedAt: string | null;
}

interface HealthResult {
  healthy: boolean;
  latencyMs: number;
  error: string | null;
  checkedAt: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function FailureModeBadge({ mode }: { mode: "hard_stop" | "degrade" }) {
  if (mode === "hard_stop") {
    return (
      <Badge variant="destructive" className="gap-1 text-xs">
        <ShieldAlert className="h-3 w-3" />
        hard stop
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 text-xs">
      <AlertTriangle className="h-3 w-3" />
      degrade
    </Badge>
  );
}

function HealthBadge({ result }: { result: HealthResult | null | undefined }) {
  if (!result) {
    return (
      <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        not checked
      </Badge>
    );
  }
  if (result.healthy) {
    return (
      <Badge variant="outline" className="gap-1 border-green-500 text-xs text-green-600">
        <CheckCircle2 className="h-3 w-3" />
        {result.latencyMs}ms
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-red-500 text-xs text-red-600">
      <XCircle className="h-3 w-3" />
      unhealthy
    </Badge>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function SourceWhitelist() {
  const utils = trpc.useUtils();
  const { data: sources, isLoading } = trpc.sources.list.useQuery();
  const [healthResults, setHealthResults] = useState<Record<string, HealthResult>>({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const healthCheckMutation = trpc.sources.healthCheck.useMutation({
    onSuccess: (result, variables) => {
      setHealthResults((prev) => ({ ...prev, [variables.sourceId]: result }));
      setCheckingId(null);
      toast.success(`Health check complete for ${variables.sourceId}`);
    },
    onError: (err, variables) => {
      setCheckingId(null);
      toast.error(`Health check failed: ${err.message}`);
      setHealthResults((prev) => ({
        ...prev,
        [variables.sourceId]: {
          healthy: false,
          latencyMs: 0,
          error: err.message,
          checkedAt: new Date().toISOString(),
        },
      }));
    },
  });

  const healthCheckAllMutation = trpc.sources.healthCheckAll.useMutation({
    onSuccess: (results) => {
      setHealthResults(results as Record<string, HealthResult>);
      setCheckingAll(false);
      const healthy = Object.values(results).filter((r) => (r as HealthResult).healthy).length;
      const total = Object.keys(results).length;
      toast.success(`Health checks complete: ${healthy}/${total} sources healthy`);
    },
    onError: (err) => {
      setCheckingAll(false);
      toast.error(`Health check all failed: ${err.message}`);
    },
  });

  const approveMutation = trpc.sources.approve.useMutation({
    onSuccess: (_, variables) => {
      toast.success(`Source "${variables.sourceId}" approved and added to the pipeline.`);
      utils.sources.list.invalidate();
    },
    onError: (err) => toast.error(`Approve failed: ${err.message}`),
  });

  const rejectMutation = trpc.sources.reject.useMutation({
    onSuccess: (_, variables) => {
      toast.success(`Source "${variables.sourceId}" rejected.`);
      utils.sources.list.invalidate();
    },
    onError: (err) => toast.error(`Reject failed: ${err.message}`),
  });

  const handleCheckAll = () => {
    setCheckingAll(true);
    healthCheckAllMutation.mutate();
  };

  const handleCheckOne = (sourceId: string) => {
    setCheckingId(sourceId);
    healthCheckMutation.mutate({ sourceId });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const approved = (sources ?? []).filter((s) => s.approved);
  const pending = (sources ?? []).filter((s) => !s.approved);
  const healthyCount = Object.values(healthResults).filter((r) => r.healthy).length;
  const checkedCount = Object.keys(healthResults).length;

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Source Whitelist</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approved data sources for deterministic verdict verification.
            Only whitelisted sources are used in the pipeline.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheckAll}
          disabled={checkingAll}
          className="gap-2"
        >
          {checkingAll ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          Check All Sources
        </Button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <div className="text-2xl font-bold">{approved.length}</div>
          <div className="text-xs text-muted-foreground">Approved Sources</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold">{pending.length}</div>
          <div className="text-xs text-muted-foreground">Pending Approval</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold">
            {checkedCount > 0 ? `${healthyCount}/${checkedCount}` : "—"}
          </div>
          <div className="text-xs text-muted-foreground">Healthy (last check)</div>
        </Card>
        <Card className="p-4">
          <div className="text-2xl font-bold">
            {approved.filter((s) => s.failureMode === "hard_stop").length}
          </div>
          <div className="text-xs text-muted-foreground">Hard Stop Sources</div>
        </Card>
      </div>

      {/* Approved sources */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-green-600" />
          <h2 className="text-lg font-semibold">Approved Sources ({approved.length})</h2>
        </div>
        <div className="space-y-3">
          {approved.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              health={healthResults[source.id] ?? null}
              checking={checkingId === source.id}
              onCheck={() => handleCheckOne(source.id)}
            />
          ))}
        </div>
      </div>

      {/* Pending sources */}
      {pending.length > 0 && (
        <div>
          <Separator className="mb-6" />
          <div className="mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-yellow-500" />
            <h2 className="text-lg font-semibold">Pending Approval ({pending.length})</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            These sources have been identified but not yet approved for use in the verdict pipeline.
            Run a health check before approving.
          </p>
          <div className="space-y-3">
            {pending.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                health={healthResults[source.id] ?? null}
                checking={checkingId === source.id}
                onCheck={() => handleCheckOne(source.id)}
                onApprove={() => approveMutation.mutate({ sourceId: source.id })}
                onReject={() => rejectMutation.mutate({ sourceId: source.id })}
                approving={approveMutation.isPending && approveMutation.variables?.sourceId === source.id}
                rejecting={rejectMutation.isPending && rejectMutation.variables?.sourceId === source.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Source card ───────────────────────────────────────────────────────────────

function SourceCard({
  source,
  health,
  checking,
  onCheck,
  onApprove,
  onReject,
  approving,
  rejecting,
}: {
  source: SourceEntry;
  health: HealthResult | null;
  checking: boolean;
  onCheck: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  approving?: boolean;
  rejecting?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className={`transition-colors ${
        source.approved
          ? "border-border"
          : "border-dashed border-yellow-400/50 bg-yellow-500/5"
      }`}
    >
      <CardHeader className="pb-2 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">{source.displayName}</CardTitle>
            {source.approved ? (
              <Badge variant="outline" className="border-green-500 text-xs text-green-600">
                approved
              </Badge>
            ) : (
              <Badge variant="outline" className="border-yellow-500 text-xs text-yellow-600">
                pending
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <FailureModeBadge mode={source.failureMode} />
            <HealthBadge result={health} />
            <Button
              variant="ghost"
              size="sm"
              onClick={onCheck}
              disabled={checking}
              className="h-7 gap-1 px-2 text-xs"
            >
              {checking ? <Spinner className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}
              Check
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        <p className="mb-3 text-sm text-muted-foreground">{source.description}</p>

        {/* API base URL */}
        <div className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
          <ExternalLink className="h-3 w-3" />
          <a
            href={source.apiBaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {source.apiBaseUrl}
          </a>
        </div>

        {/* Schema tags */}
        <div className="flex flex-wrap gap-1">
          {source.schema.map((field) => (
            <Badge key={field} variant="secondary" className="text-xs">
              {field}
            </Badge>
          ))}
        </div>

        {/* Health detail (expanded) */}
        {health && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? "Hide" : "Show"} health detail
            </button>
            {expanded && (
              <div className="mt-2 rounded-md bg-muted/50 p-3 text-xs">
                <div className="flex gap-4">
                  <span>
                    <span className="font-medium">Status:</span>{" "}
                    {health.healthy ? "✓ Healthy" : "✗ Unhealthy"}
                  </span>
                  <span>
                    <span className="font-medium">Latency:</span> {health.latencyMs}ms
                  </span>
                </div>
                {health.error && (
                  <div className="mt-1 text-red-600">
                    <span className="font-medium">Error:</span> {health.error}
                  </div>
                )}
                <div className="mt-1 text-muted-foreground">
                  Checked: {new Date(health.checkedAt).toLocaleString()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Approval metadata */}
        {source.approvedAt && (
          <div className="mt-2 text-xs text-muted-foreground">
            Approved: {new Date(source.approvedAt).toLocaleDateString()}
          </div>
        )}

        {/* Approve / Reject actions for pending sources */}
        {!source.approved && onApprove && onReject && (
          <div className="mt-4 flex items-center gap-3 border-t border-dashed border-yellow-400/30 pt-4">
            <p className="flex-1 text-xs text-muted-foreground">
              {health?.healthy
                ? "Source is healthy — ready to approve."
                : "Run a health check before approving."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-red-400/50 text-xs text-red-500 hover:bg-red-500/10"
              onClick={onReject}
              disabled={rejecting || approving}
            >
              {rejecting ? <Spinner className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
              Reject
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              onClick={onApprove}
              disabled={approving || rejecting}
            >
              {approving ? <Spinner className="h-3 w-3" /> : <ThumbsUp className="h-3 w-3" />}
              Approve
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
