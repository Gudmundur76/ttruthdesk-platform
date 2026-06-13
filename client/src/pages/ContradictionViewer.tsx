/**
 * ContradictionViewer.tsx
 * Side-by-side evidence viewer for conflicting claims in the knowledge graph.
 * Route: /contradictions/:relationId
 */
import { useState } from "react";
import { useRoute, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Scale,
  ExternalLink,
  BookOpen,
  Loader2,
} from "lucide-react";

// ─── Verdict badge ─────────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return <Badge variant="outline" className="text-xs">Unscored</Badge>;
  const map: Record<string, string> = {
    "Supported": "bg-emerald-100 text-emerald-800 border-emerald-200",
    "Contradicted": "bg-red-100 text-red-800 border-red-200",
    "Partially Supported": "bg-amber-100 text-amber-800 border-amber-200",
    "Ambiguous": "bg-slate-100 text-slate-700 border-slate-200",
    "Insufficient Evidence": "bg-blue-100 text-blue-800 border-blue-200",
    "Out of Scope": "bg-purple-100 text-purple-800 border-purple-200",
    "Needs Expert Review": "bg-orange-100 text-orange-800 border-orange-200",
  };
  return (
    <Badge className={`text-xs border ${map[verdict] ?? "bg-slate-100 text-slate-700"}`}>
      {verdict}
    </Badge>
  );
}

// ─── Claim card ────────────────────────────────────────────────────────────────

function ClaimCard({
  claim,
}: {
  claim: {
    id: number;
    claimText: string;
    verdict: string | null;
    confidenceScore: number | null;
    verdictRationale: string | null;
    documentId: number;
  };
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm leading-relaxed text-card-foreground">{claim.claimText}</p>
        <VerdictBadge verdict={claim.verdict} />
      </div>
      {claim.verdictRationale && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-3">
          {claim.verdictRationale}
        </p>
      )}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {claim.confidenceScore !== null && (
          <span>Confidence: <strong>{Math.round((claim.confidenceScore ?? 0) * 100)}%</strong></span>
        )}
        <Link href={`/reports/${claim.documentId}`} className="flex items-center gap-1 hover:text-primary transition-colors">
          <BookOpen className="h-3 w-3" />
          View report
        </Link>
      </div>
    </div>
  );
}

// ─── Resolution button ─────────────────────────────────────────────────────────

type Resolution = "source_correct" | "target_correct" | "both_partial" | "needs_expert" | "false_positive";

const RESOLUTION_OPTIONS: { value: Resolution; label: string; description: string; icon: React.ReactNode; color: string }[] = [
  {
    value: "source_correct",
    label: "Source is correct",
    description: "The source entity's claims are accurate; target is outdated or wrong.",
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: "border-emerald-300 hover:bg-emerald-50 data-[selected=true]:bg-emerald-50 data-[selected=true]:border-emerald-500",
  },
  {
    value: "target_correct",
    label: "Target is correct",
    description: "The target entity's claims are accurate; source is outdated or wrong.",
    icon: <CheckCircle2 className="h-4 w-4 text-blue-600" />,
    color: "border-blue-300 hover:bg-blue-50 data-[selected=true]:bg-blue-50 data-[selected=true]:border-blue-500",
  },
  {
    value: "both_partial",
    label: "Both partially correct",
    description: "Each entity captures a different aspect; context determines which applies.",
    icon: <Scale className="h-4 w-4 text-amber-600" />,
    color: "border-amber-300 hover:bg-amber-50 data-[selected=true]:bg-amber-50 data-[selected=true]:border-amber-500",
  },
  {
    value: "needs_expert",
    label: "Needs expert review",
    description: "Requires domain expertise to resolve; flagged for specialist attention.",
    icon: <HelpCircle className="h-4 w-4 text-orange-600" />,
    color: "border-orange-300 hover:bg-orange-50 data-[selected=true]:bg-orange-50 data-[selected=true]:border-orange-500",
  },
  {
    value: "false_positive",
    label: "False positive",
    description: "These entities do not actually contradict each other; relation is incorrect.",
    icon: <XCircle className="h-4 w-4 text-slate-500" />,
    color: "border-slate-300 hover:bg-slate-50 data-[selected=true]:bg-slate-50 data-[selected=true]:border-slate-400",
  },
];

