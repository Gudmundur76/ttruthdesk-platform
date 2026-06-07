import { useParams, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { VerdictBadge } from "@/components/VerdictBadge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useState, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

// ─── PreflightSummaryCard ─────────────────────────────────────────────────────
/**
 * Renders the FrictionEngine pre-submission scan result stored on the document.
 * Shows inferred intent, recommended action, claim category breakdown, and
 * high-risk assumptions so reviewers can see what FrictionEngine flagged before
 * the full pipeline ran.
 */
function PreflightSummaryCard({ preflightResult }: { preflightResult: unknown }) {
  const [expanded, setExpanded] = useState(false);
  if (!preflightResult || typeof preflightResult !== "object") return null;
  const r = preflightResult as {
    inferred_intent?: string;
    recommended_action?: string;
    friction_question?: string;
    remaining_uncertainty?: string;
    totalClaims?: number;
    databaseVerifiable?: number;
    assumptionSmuggled?: number;
    likelyContradicted?: number;
    outOfScope?: number;
    opinionOrNarrative?: number;
    assumptions?: Array<{ statement: string; risk: string; type: string; test: string }>;
    validation_criteria?: string[];
  };

  const actionColor: Record<string, string> = {
    execute: "bg-emerald-50 border-emerald-200 text-emerald-800",
    ask_user: "bg-amber-50 border-amber-200 text-amber-800",
    reject: "bg-red-50 border-red-200 text-red-800",
    reframe: "bg-blue-50 border-blue-200 text-blue-800",
  };
  const actionLabel: Record<string, string> = {
    execute: "Proceed",
    ask_user: "Clarification Required",
    reject: "Rejected",
    reframe: "Reframe Suggested",
  };
  const action = r.recommended_action ?? "execute";
  const colorClass = actionColor[action] ?? actionColor.execute;

  const highRisk = (r.assumptions ?? []).filter((a) => a.risk === "high");

  return (
    <div className={`rounded-xl border p-4 mb-6 ${colorClass}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide opacity-70">FrictionEngine Preflight</span>
          <Badge variant="outline" className="text-xs">{actionLabel[action] ?? action}</Badge>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs underline opacity-60 hover:opacity-100 transition-opacity"
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      </div>
      {r.inferred_intent && (
        <p className="text-sm font-medium mb-2">
          <span className="opacity-60">Inferred intent: </span>{r.inferred_intent}
        </p>
      )}
      {/* Claim category breakdown */}
      {r.totalClaims !== undefined && (
        <div className="flex flex-wrap gap-2 text-xs mb-2">
          {r.databaseVerifiable !== undefined && r.databaseVerifiable > 0 && (
            <span className="bg-emerald-100 text-emerald-800 rounded px-2 py-0.5">{r.databaseVerifiable} verifiable</span>
          )}
          {r.assumptionSmuggled !== undefined && r.assumptionSmuggled > 0 && (
            <span className="bg-red-100 text-red-800 rounded px-2 py-0.5">{r.assumptionSmuggled} smuggled assumption{r.assumptionSmuggled !== 1 ? "s" : ""}</span>
          )}
          {r.likelyContradicted !== undefined && r.likelyContradicted > 0 && (
            <span className="bg-orange-100 text-orange-800 rounded px-2 py-0.5">{r.likelyContradicted} likely contradicted</span>
          )}
          {r.outOfScope !== undefined && r.outOfScope > 0 && (
            <span className="bg-slate-100 text-slate-700 rounded px-2 py-0.5">{r.outOfScope} out of scope</span>
          )}
          {r.opinionOrNarrative !== undefined && r.opinionOrNarrative > 0 && (
            <span className="bg-slate-100 text-slate-600 rounded px-2 py-0.5">{r.opinionOrNarrative} opinion/narrative</span>
          )}
        </div>
      )}
      {/* High-risk assumptions always visible */}
      {highRisk.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold mb-1 opacity-70">High-risk assumptions flagged:</p>
          <ul className="space-y-1">
            {highRisk.map((a, i) => (
              <li key={i} className="text-xs bg-white/50 rounded px-2 py-1">
                <span className="font-medium">{a.statement}</span>
                {a.test && <span className="opacity-60"> — Test: {a.test}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-current/10 pt-3">
          {r.friction_question && (
            <div>
              <p className="text-xs font-semibold mb-0.5 opacity-70">Friction question asked:</p>
              <p className="text-sm italic">"{r.friction_question}"</p>
            </div>
          )}
          {r.remaining_uncertainty && (
            <div>
              <p className="text-xs font-semibold mb-0.5 opacity-70">Remaining uncertainty:</p>
              <p className="text-sm">{r.remaining_uncertainty}</p>
            </div>
          )}
          {r.validation_criteria && r.validation_criteria.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-1 opacity-70">Validation criteria applied:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {r.validation_criteria.map((c, i) => (
                  <li key={i} className="text-xs">{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ClaimTrajectoryBadge ─────────────────────────────────────────────────────
function ClaimTrajectoryBadge({ claimId }: { claimId: number }) {
  const { data: pred } = trpc.predictions.forClaim.useQuery({ claimId }, {
    staleTime: 5 * 60 * 1000,
  });
  if (!pred) return null;
  const p = pred as { trajectory?: string; confidence?: number };
  if (!p.trajectory) return null;
  const colors: Record<string, string> = {
    STABLE: "text-blue-700 bg-blue-50 border-blue-200",
    LIKELY_CONFIRMED: "text-green-700 bg-green-50 border-green-200",
    LIKELY_RETRACTED: "text-red-700 bg-red-50 border-red-200",
    UNDER_SCRUTINY: "text-amber-700 bg-amber-50 border-amber-200",
    INSUFFICIENT_DATA: "text-slate-400 bg-slate-50 border-slate-200",
  };
  const labels: Record<string, string> = {
    STABLE: "Stable",
    LIKELY_CONFIRMED: "Likely Confirmed",
    LIKELY_RETRACTED: "Likely Retracted",
    UNDER_SCRUTINY: "Under Scrutiny",
    INSUFFICIENT_DATA: "Insufficient Data",
  };
  const color = colors[p.trajectory] ?? colors.INSUFFICIENT_DATA;
  const label = labels[p.trajectory] ?? p.trajectory;
  const conf = p.confidence != null ? Math.round(p.confidence * 100) : null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded border ${color}`}
      title={`Ground Signal trajectory prediction${conf != null ? ` (${conf}% confidence)` : ""}`}
    >
      ▲ {label}{conf != null ? ` · ${conf}%` : ""}
    </span>
  );
}

// ─── ClaimsJsonBadge ─────────────────────────────────────────────────────────
function ClaimsJsonBadge({ documentId }: { documentId: number }) {
  const [copied, setCopied] = useState(false);
  const url = `/api/public/documents/${documentId}/claims.json`;
  const fullUrl = `${window.location.origin}${url}`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [fullUrl]);

  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-600 shrink-0">
        <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
      </svg>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-emerald-700 hover:underline">
        claims.json
      </a>
      <button onClick={handleCopy} title="Copy URL" className="ml-0.5 text-emerald-500 hover:text-emerald-700 transition-colors">
        {copied ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        )}
      </button>
    </div>
  );
}

