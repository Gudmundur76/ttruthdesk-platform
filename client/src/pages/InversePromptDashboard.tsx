import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link } from "wouter";
import { ArrowLeft, RefreshCw, Dna, Zap, GitBranch, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type InferenceType = "gap_fill" | "homology_projection" | "contradiction_chase";
type StatusFilter = "pending" | "queued" | "processing" | "rejected" | "deferred";

interface GeneratedClaim {
  id: number;
  claimText: string;
  claimType: string;
  inferenceType: InferenceType;
  requiredSources: string[] | null;
  sourceQuery: string | null;
  parentVerifications: number[] | null;
  entityId: number | null;
  reasoning: string | null;
  passedGate: boolean | null;
  rejectionReason: string | null;
  status: string;
  priority: number | null;
  coordQueueId: number | null;
  createdAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INFERENCE_LABELS: Record<InferenceType, string> = {
  gap_fill: "Gap Fill",
  homology_projection: "Homology Projection",
  contradiction_chase: "Contradiction Chase",
};

const INFERENCE_COLORS: Record<InferenceType, string> = {
  gap_fill: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  homology_projection: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  contradiction_chase: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  queued:     "bg-green-500/10 text-green-400 border-green-500/20",
  pending:    "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  processing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  rejected:   "bg-red-500/10 text-red-400 border-red-500/20",
  deferred:   "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

function InferenceIcon({ type }: { type: InferenceType }) {
  if (type === "gap_fill") return <Dna className="w-3.5 h-3.5" />;
  if (type === "homology_projection") return <GitBranch className="w-3.5 h-3.5" />;
  return <AlertTriangle className="w-3.5 h-3.5" />;
}

// ─── Metrics card ─────────────────────────────────────────────────────────────

function MetricsPanel() {
  const { data: metrics, isLoading } = trpc.inversePrompt.metrics.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Spinner className="w-4 h-4" /> Loading metrics…</div>;
  if (!metrics) return null;

  const passRate = metrics.total > 0
    ? Math.round(((metrics.total - metrics.rejected - metrics.deferred) / metrics.total) * 100)
    : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[
        { label: "Total Generated", value: metrics.total, color: "text-foreground" },
        { label: "Queued", value: metrics.queued, color: "text-green-400" },
        { label: "Rejected by Gate", value: metrics.rejected, color: "text-red-400" },
        { label: "Deferred", value: metrics.deferred, color: "text-slate-400" },
      ].map(({ label, value, color }) => (
        <Card key={label} className="bg-card/50 border-border/50">
          <CardContent className="pt-4 pb-3">
            <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent>
        </Card>
      ))}

      <Card className="col-span-2 md:col-span-4 bg-card/50 border-border/50">
        <CardContent className="pt-4 pb-3">
          <div className="text-xs text-muted-foreground mb-2">By Inference Type</div>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(metrics.byInferenceType) as [InferenceType, number][]).map(([type, count]) => (
              <div key={type} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${INFERENCE_COLORS[type]}`}>
                <InferenceIcon type={type} />
                {INFERENCE_LABELS[type]}: {count}
              </div>
            ))}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              <Zap className="w-3.5 h-3.5" />
              Gate pass rate: {passRate}%
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Trigger panel ────────────────────────────────────────────────────────────

function TriggerPanel() {
  const utils = trpc.useUtils();
  const trigger = trpc.inversePrompt.trigger.useMutation({
    onSuccess: (result) => {
      toast.success(`Run complete — ${result.queued} claims queued from ${result.entitiesScanned} entities (${result.durationMs}ms)`);
      utils.inversePrompt.metrics.invalidate();
      utils.inversePrompt.list.invalidate();
    },
    onError: (e) => toast.error(`Run failed: ${e.message}`),
  });

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Manual Trigger</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Run the Inverse Prompt Engine across the top N most-connected graph entities.
          Automatically fires after every Supported verdict and every 4 hours via heartbeat.
        </p>
        <Button
          size="sm"
          onClick={() => trigger.mutate({ topN: 20 })}
          disabled={trigger.isPending}
          className="gap-2"
        >
          {trigger.isPending ? <Spinner className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
          {trigger.isPending ? "Running…" : "Run Engine (top 20 entities)"}
        </Button>
        {trigger.data && (
          <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2 font-mono space-y-0.5">
            <div>Entities scanned: {trigger.data.entitiesScanned}</div>
            <div>Candidates generated: {trigger.data.candidatesGenerated}</div>
            <div>Passed gate: {trigger.data.passedGate}</div>
            <div>Queued: <span className="text-green-400">{trigger.data.queued}</span></div>
            <div>Rejected: <span className="text-red-400">{trigger.data.rejected}</span></div>
            <div>Deferred: <span className="text-slate-400">{trigger.data.deferred}</span></div>
            <div>Duplicates skipped: {trigger.data.duplicates}</div>
            <div>Duration: {trigger.data.durationMs}ms</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Claims table ─────────────────────────────────────────────────────────────

function ClaimsTable() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter | "all">("all");
  const [typeFilter, setTypeFilter] = useState<InferenceType | "all">("all");
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading } = trpc.inversePrompt.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    inferenceType: typeFilter === "all" ? undefined : typeFilter,
    limit: 100,
    offset: 0,
  }, { refetchInterval: 60_000 });

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">Generated Claims</CardTitle>
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter | "all")}>
              <SelectTrigger className="h-7 text-xs w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="deferred">Deferred</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as InferenceType | "all")}>
              <SelectTrigger className="h-7 text-xs w-44">
                <SelectValue placeholder="Inference type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="gap_fill">Gap Fill</SelectItem>
                <SelectItem value="homology_projection">Homology Projection</SelectItem>
                <SelectItem value="contradiction_chase">Contradiction Chase</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <div className="flex items-center gap-2 text-muted-foreground text-sm py-4"><Spinner className="w-4 h-4" /> Loading claims…</div>}
        {!isLoading && (!data?.items || data.items.length === 0) && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No generated claims yet. Run the engine to generate claims from the knowledge graph.
          </div>
        )}
        {data?.items && data.items.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground mb-3">{data.total} total claims</div>
            {(data.items as GeneratedClaim[]).map((claim) => (
              <div
                key={claim.id}
                className="border border-border/40 rounded-lg overflow-hidden"
              >
                <button
                  className="w-full text-left p-3 hover:bg-muted/20 transition-colors"
                  onClick={() => setExpanded(expanded === claim.id ? null : claim.id)}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex gap-1.5 flex-shrink-0 mt-0.5">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${INFERENCE_COLORS[claim.inferenceType]}`}>
                        <InferenceIcon type={claim.inferenceType} />
                        {INFERENCE_LABELS[claim.inferenceType]}
                      </span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${STATUS_COLORS[claim.status] ?? ""}`}>
                        {claim.status}
                      </span>
                      {claim.priority !== null && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium bg-muted/30 text-muted-foreground border-border/40">
                          p{claim.priority}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground/90 leading-relaxed flex-1">{claim.claimText}</p>
                  </div>
                </button>
                {expanded === claim.id && (
                  <div className="border-t border-border/40 bg-muted/10 p-3 space-y-2 text-xs">
                    {claim.reasoning && (
                      <div>
                        <span className="text-muted-foreground font-medium">Reasoning: </span>
                        <span className="text-foreground/80">{claim.reasoning}</span>
                      </div>
                    )}
                    {claim.sourceQuery && (
                      <div>
                        <span className="text-muted-foreground font-medium">Source query: </span>
                        <code className="text-foreground/80 bg-muted/30 px-1 rounded">{claim.sourceQuery}</code>
                      </div>
                    )}
                    {claim.requiredSources && claim.requiredSources.length > 0 && (
                      <div className="flex gap-1 items-center flex-wrap">
                        <span className="text-muted-foreground font-medium">Sources: </span>
                        {claim.requiredSources.map((s) => (
                          <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">{s}</Badge>
                        ))}
                      </div>
                    )}
                    {claim.rejectionReason && (
                      <div className="text-red-400">
                        <span className="font-medium">Rejected: </span>{claim.rejectionReason}
                      </div>
                    )}
                    <div className="text-muted-foreground">
                      Entity ID: {claim.entityId ?? "—"} · Coord queue: {claim.coordQueueId ?? "—"} · Created: {new Date(claim.createdAt).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InversePromptDashboard() {
  const { user } = useAuth();

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Admin access required.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" /> Admin
            </Button>
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Inverse Prompt Architecture</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verified graph truth → testable claims → evidence pursuit loop
            </p>
          </div>
        </div>

        {/* Architecture note */}
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-amber-400/90 leading-relaxed">
              <strong>Authority boundary:</strong> This engine has <em>no write access</em> to the knowledge graph.
              It only writes to <code>generated_claims</code> and <code>coord_queue</code>.
              All generated claims must pass four verifiability gates (Assumption, Evidence, Convergence, Determinism)
              before entering the queue.
            </p>
          </CardContent>
        </Card>

        <MetricsPanel />

        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <TriggerPanel />
          </div>
          <div className="md:col-span-2">
            <ClaimsTable />
          </div>
        </div>
      </div>
    </div>
  );
}