// ─── Main page ─────────────────────────────────────────────────────────────────

  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export default function ContradictionViewer() {
  const [, params] = useRoute("/contradictions/:relationId");
  const relationId = parseInt(params?.relationId ?? "0", 10);
  const { user } = useAuth();

  const { data, isLoading, error } = trpc.graph.contradictionDetail.useQuery(
    { relationId },
    { enabled: !isNaN(relationId) && relationId > 0 }
  );

  const [selectedResolution, setSelectedResolution] = useState<Resolution | null>(null);
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();
  const resolveMutation = trpc.graph.resolveContradiction.useMutation({
    onSuccess: (result) => {
      toast.success(`Contradiction resolved: ${result.resolution.replace(/_/g, " ")}`);
      utils.graph.contradictions.invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to resolve: ${err.message}`);
    },
  });

  if (isNaN(relationId) || relationId <= 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
          <p className="text-lg font-medium">Invalid contradiction ID</p>
          <Link href="/knowledge-graph">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Knowledge Graph
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading contradiction detail…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <XCircle className="h-12 w-12 text-red-500 mx-auto" />
          <p className="text-lg font-medium">Contradiction not found</p>
          <p className="text-sm text-muted-foreground">{error?.message ?? "This relation may have been removed."}</p>
          <Link href="/knowledge-graph">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Knowledge Graph
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { relation, sourceEntity, targetEntity, evidenceDocument, sourceClaims, targetClaims } = data;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top nav ── */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/knowledge-graph">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Knowledge Graph
              </Button>
            </Link>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">Contradiction #{relation.id}</span>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            Confidence: {relation.confidenceScore !== null ? `${Math.round((relation.confidenceScore ?? 0) * 100)}%` : "Unscored"}
          </Badge>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* ── Entity overview ── */}
        <section className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Contradiction Analysis</h1>
          <p className="text-muted-foreground text-sm">
            The knowledge graph detected a <strong>contradicts</strong> relationship between two entities.
            Review the evidence below and resolve the contradiction.
          </p>
        </section>

        {/* ── Side-by-side entity panels ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Source entity */}
          <Card className="border-l-4 border-l-blue-400">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Source Entity</p>
                  <CardTitle className="text-base">
                    {sourceEntity?.canonicalName ?? `Entity #${relation.sourceEntityId}`}
                  </CardTitle>
                </div>
                {sourceEntity && (
                  <Badge variant="outline" className="text-xs capitalize">
                    {sourceEntity.entityType.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {sourceClaims.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No claims found for this entity.</p>
              ) : (
                sourceClaims.map((c) => <ClaimCard key={c.id} claim={c} />)
              )}
            </CardContent>
          </Card>

          {/* Target entity */}
          <Card className="border-l-4 border-l-red-400">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Target Entity</p>
                  <CardTitle className="text-base">
                    {targetEntity?.canonicalName ?? `Entity #${relation.targetEntityId}`}
                  </CardTitle>
                </div>
                {targetEntity && (
                  <Badge variant="outline" className="text-xs capitalize">
                    {targetEntity.entityType.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {targetClaims.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No claims found for this entity.</p>
              ) : (
                targetClaims.map((c) => <ClaimCard key={c.id} claim={c} />)
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Evidence document ── */}
        {evidenceDocument && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                Evidence Document
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{evidenceDocument.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {evidenceDocument.verticalDomain} · {evidenceDocument.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/reports/${evidenceDocument.id}`}>
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                      <ExternalLink className="h-3 w-3" />
                      View Report
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Resolution panel ── */}
        {user ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                Resolve Contradiction
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Select a resolution to record your expert judgment. This updates the relation confidence score and flags the contradiction for downstream processing.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Resolution options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {RESOLUTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    data-selected={selectedResolution === opt.value}
                    onClick={() => setSelectedResolution(opt.value)}
                    className={`text-left rounded-lg border p-3 transition-all cursor-pointer ${opt.color}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {opt.icon}
                      <span className="text-sm font-medium">{opt.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                  </button>
                ))}
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Notes (optional)</label>
                <Textarea
                  placeholder="Add context, references, or reasoning for this resolution…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="resize-none text-sm"
                />
                <p className="text-xs text-muted-foreground text-right">{notes.length}/2000</p>
              </div>

              {/* Submit */}
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setSelectedResolution(null); setNotes(""); }}
                  disabled={resolveMutation.isPending}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  disabled={!selectedResolution || resolveMutation.isPending}
                  onClick={() => {
                    if (!selectedResolution) return;
                    resolveMutation.mutate({
                      relationId: relation.id,
                      resolution: selectedResolution,
                      notes: notes.trim() || undefined,
                    });
                  }}
                  className="gap-2"
                >
                  {resolveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Submit Resolution
                </Button>
              </div>

              {resolveMutation.isSuccess && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  Resolution recorded. The knowledge graph will be updated on the next lint cycle.
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-6 text-center space-y-2">
              <Scale className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium">Sign in to resolve contradictions</p>
              <p className="text-xs text-muted-foreground">Expert resolution requires authentication.</p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