type VerdictType =
  | "Supported"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Needs Expert Review"
  | "Contradicted"
  | "Out of Scope";

const VERDICT_ORDER: VerdictType[] = [
  "Supported",
  "Partially Supported",
  "Ambiguous",
  "Insufficient Evidence",
  "Needs Expert Review",
  "Contradicted",
  "Out of Scope",
];

const VERDICT_COLORS: Record<VerdictType, string> = {
  Supported: "bg-green-500",
  "Partially Supported": "bg-yellow-400",
  Ambiguous: "bg-purple-400",
  "Insufficient Evidence": "bg-slate-300",
  "Needs Expert Review": "bg-blue-400",
  Contradicted: "bg-red-500",
  "Out of Scope": "bg-slate-200",
};

type ClaimRow = {
  id: number;
  claimText: string;
  claimType: string;
  pdbId: string | null;
  proteinName: string | null;
  experimentalMethod: string | null;
  resolution: number | null;
  verdict: VerdictType | null;
  verdictRationale: string | null;
  pdbEvidenceUrl: string | null;
  overriddenVerdict: VerdictType | null;
  confidenceScore: number | null;
  verdictMethod?: string | null;
  sourceCompletenessScore?: number | null;
};

function getFinalVerdict(claim: ClaimRow): VerdictType {
  return claim.overriddenVerdict ?? claim.verdict ?? "Insufficient Evidence";
}

