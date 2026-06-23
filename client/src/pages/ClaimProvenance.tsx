/**
 * ClaimProvenance.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Provenance chain viewer for a single claim.
 *
 * Route: /provenance/:claimId
 *
 * Shows the full audit trail of how a claim was processed:
 *   1. Extraction from raw text
 *   2. Evidence lookup against PDB / literature
 *   3. Quality scoring
 *   4. Any manual verdict overrides
 *   5. Agent ingestion events
 *   6. Similarity checks
 *
 * Each step renders as a timeline node with:
 *   - Step label + actor badge
 *   - Duration pill
 *   - Success / failure indicator
 *   - Collapsible input / output snapshots
 *   - Error message (if failed)
 */
import { useParams, useLocation } from "wouter";
import { useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Clock,
  User,
  ArrowLeft,
  AlertTriangle,
  Zap,
  Search,
  Star,
  Edit3,
  Download,
  Bot,
  Cpu,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

// ─── Quantum Provenance Panel ────────────────────────────────────────────────
function QuantumProvenancePanel({ claimId }: { claimId: number }) {
  const { data, isLoading } = trpc.quantumJobs.list.useQuery({ limit: 10 });
  // Filter to jobs linked to this claim's citation edges
  const jobs = data?.filter(j => j.citationEdgeId === claimId) ?? [];

  if (isLoading)
    return <Skeleton className="h-20 w-full rounded-xl bg-slate-800" />;
  if (jobs.length === 0) return null;

  return (
    <Card className="bg-slate-900/60 border-slate-700 mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-violet-400" />
          Quantum Hardware Provenance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobs.map(job => {
          const isHardware = job.status === "done";
          return (
            <div
              key={job.id}
              className="flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2">
                {isHardware ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 animate-pulse font-semibold">
                    <Cpu className="w-3 h-3" /> QUANTUM-DUAL
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
                    <Cpu className="w-3 h-3" /> QUANTUM-READY
                  </span>
                )}
                <span className="text-slate-400 font-mono">{job.backend}</span>
              </div>
              <div className="text-slate-400">
                {job.vqeEnergyHartree != null ? (
                  <span>{Number(job.vqeEnergyHartree).toFixed(6)} Ha</span>
                ) : (
                  <span className="text-slate-600">{job.status}</span>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Step metadata ────────────────────────────────────────────────────────────
type ProvenanceStep =
  | "extraction"
  | "evidence_lookup"
  | "quality_scoring"
  | "verdict_override"
  | "agent_ingestion"
  | "similarity_check";

const STEP_META: Record<
  ProvenanceStep,
  {
    label: string;
    icon: React.ReactNode;
    color: string;
    bg: string;
    border: string;
  }
> = {
  extraction: {
    label: "Extraction",
    icon: <Download className="w-4 h-4" />,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  evidence_lookup: {
    label: "Evidence Lookup",
    icon: <Search className="w-4 h-4" />,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
  },
  quality_scoring: {
    label: "Quality Scoring",
    icon: <Star className="w-4 h-4" />,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  verdict_override: {
    label: "Verdict Override",
    icon: <Edit3 className="w-4 h-4" />,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
  },
  agent_ingestion: {
    label: "Agent Ingestion",
    icon: <Bot className="w-4 h-4" />,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  similarity_check: {
    label: "Similarity Check",
    icon: <Zap className="w-4 h-4" />,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/30",
  },
};

function getStepMeta(step: string) {
  return (
    STEP_META[step as ProvenanceStep] ?? {
      label: step,
      icon: <GitBranch className="w-4 h-4" />,
      color: "text-slate-400",
      bg: "bg-slate-500/10",
      border: "border-slate-500/30",
    }
  );
}

// ─── Snapshot viewer ──────────────────────────────────────────────────────────
function SnapshotPanel({
  label,
  data,
}: {
  label: string;
  data: Record<string, unknown> | null;
}) {
  const [open, setOpen] = useState(false);
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors mt-2">
          {open ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          {label}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 text-xs text-slate-300 bg-slate-950 rounded-lg p-3 overflow-x-auto max-h-48 leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Single timeline event ────────────────────────────────────────────────────
interface ProvenanceEvent {
  id: number;
  claimId: number;
  documentId: number;
  step: string;
  actor: string;
  inputSnapshot: Record<string, unknown> | null;
  outputSnapshot: Record<string, unknown> | null;
  durationMs: number | null;
  success: boolean;
  errorMsg: string | null;
  createdAt: Date | string;
}

function TimelineEvent({
  event,
  isLast,
}: {
  event: ProvenanceEvent;
  isLast: boolean;
}) {
  const meta = getStepMeta(event.step);
  const ts = new Date(event.createdAt);

  return (
    <div className="flex gap-4">
      {/* Vertical connector */}
      <div className="flex flex-col items-center">
        <div
          className={`flex items-center justify-center w-9 h-9 rounded-full border-2 flex-shrink-0 ${meta.bg} ${meta.border}`}
        >
          <span className={meta.color}>{meta.icon}</span>
        </div>
        {!isLast && <div className="w-px flex-1 bg-slate-700/60 mt-1 mb-1" />}
      </div>

      {/* Content */}
      <div className={`pb-6 flex-1 min-w-0 ${isLast ? "" : ""}`}>
        {/* Header row */}
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className={`font-semibold text-sm ${meta.color}`}>
            {meta.label}
          </span>
          {event.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          )}
          <Badge
            variant="outline"
            className="text-xs border-slate-600 text-slate-400 gap-1"
          >
            <User className="w-3 h-3" />
            {event.actor}
          </Badge>
          {event.durationMs !== null && (
            <Badge
              variant="outline"
              className="text-xs border-slate-700 text-slate-500 gap-1"
            >
              <Clock className="w-3 h-3" />
              {event.durationMs < 1000
                ? `${event.durationMs}ms`
                : `${(event.durationMs / 1000).toFixed(1)}s`}
            </Badge>
          )}
          <span className="text-xs text-slate-600 ml-auto">
            {ts.toLocaleString()}
          </span>
        </div>

        {/* Error message */}
        {!event.success && event.errorMsg && (
          <div className="flex items-start gap-2 mt-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-rose-300">{event.errorMsg}</p>
          </div>
        )}

        {/* Snapshots */}
        <SnapshotPanel label="Input snapshot" data={event.inputSnapshot} />
        <SnapshotPanel label="Output snapshot" data={event.outputSnapshot} />
      </div>
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────
interface ProvenanceSummary {
  claimId: number;
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  firstSeenAt: Date | string | null;
  lastModifiedAt: Date | string | null;
  stepsCompleted: string[];
  stepsMissing: string[];
  actors: string[];
  narrative: string;
}

function SummaryCard({ summary }: { summary: ProvenanceSummary }) {
  return (
    <Card className="bg-slate-900/60 border-slate-700 mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-slate-400 uppercase tracking-wide flex items-center gap-2">
          <GitBranch className="w-4 h-4" />
          Provenance Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Narrative */}
        <p className="text-slate-200 text-sm leading-relaxed">
          {summary.narrative}
        </p>

        <Separator className="bg-slate-800" />

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-center">
            <p className="text-xl font-bold text-white">{summary.totalSteps}</p>
            <p className="text-xs text-slate-500">Total Steps</p>
          </div>
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-center">
            <p className="text-xl font-bold text-emerald-400">
              {summary.successfulSteps}
            </p>
            <p className="text-xs text-slate-500">Successful</p>
          </div>
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-center">
            <p className="text-xl font-bold text-rose-400">
              {summary.failedSteps}
            </p>
            <p className="text-xs text-slate-500">Failed</p>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-center">
            <p className="text-xl font-bold text-white">
              {summary.actors.length}
            </p>
            <p className="text-xs text-slate-500">Actors</p>
          </div>
        </div>

        {/* Steps completed */}
        {summary.stepsCompleted.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-2">Steps completed</p>
            <div className="flex flex-wrap gap-2">
              {summary.stepsCompleted.map(s => {
                const m = getStepMeta(s);
                return (
                  <Badge
                    key={s}
                    variant="outline"
                    className={`text-xs gap-1 ${m.color} ${m.border}`}
                  >
                    {m.icon}
                    {m.label}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* Steps missing */}
        {summary.stepsMissing.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-2">
              Steps not yet recorded
            </p>
            <div className="flex flex-wrap gap-2">
              {summary.stepsMissing.map(s => {
                const m = getStepMeta(s);
                return (
                  <Badge
                    key={s}
                    variant="outline"
                    className="text-xs gap-1 text-slate-600 border-slate-700"
                  >
                    {m.label}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* Timestamps */}
        {(summary.firstSeenAt || summary.lastModifiedAt) && (
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            {summary.firstSeenAt && (
              <span>
                First seen:{" "}
                <span className="text-slate-400">
                  {new Date(summary.firstSeenAt).toLocaleString()}
                </span>
              </span>
            )}
            {summary.lastModifiedAt && (
              <span>
                Last modified:{" "}
                <span className="text-slate-400">
                  {new Date(summary.lastModifiedAt).toLocaleString()}
                </span>
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ClaimProvenance() {
  const params = useParams<{ claimId: string }>();
  const [, navigate] = useLocation();
  const claimId = parseInt(params.claimId ?? "0", 10);

  const { data, isLoading, error } = trpc.provenance.getChain.useQuery(
    { claimId },
    { enabled: claimId > 0 }
  );

  if (!claimId || isNaN(claimId)) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <TopNav />
        <div className="max-w-3xl mx-auto px-4 py-16 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Invalid Claim ID</h1>
          <p className="text-slate-400">
            Please provide a valid numeric claim ID in the URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <TopNav />
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Back navigation */}
        <button
          onClick={() => navigate(`/claim/${claimId}`)}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Claim #{claimId}
        </button>

        {/* Page header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <GitBranch className="w-6 h-6 text-violet-400" />
            <h1 className="text-2xl font-bold text-white">Provenance Chain</h1>
          </div>
          <p className="text-slate-400 text-sm">
            Full audit trail for Claim #{claimId} — every pipeline step that
            produced or modified this claim's verdict.
          </p>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-xl bg-slate-800" />
            <Skeleton className="h-24 w-full rounded-xl bg-slate-800" />
            <Skeleton className="h-24 w-full rounded-xl bg-slate-800" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <Card className="bg-rose-500/10 border-rose-500/30">
            <CardContent className="flex items-center gap-3 py-4">
              <XCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <p className="text-rose-300 text-sm">{error.message}</p>
            </CardContent>
          </Card>
        )}

        {/* Data */}
        {data && (
          <>
            {/* Quantum Provenance Badge */}
            <QuantumProvenancePanel claimId={claimId} />
            {/* Summary */}
            <SummaryCard summary={data.summary} />

            {/* Timeline */}
            <div className="mb-2">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">
                Event Timeline ({data.chain.length} event
                {data.chain.length !== 1 ? "s" : ""})
              </h2>

              {data.chain.length === 0 ? (
                <Card className="bg-slate-900/40 border-slate-700">
                  <CardContent className="flex flex-col items-center py-12 text-center">
                    <GitBranch className="w-10 h-10 text-slate-600 mb-3" />
                    <p className="text-slate-400 font-medium">
                      No provenance events recorded
                    </p>
                    <p className="text-slate-600 text-sm mt-1">
                      This claim has not yet been processed through the
                      instrumented pipeline.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="pl-1">
                  {data.chain.map((event, idx) => (
                    <TimelineEvent
                      key={event.id}
                      event={event}
                      isLast={idx === data.chain.length - 1}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <Separator className="bg-slate-800 my-6" />
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/claim/${claimId}`)}
                className="gap-2 border-slate-700 text-slate-300 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" />
                View Claim
              </Button>
              {data.chain.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/audit/${data.chain[0].documentId}`)}
                  className="gap-2 border-slate-700 text-slate-300 hover:text-white"
                >
                  View Source Document
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
