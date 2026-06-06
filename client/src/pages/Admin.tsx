import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Copy, CheckCircle2, RotateCcw, ShieldAlert, KeyRound, Activity, AlertTriangle, CheckCircle, XCircle, Clock, Cpu, BarChart3, Ban, RefreshCw } from "lucide-react";

// ─── Meta-Agent Panel ─────────────────────────────────────────────────────────

type MetaReport = {
  healthScore: number;
  healthGrade: string;
  criticalCount: number;
  warningCount: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  drift: Record<string, { status: string; summary: string }>;
  stubs: {
    total: number;
    overdue: number;
    byPriority: Record<string, number>;
    overdueEscalations: Array<{
      id: string;
      file: string;
      line: number;
      priority: string;
      daysOverdue: number;
      escalationReason: string;
      suggestedAction: string;
    }>;
  };
  pipeline: {
    overallStatus: string;
    failCount: number;
    warnCount: number;
    invariants: Array<{
      name: string;
      status: string;
      threshold: string;
      actual: string;
      severity: string;
    }>;
  };
};

function gradeColor(grade: string) {
  if (grade === "A") return "text-emerald-600";
  if (grade === "B") return "text-blue-600";
  if (grade === "C") return "text-amber-600";
  if (grade === "D") return "text-orange-600";
  return "text-red-600";
}

function statusIcon(status: string) {
  if (status === "pass" || status === "info" || status === "ok") return <CheckCircle className="w-4 h-4 text-emerald-500" />;
  if (status === "warn" || status === "warning") return <AlertTriangle className="w-4 h-4 text-amber-500" />;
  return <XCircle className="w-4 h-4 text-red-500" />;
}