function VerdictBar({ claims }: { claims: ClaimRow[] }) {
  const counts: Partial<Record<VerdictType, number>> = {};
  for (const c of claims) {
    const v = getFinalVerdict(c);
    counts[v] = (counts[v] ?? 0) + 1;
  }
  const total = claims.length;
  return (
    <div className="flex gap-1 h-3 rounded-full overflow-hidden w-full">
      {VERDICT_ORDER.map((v) => {
        const count = counts[v] ?? 0;
        if (!count) return null;
        const pct = (count / total) * 100;
        return (
          <div key={v} className={`${VERDICT_COLORS[v]} transition-all`} style={{ width: `${pct}%` }} title={`${v}: ${count}`} />
        );
      })}
    </div>
  );
}

// ─── HowWeVerifyPanel ────────────────────────────────────────────────────────
function HowWeVerifyPanel({
  submittedAt,
  claimsCount,
  llmProvider,
  qualityTier,
}: {
  submittedAt: number;
  claimsCount: number;
  llmProvider?: string;
  qualityTier?: string;
}) {
  const [open, setOpen] = useState(false);
  const steps = [
    {
      icon: "📄",
      label: "Document Ingested",
      detail: `Submitted ${new Date(submittedAt).toLocaleString()}. Text extracted and normalised.`,
      color: "bg-slate-100 text-slate-700",
    },
    {
      icon: "🔍",
      label: "Claims Extracted",
      detail: `${claimsCount} discrete scientific claims identified by LLM (${llmProvider ?? "manus_builtin"}). Each claim typed: structural, quantitative, methodological, or organism.`,
      color: "bg-blue-50 text-blue-700",
    },
    {
      icon: "🗄️",
      label: "Validated Against Databases",
      detail: "Each claim routed to the right authoritative source for its domain: RCSB PDB, UniProt, PubChem, ClinicalTrials.gov, Europe PMC, OpenFDA, USDA FoodData Central, NCBI Taxonomy, and more. No web scraping. Every evidence link points to a real database entry.",
      color: "bg-violet-50 text-violet-700",
    },
    {
      icon: "📊",
      label: "Confidence Scored",
      detail: "A confidence score (0–1) and confidence flags assigned per claim based on evidence quality, source count, and method reliability.",
      color: "bg-amber-50 text-amber-700",
    },
    {
      icon: "✅",
      label: "Report Generated",
      detail: `Quality tier: ${qualityTier ?? "draft"}. Audit report with structured claims.json, HTML export, and PDF export produced.`,
      color: "bg-green-50 text-green-700",
    },
  ];
  return (
    <div className="bg-white rounded-xl border border-border shadow-sm mb-6 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">How We Verified This Document</span>
          <span className="text-xs text-slate-400 font-normal">API-only · No scraping · Full audit trail</span>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5">
          <div className="flex flex-col md:flex-row gap-0 md:gap-0 relative">
            {steps.map((step, i) => (
              <div key={i} className="flex md:flex-col items-start md:items-center gap-3 md:gap-2 flex-1 relative pb-4 md:pb-0">
                {/* connector line */}
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-5 left-1/2 w-full h-px bg-border" />
                )}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 z-10 ${step.color}`}>
                  {step.icon}
                </div>
                <div className="md:text-center">
                  <p className="text-xs font-semibold text-slate-800 mb-0.5">{step.label}</p>
                  <p className="text-xs text-slate-500 leading-relaxed">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
            <p className="text-xs text-slate-400">All data sourced from official APIs: RCSB PDB · UniProt · PubChem · ClinicalTrials.gov · Europe PMC · OpenFDA · USDA FoodData Central</p>
            <Link href="/trust" className="text-xs text-primary hover:underline">Full methodology →</Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ProvenanceSummaryPanel ──────────────────────────────────────────────────
type DeterminismMetrics = {
  total: number;
  deterministic: number;
  heuristic: number;
  gated: number;
  overridden: number;
  determinismRate: number;
};
type BreakdownRow = {
  id: number;
  claimText: string;
  verdict: string | null;
  verdictMethod: string | null;
  sourceCompletenessScore: number | null;
};

function ProvenanceSummaryPanel({
  metrics,
  breakdown,
}: {
  metrics: DeterminismMetrics;
  breakdown: BreakdownRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const pct = metrics.determinismRate * 100;
  const barColor = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  const label = pct >= 80 ? "High" : pct >= 50 ? "Moderate" : "Low";
  const labelColor = pct >= 80 ? "text-emerald-700" : pct >= 50 ? "text-amber-700" : "text-red-700";

  const methodLabel: Record<string, string> = {
    deterministic_source: "◆ Deterministic",
    confidence_threshold: "∼ Heuristic",
    completeness_gate: "⚠ Gated",
    override: "✎ Override",
    fallback: "— Fallback",
  };

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm mb-6 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-900">Provenance Summary</span>
          <span className={`text-xs font-medium ${labelColor}`}>{label} determinism · {pct.toFixed(0)}%</span>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Determinism progress bar */}
      <div className="px-5 pb-3">
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
          <span>{metrics.deterministic} deterministic · {metrics.heuristic} heuristic · {metrics.gated} gated · {metrics.overridden} override</span>
          <span className="font-mono">{metrics.total} total</span>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5">
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Per-claim breakdown</p>
            <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {breakdown.map((row) => (
                <div key={row.id} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="text-xs font-mono text-slate-400 shrink-0 w-6 text-right">{row.id}</span>
                  <p className="text-xs text-slate-700 flex-1 leading-relaxed truncate">{row.claimText}</p>
                  <span className="text-xs font-mono text-slate-500 shrink-0">
                    {row.verdictMethod ? (methodLabel[row.verdictMethod] ?? row.verdictMethod) : "—"}
                  </span>
                  {row.sourceCompletenessScore != null && (
                    <span
                      className="text-xs font-mono shrink-0"
                      style={{ color: row.sourceCompletenessScore >= 0.8 ? "#16a34a" : row.sourceCompletenessScore >= 0.5 ? "#d97706" : "#dc2626" }}
                    >
                      {(row.sourceCompletenessScore * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditReportContent() {
  const params = useParams<{ id: string }>();
  const docId = parseInt(params.id ?? "0");
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [overrideVerdict, setOverrideVerdict] = useState<VerdictType>("Insufficient Evidence");
  const [overrideNote, setOverrideNote] = useState("");
  const [overrideJustification, setOverrideJustification] = useState("");
  const [overrideCategory, setOverrideCategory] = useState<
    "domain_expertise" | "new_evidence" | "context_clarification" | "scope_adjustment" | "error_correction"
  >("error_correction");

  // Redirect unauthenticated users (must be in useEffect to avoid render-phase side effects)
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/");
    }
  }, [authLoading, isAuthenticated, navigate]);

  const { data: doc, isLoading: docLoading } = trpc.documents.get.useQuery(
    { id: docId },
    { enabled: isAuthenticated && !!docId, refetchInterval: 5000 }
  );
  const { data: rawClaims, isLoading: claimsLoading, refetch: refetchClaims } =
    trpc.claims.byDocument.useQuery({ documentId: docId }, { enabled: isAuthenticated && !!docId });
  const { data: auditReport } = trpc.reports.byDocument.useQuery(
    { documentId: docId },
    { enabled: isAuthenticated && !!docId }
  );
  const { data: provenanceData } = trpc.claims.determinismMetrics.useQuery(
    { documentId: docId },
    { enabled: isAuthenticated && !!docId && doc?.status === "complete" }
  );

  const claims = rawClaims as ClaimRow[] | undefined;

  const overrideMutation = trpc.claims.override.useMutation({
    onSuccess: () => {
      toast.success("Verdict override saved");
      setReviewingId(null);
      setOverrideVerdict("Insufficient Evidence");
      setOverrideNote("");
      setOverrideJustification("");
      setOverrideCategory("error_correction");
      refetchClaims();
    },
    onError: (e) => toast.error(e.message),
  });

  const regenerateMutation = trpc.reports.regenerate.useMutation({
    onSuccess: () => toast.success("Report regeneration started"),
    onError: (e) => toast.error(e.message),
  });

  const isLoading = docLoading || claimsLoading;

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="max-w-4xl mx-auto py-24 text-center">
        <h2 className="text-xl font-bold text-slate-900 mb-2">Document not found</h2>
        <Button onClick={() => navigate("/dashboard")} variant="outline">← Back to Dashboard</Button>
      </div>
    );
  }

  const isProcessing = ["extracting", "validating", "generating_report"].includes(doc.status);
  const isComplete = doc.status === "complete";

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
        <button onClick={() => navigate("/dashboard")} className="hover:text-slate-900 transition-colors">
          My Audits
        </button>
        <span>/</span>
        <span className="text-slate-900 font-medium truncate max-w-xs">{doc.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">{doc.title}</h1>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span>Submitted {new Date(doc.createdAt).toLocaleDateString()}</span>
            {doc.claimCount > 0 && <span>· {doc.claimCount} claims extracted</span>}
          </div>
        </div>
        {isComplete && (
          <div className="flex items-center gap-2">
            <a
              href={`/api/reports/${docId}/pdf`}
              download={`audit-report-${docId}.pdf`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export PDF
            </a>
            <Button
              size="sm"
              variant="outline"
              onClick={() => regenerateMutation.mutate({ documentId: docId })}
              disabled={regenerateMutation.isPending}
            >
              Regenerate Report
            </Button>
          </div>
        )}
      </div>

      {/* FrictionEngine Preflight Summary — shown when a preflight scan was stored at submission time */}
      <PreflightSummaryCard preflightResult={(doc as unknown as Record<string, unknown>).preflightResult} />

      {/* Processing state */}
      {isProcessing && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span className="font-semibold text-blue-700">
              {doc.status === "extracting" && "Extracting verifiable claims…"}
              {doc.status === "validating" && "Validating claims against authoritative databases…"}
              {doc.status === "generating_report" && "Generating audit report…"}
            </span>
          </div>
          <p className="text-sm text-blue-600">This usually takes 30–90 seconds. Page auto-refreshes.</p>
        </div>
      )}

      {/* Failed state */}
      {doc.status === "failed" && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-6">
          <p className="font-semibold text-red-700 mb-1">Analysis failed</p>
          <p className="text-sm text-red-600">{doc.errorMessage ?? "An unexpected error occurred."}</p>
        </div>
      )}

      {/* Completeness-gate warning banner */}
      {claims && claims.some((c) => (c as { verdictMethod?: string | null }).verdictMethod === "completeness_gate") && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <span className="text-amber-500 text-lg mt-0.5">⚠</span>
          <div>
            <p className="text-sm font-semibold text-amber-800 mb-1">Incomplete source data detected</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              {claims.filter((c) => (c as { verdictMethod?: string | null }).verdictMethod === "completeness_gate").length} claim
              {claims.filter((c) => (c as { verdictMethod?: string | null }).verdictMethod === "completeness_gate").length > 1 ? "s were" : " was"} blocked
              from receiving a positive verdict because the required source data was missing or incomplete.
              These claims are marked <span className="font-mono font-semibold">⚠ gated</span> below.
              Verdicts will update automatically when source data becomes available.
            </p>
          </div>
        </div>
      )}

      {/* Verdict summary */}
      {claims && claims.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Verdict Summary</h2>
            <span className="text-sm text-slate-500">{claims.length} claims</span>
          </div>
          <VerdictBar claims={claims} />
          <div className="flex flex-wrap gap-2 mt-4">
            {VERDICT_ORDER.map((v) => {
              const count = claims.filter((c) => getFinalVerdict(c) === v).length;
              if (!count) return null;
              return (
                <div key={v} className="flex items-center gap-1.5">
                  <VerdictBadge verdict={v} size="sm" />
                  <span className="text-xs font-mono text-slate-500">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Provenance Summary — determinism metrics for this document */}
      {provenanceData && isComplete && (
        <ProvenanceSummaryPanel metrics={provenanceData.metrics} breakdown={provenanceData.breakdown} />
      )}

      {/* Machine-readable output */}
      {isComplete && (
        <div className="bg-slate-50 rounded-xl border border-border p-4 mb-6 flex flex-wrap gap-3 items-center">
          <p className="text-sm font-medium text-slate-700 w-full mb-1">Machine-readable output</p>
          <ClaimsJsonBadge documentId={docId} />
          <a
            href={`/reports/${docId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            View Public Report
          </a>
        </div>
      )}

      {/* Stored report files */}
      {auditReport && (auditReport.htmlStorageUrl || auditReport.pdfStorageUrl) && (
        <div className="bg-slate-50 rounded-xl border border-border p-4 mb-6 flex flex-wrap gap-3 items-center">
          <p className="text-sm font-medium text-slate-700 w-full mb-1">Stored report files</p>
          {auditReport.htmlStorageUrl && (
            <a href={auditReport.htmlStorageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-700 hover:underline">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              HTML Report
            </a>
          )}
          {auditReport.pdfStorageUrl && (
            <a href={auditReport.pdfStorageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-700 hover:underline">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              PDF Report
            </a>
          )}
        </div>
      )}

      {/* How We Verify */}
      {isComplete && (
        <HowWeVerifyPanel
          submittedAt={doc.createdAt instanceof Date ? doc.createdAt.getTime() : Number(doc.createdAt)}
          claimsCount={claims?.length ?? 0}
          llmProvider={(doc as { llmProvider?: string }).llmProvider}
          qualityTier={(doc as { qualityTier?: string }).qualityTier}
        />
      )}

      {/* Claims table */}
      {claims && claims.length > 0 && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold text-slate-900">Extracted Claims &amp; Evidence</h2>
          </div>
          <div className="divide-y divide-border">
            {claims.map((claim) => {
              const finalVerdict = getFinalVerdict(claim);
              const isOverridden = !!claim.overriddenVerdict;
              return (
                <div key={claim.id} className="p-5">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <VerdictBadge verdict={finalVerdict} />
                        {isOverridden && <span className="text-xs text-slate-400 italic">reviewer override</span>}
                        <span className="text-xs text-slate-400 font-mono uppercase">{claim.claimType}</span>
                        {claim.confidenceScore != null && (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded"
                            style={{
                              background: claim.confidenceScore >= 0.75 ? "#dcfce7" : claim.confidenceScore >= 0.5 ? "#fef9c3" : "#fee2e2",
                              color: claim.confidenceScore >= 0.75 ? "#166534" : claim.confidenceScore >= 0.5 ? "#854d0e" : "#991b1b",
                            }}
                            title="Confidence score (0–1)"
                          >
                            {(claim.confidenceScore * 100).toFixed(0)}% conf
                          </span>
                        )}
                        {isAuthenticated && <ClaimTrajectoryBadge claimId={claim.id} />}
                        {(claim as { verdictMethod?: string | null }).verdictMethod && (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded border"
                            style={{
                              background: (claim as { verdictMethod?: string | null }).verdictMethod === "deterministic_source" ? "#eff6ff" : "#f8fafc",
                              color: (claim as { verdictMethod?: string | null }).verdictMethod === "deterministic_source" ? "#1d4ed8" : "#64748b",
                              borderColor: (claim as { verdictMethod?: string | null }).verdictMethod === "deterministic_source" ? "#bfdbfe" : "#e2e8f0",
                            }}
                            title={`Verdict method: ${ (claim as { verdictMethod?: string | null }).verdictMethod }${ (claim as { sourceCompletenessScore?: number | null }).sourceCompletenessScore != null ? ` | Source completeness: ${((claim as { sourceCompletenessScore?: number | null }).sourceCompletenessScore! * 100).toFixed(0)}%` : "" }`}
                          >
                            {(claim as { verdictMethod?: string | null }).verdictMethod === "deterministic_source" ? "◆ deterministic" :
                             (claim as { verdictMethod?: string | null }).verdictMethod === "completeness_gate" ? "⚠ gated" :
                             (claim as { verdictMethod?: string | null }).verdictMethod === "confidence_threshold" ? "∼ heuristic" :
                             (claim as { verdictMethod?: string | null }).verdictMethod === "override" ? "✎ override" : "— fallback"}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">{claim.claimText}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 text-xs"
                      onClick={() => {
                        setReviewingId(reviewingId === claim.id ? null : claim.id);
                        setOverrideVerdict(finalVerdict);
                        setOverrideNote("");
                      }}
                    >
                      Review
                    </Button>
                  </div>

                  {/* Rationale */}
                  {claim.verdictRationale && (
                    <div className="bg-slate-50 rounded-lg p-3 mb-3">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Rationale</p>
                      <p className="text-xs text-slate-600 leading-relaxed">{claim.verdictRationale}</p>
                    </div>
                  )}

                  {/* PDB link */}
                  {claim.pdbId && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      <a
                        href={`https://www.rcsb.org/structure/${claim.pdbId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-mono text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded hover:bg-blue-100 transition-colors"
                      >
                        PDB: {claim.pdbId} ↗
                      </a>
                      {claim.pdbEvidenceUrl && (
                        <a
                          href={claim.pdbEvidenceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 hover:underline"
                        >
                          Evidence source ↗
                        </a>
                      )}
                    </div>
                  )}

                  {/* Protein / method details */}
                  {(claim.proteinName || claim.experimentalMethod || claim.resolution) && (
                    <div className="flex flex-wrap gap-3 mb-3 text-xs text-slate-500">
                      {claim.proteinName && <span>Protein: <span className="font-medium text-slate-700">{claim.proteinName}</span></span>}
                      {claim.experimentalMethod && <span>Method: <span className="font-medium text-slate-700">{claim.experimentalMethod}</span></span>}
                      {claim.resolution && <span>Resolution: <span className="font-medium text-slate-700">{claim.resolution} Å</span></span>}
                    </div>
                  )}

                  {/* Override panel */}
                  {reviewingId === claim.id && (
                    <div className="mt-4 border border-blue-200 rounded-lg p-4 bg-blue-50 space-y-3">
                      <p className="text-xs font-semibold text-blue-700">Override Verdict</p>
                      <div className="grid grid-cols-2 gap-2">
                        {VERDICT_ORDER.map((v) => (
                          <button
                            key={v}
                            onClick={() => setOverrideVerdict(v)}
                            className={`text-left px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                              overrideVerdict === v ? "bg-blue-700 text-white" : "bg-white text-slate-700 hover:bg-blue-100"
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                      {/* Override category — required for epistemic chain */}
                      <div>
                        <p className="text-xs font-medium text-blue-700 mb-1">Override Reason</p>
                        <div className="flex flex-wrap gap-1.5">
                          {([
                            ["domain_expertise", "Domain expertise"],
                            ["new_evidence", "New evidence"],
                            ["context_clarification", "Context clarification"],
                            ["scope_adjustment", "Scope adjustment"],
                            ["error_correction", "Error correction"],
                          ] as const).map(([val, label]) => (
                            <button
                              key={val}
                              onClick={() => setOverrideCategory(val)}
                              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                overrideCategory === val ? "bg-blue-700 text-white" : "bg-white text-slate-600 hover:bg-blue-100"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Justification — required, min 20 chars */}
                      <div>
                        <textarea
                          className="w-full text-xs border border-blue-200 rounded p-2 bg-white resize-none"
                          rows={3}
                          placeholder="Justification (required, min 20 characters) — explain why this override is scientifically valid"
                          value={overrideJustification}
                          onChange={(e) => setOverrideJustification(e.target.value)}
                        />
                        {overrideJustification.length > 0 && overrideJustification.length < 20 && (
                          <p className="text-xs text-red-500 mt-0.5">{20 - overrideJustification.length} more characters required</p>
                        )}
                      </div>
                      <textarea
                        className="w-full text-xs border border-blue-200 rounded p-2 bg-white resize-none"
                        rows={1}
                        placeholder="Additional reviewer note (optional)"
                        value={overrideNote}
                        onChange={(e) => setOverrideNote(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="bg-blue-700 hover:bg-blue-800 text-xs"
                          disabled={overrideMutation.isPending || overrideJustification.trim().length < 20}
                          onClick={() =>
                            overrideMutation.mutate({
                              claimId: claim.id,
                              documentId: docId,
                              overriddenVerdict: overrideVerdict,
                              justification: overrideJustification,
                              overrideCategory: overrideCategory,
                              reviewNotes: overrideNote || undefined,
                            })
                          }
                        >
                          Save Override
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => setReviewingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No claims yet */}
      {!isProcessing && claims && claims.length === 0 && (
        <div className="bg-white rounded-xl border border-border p-12 text-center shadow-sm">
          <p className="text-slate-500 text-sm">No claims extracted yet.</p>
        </div>
      )}
    </div>
  );
}

export default function AuditReport() {
  return (
    <DashboardLayout>
      <AuditReportContent />
    </DashboardLayout>
  );
}