function MetaAgentPanel() {
  const [report, setReport] = useState<MetaReport | null>(null);
  const run = trpc.admin.metaAgentStatus.useMutation({
    onSuccess: (data) => {
      setReport(data as MetaReport);
      toast.success(`Meta-agent complete — Health: ${data.healthScore}/100 (${data.healthGrade})`);
    },
    onError: (err) => toast.error(`Meta-agent failed: ${err.message}`),
  });

  return (
    <div className="bg-slate-50 rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-violet-600" />
          <h2 className="font-semibold text-slate-900">Code Guardian (Meta-Agent)</h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="gap-1.5"
        >
          <Activity className="w-3.5 h-3.5" />
          {run.isPending ? "Running…" : "Run Now"}
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Runs all four meta-agent layers: structural drift, stub ledger, pipeline invariants, and alert routing.
        Fires automatically as Agent 7 on every swarm tick.
      </p>

      {report && (
        <div className="space-y-4">
          {/* Health Score */}
          <div className="flex items-center gap-4 p-3 bg-white rounded-lg border border-border">
            <div className="text-center">
              <div className={`text-3xl font-bold ${gradeColor(report.healthGrade)}`}>{report.healthScore}</div>
              <div className="text-xs text-slate-500">/ 100</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${gradeColor(report.healthGrade)}`}>{report.healthGrade}</div>
              <div className="text-xs text-slate-500">Grade</div>
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex gap-3 text-xs">
                <span className="text-red-600 font-medium">{report.criticalCount} critical</span>
                <span className="text-amber-600 font-medium">{report.warningCount} warnings</span>
                <span className="text-slate-500">{report.stubs.overdue} overdue stubs</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <Clock className="w-3 h-3" />
                {report.durationMs}ms • {new Date(report.completedAt).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Code Drift */}
          <div>
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Code Drift</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(report.drift).map(([key, val]) => (
                <div key={key} className="flex items-start gap-2 p-2 bg-white rounded border border-border">
                  {statusIcon(val.status)}
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 capitalize">{key}</div>
                    <div className="text-xs text-slate-500 truncate" title={val.summary}>{val.summary.slice(0, 60)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pipeline Invariants */}
          <div>
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
              Pipeline Invariants
              <Badge variant="outline" className={`ml-2 text-xs ${report.pipeline.overallStatus === "pass" ? "border-emerald-300 text-emerald-700" : report.pipeline.overallStatus === "warn" ? "border-amber-300 text-amber-700" : "border-red-300 text-red-700"}`}>
                {report.pipeline.overallStatus.toUpperCase()}
              </Badge>
            </h3>
            <div className="space-y-1.5">
              {report.pipeline.invariants.map((inv) => (
                <div key={inv.name} className="flex items-center gap-2 p-2 bg-white rounded border border-border">
                  {statusIcon(inv.status)}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-slate-700">{inv.name}</span>
                    <span className="text-xs text-slate-400 ml-2">{inv.actual}</span>
                  </div>
                  <span className="text-xs text-slate-400 hidden sm:block">{inv.threshold}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stub Ledger */}
          <div>
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Stub Ledger</h3>
            <div className="flex gap-4 text-xs mb-2">
              <span className="text-slate-600">{report.stubs.total} total</span>
              <span className={report.stubs.overdue > 0 ? "text-red-600 font-medium" : "text-slate-500"}>{report.stubs.overdue} overdue</span>
              {Object.entries(report.stubs.byPriority).map(([p, count]) => (
                <span key={p} className="text-slate-500">{p}: {count}</span>
              ))}
            </div>
            {report.stubs.overdueEscalations.length > 0 && (
              <div className="space-y-1.5">
                {report.stubs.overdueEscalations.slice(0, 5).map((esc) => (
                  <div key={esc.id} className="flex items-start gap-2 p-2 bg-amber-50 rounded border border-amber-200">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-amber-800">[{esc.priority}] {esc.file}:{esc.line}</div>
                      <div className="text-xs text-amber-700">{esc.escalationReason}</div>
                      <div className="text-xs text-amber-600 italic">{esc.suggestedAction}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          toast.success(`${label ?? "Value"} copied`);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
      title={`Copy ${label ?? "value"}`}
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── LLM Provider Quality Panel ─────────────────────────────────────────────

type LlmQualityRow = {
  id: number;
  modelId: string;
  modelName: string;
  provider: string;
  isFree: boolean;
  allowedForHighStakes: boolean;
  totalClaims: number;
  correctPredictions: number;
  accuracyRate: number | null;
  avgConfidence: number | null;
  isBanned: boolean;
  banReason: string | null;
  lastUpdatedAt: string | Date;
};

function LlmProviderQualityPanel() {
  const utils = trpc.useUtils();
  const [banModelId, setBanModelId] = useState<string | null>(null);
  const [banReason, setBanReason] = useState("");

  const { data: models, isLoading } = trpc.admin.llmProviderQuality.useQuery();

  const recompute = trpc.admin.recomputeLlmAccuracy.useMutation({
    onSuccess: () => {
      toast.success("Accuracy rates recomputed");
      utils.admin.llmProviderQuality.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const seed = trpc.admin.seedLlmModels.useMutation({
    onSuccess: () => {
      toast.success("Known models seeded");
      utils.admin.llmProviderQuality.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const ban = trpc.admin.banLlmModel.useMutation({
    onSuccess: () => {
      toast.success(`Model banned from high-stakes verdicts`);
      setBanModelId(null);
      setBanReason("");
      utils.admin.llmProviderQuality.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const unban = trpc.admin.unbanLlmModel.useMutation({
    onSuccess: () => {
      toast.success("Model unbanned");
      utils.admin.llmProviderQuality.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = (models ?? []) as LlmQualityRow[];

  return (
    <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-slate-600" />
          <div>
            <h2 className="font-semibold text-slate-900">LLM Provider Quality</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Per-model accuracy tracking. Free models below 70% accuracy are auto-banned from high-stakes verdicts.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => seed.mutate()}
            disabled={seed.isPending}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Seed Models
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Recompute Accuracy
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-slate-400 mb-3">No models tracked yet. Click "Seed Models" to populate known models.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-3 font-medium text-slate-500">Model</th>
                <th className="pb-2 pr-3 font-medium text-slate-500">Provider</th>
                <th className="pb-2 pr-3 font-medium text-slate-500 text-right">Claims</th>
                <th className="pb-2 pr-3 font-medium text-slate-500 text-right">Accuracy</th>
                <th className="pb-2 pr-3 font-medium text-slate-500">High-Stakes</th>
                <th className="pb-2 font-medium text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.modelId} className="border-b border-border/50 hover:bg-slate-50">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-800 truncate max-w-[180px]" title={m.modelId}>
                      {m.modelName}
                    </div>
                    <div className="text-slate-400 font-mono truncate max-w-[180px]" title={m.modelId}>
                      {m.modelId}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant="outline" className="text-xs">
                      {m.provider}
                    </Badge>
                    {m.isFree && (
                      <Badge variant="secondary" className="text-xs ml-1 bg-amber-50 text-amber-700 border-amber-200">
                        free
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{m.totalClaims}</td>
                  <td className="py-2 pr-3 text-right">
                    {m.accuracyRate !== null && m.accuracyRate !== undefined ? (
                      <span className={m.accuracyRate >= 0.7 ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
                        {(m.accuracyRate * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {m.isBanned ? (
                      <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
                        <Ban className="w-3 h-3 mr-1" />
                        Banned
                      </Badge>
                    ) : m.allowedForHighStakes ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Allowed
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Restricted
                      </Badge>
                    )}
                  </td>
                  <td className="py-2">
                    {m.isBanned ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-6 px-2"
                        onClick={() => unban.mutate({ modelId: m.modelId })}
                        disabled={unban.isPending}
                      >
                        Unban
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-6 px-2 text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => setBanModelId(m.modelId)}
                      >
                        <Ban className="w-3 h-3 mr-1" />
                        Ban
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Ban confirmation dialog */}
      {banModelId && (
        <div className="mt-4 border border-red-200 rounded-lg p-4 bg-red-50">
          <p className="text-sm font-semibold text-red-700 mb-2">Ban model from high-stakes verdicts</p>
          <p className="text-xs text-red-600 mb-3">Model: <code className="font-mono">{banModelId}</code></p>
          <textarea
            className="w-full text-xs border border-red-200 rounded p-2 mb-3 bg-white resize-none"
            rows={2}
            placeholder="Reason for ban (required, min 10 characters)"
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-xs"
              disabled={ban.isPending || banReason.trim().length < 10}
              onClick={() => ban.mutate({ modelId: banModelId, reason: banReason })}
            >
              Confirm Ban
            </Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => { setBanModelId(null); setBanReason(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Key Rotation Card ────────────────────────────────────────────────────────

function KeyRotationCard() {
  const utils = trpc.useUtils();
  const [result, setResult] = useState<{
    oldKid: string;
    newKid: string;
    secretPersisted: boolean;
    message: string;
  } | null>(null);

  const rotate = trpc.admin.rotateJwksKey.useMutation({
    onSuccess: (data) => {
      setResult(data);
      if (data.secretPersisted) {
        toast.success("Key rotated and persisted. Re-deploy to activate.");
      } else {
        toast.warning("Key generated but not auto-persisted. Update JWKS_PRIVATE_KEY manually.");
      }
      utils.admin.backfillStatus.invalidate();
    },
    onError: (e) => toast.error(`Rotation failed: ${e.message}`),
  });

  return (
    <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <KeyRound className="w-5 h-5 text-slate-600 mt-0.5 flex-shrink-0" />
        <div>
          <h2 className="font-semibold text-slate-900">JWKS Key Rotation</h2>
          <p className="text-sm text-slate-500 mt-1">
            Generates a new RSA-2048 key pair, stores the private key as{" "}
            <code className="text-slate-700 bg-slate-100 px-1 rounded">JWKS_PRIVATE_KEY</code>, and
            appends the old <code className="text-slate-700 bg-slate-100 px-1 rounded">kid</code> to the
            wiki audit log. Re-deploy is required to activate the new key. Existing bearer tokens remain
            valid until their <code className="text-slate-700 bg-slate-100 px-1 rounded">exp</code> claim.
          </p>
        </div>
      </div>

      {result ? (
        <div className="space-y-3">
          <div
            className={`rounded-lg border p-4 text-sm space-y-2 ${
              result.secretPersisted
                ? "bg-emerald-50 border-emerald-200"
                : "bg-amber-50 border-amber-200"
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              {result.secretPersisted ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-amber-600" />
              )}
              <span className={result.secretPersisted ? "text-emerald-800" : "text-amber-800"}>
                {result.message}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="bg-white rounded border border-slate-200 p-2">
                <p className="text-xs text-slate-500 mb-1">Old kid (retired)</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-slate-600 flex-1 truncate">{result.oldKid}</code>
                  <CopyButton value={result.oldKid} label="old kid" />
                </div>
              </div>
              <div className="bg-white rounded border border-slate-200 p-2">
                <p className="text-xs text-slate-500 mb-1">New kid (pending deploy)</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-emerald-700 flex-1 truncate">{result.newKid}</code>
                  <CopyButton value={result.newKid} label="new kid" />
                </div>
              </div>
            </div>
            {!result.secretPersisted && (
              <p className="text-xs text-amber-700 pt-1">
                Go to <strong>Settings → Secrets</strong> and update{" "}
                <code className="bg-amber-100 px-1 rounded">JWKS_PRIVATE_KEY</code> with the new private key PEM,
                then re-deploy.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResult(null)}
            className="text-slate-500 border-slate-300"
          >
            Dismiss
          </Button>
        </div>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="gap-2 border-slate-300 text-slate-700 hover:border-red-300 hover:text-red-700 hover:bg-red-50"
              disabled={rotate.isPending}
            >
              <RotateCcw className="w-4 h-4" />
              {rotate.isPending ? "Rotating…" : "Rotate JWKS Key"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-500" />
                Rotate JWKS Key?
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  This will generate a new RSA-2048 key pair and retire the current key. The new key
                  will be stored as <code>JWKS_PRIVATE_KEY</code> and activated on the next deploy.
                </span>
                <span className="block">
                  All existing bearer tokens signed with the old key remain valid until their expiry.
                  The rotation event will be recorded in the wiki audit log.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => rotate.mutate()}
                className="bg-amber-600 hover:bg-amber-500 text-white"
              >
                Rotate Key
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

// ─── Main Admin Content ───────────────────────────────────────────────────────

function AdminContent() {
  const { user } = useAuth();
  const { data: status, refetch } = trpc.admin.backfillStatus.useQuery(undefined, {
    refetchInterval: 3000,
  });
  const backfill = trpc.admin.backfillWiki.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Frontend guard: only admin-role users may see this page (backend enforces it too)
  const isOwner = user?.role === "admin";

  if (!isOwner) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center">
        <h2 className="text-xl font-bold text-slate-900 mb-2">Forbidden</h2>
        <p className="text-slate-500 text-sm">Owner or admin access required.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Admin</h1>

      {/* Wiki Backfill */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <h2 className="font-semibold text-slate-900 mb-4">Wiki Backfill</h2>
        <p className="text-sm text-slate-500 mb-4">
          Compiles all completed documents into the knowledge graph wiki. Runs 15 documents in
          parallel with retry logic. Safe to re-run — already-compiled documents are skipped.
        </p>
        <Button
          onClick={() => backfill.mutate()}
          disabled={backfill.isPending}
          className="bg-slate-900 hover:bg-slate-800"
        >
          {backfill.isPending ? "Starting…" : "Run Wiki Backfill"}
        </Button>
      </div>

      {/* Backfill Status */}
      {status && (
        <div className="bg-slate-50 rounded-xl border border-border p-5">
          <h2 className="font-semibold text-slate-700 mb-3 text-sm uppercase tracking-wide">
            Backfill Status
          </h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { label: "Completed Docs", value: status.completedDocuments },
              { label: "Wiki Compiled", value: status.wikiCompiled },
              { label: "Pending", value: status.wikiPending },
              { label: "% Complete", value: `${status.percentComplete}%` },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-lg border border-border p-3">
                <p className="text-lg font-bold text-slate-900">{s.value}</p>
                <p className="text-xs text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
          {status.wikiPending > 0 && (
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className="bg-slate-900 h-2 rounded-full transition-all"
                style={{ width: `${status.percentComplete}%` }}
              />
            </div>
          )}
          <details className="mt-4">
            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
              Raw JSON
            </summary>
            <pre className="mt-2 text-xs text-slate-600 bg-white border border-border rounded p-3 overflow-auto">
              {JSON.stringify(status, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* LLM Provider Quality Panel */}
      <LlmProviderQualityPanel />

      {/* Frontier Engine */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <h2 className="font-semibold text-slate-900 mb-2">Frontier Engine</h2>
        <p className="text-sm text-slate-500 mb-4">
          Layer 3 of the three-layer architecture. Detects knowledge gaps, ranks them by priority,
          pursues evidence autonomously, and generates testable hypotheses — all without writing
          to the knowledge graph directly.
        </p>
        <a
          href="/admin/frontier"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-md transition-colors"
        >
          Open Frontier Dashboard
        </a>
      </div>

      {/* JWKS Key Rotation */}
      <KeyRotationCard />

      {/* JWKS Info */}
      <div className="bg-slate-50 rounded-xl border border-border p-5">
        <h2 className="font-semibold text-slate-700 mb-3 text-sm uppercase tracking-wide flex items-center gap-2">
          <KeyRound className="w-4 h-4" />
          Active JWKS Public Key
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Served at{" "}
          <a
            href="/.well-known/jwks.json"
            target="_blank"
            rel="noreferrer"
            className="text-violet-600 hover:underline"
          >
            /.well-known/jwks.json
          </a>
          . Used to verify RS256 bearer tokens and magic link JWTs offline.
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            RS256
          </Badge>
          <span className="text-xs text-slate-500">
            Rotate above to generate a new key pair. Re-deploy to activate.
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  return (
    <DashboardLayout>
      <AdminContent />
    </DashboardLayout>
  );
}
