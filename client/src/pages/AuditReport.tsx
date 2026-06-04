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
      detail: "Each claim cross-referenced against RCSB PDB, PubMed, Europe PMC, and PubChem using official APIs. No web scraping. Every evidence link points to a real database entry.",
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
            <p className="text-xs text-slate-400">All data sourced from official APIs: RCSB PDB · PubMed · Europe PMC · PubChem</p>
            <Link href="/trust" className="text-xs text-primary hover:underline">Full methodology →</Link>
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

  const claims = rawClaims as ClaimRow[] | undefined;

  const overrideMutation = trpc.claims.override.useMutation({
    onSuccess: () => {
      toast.success("Verdict override saved");
      setReviewingId(null);
      setOverrideVerdict("Insufficient Evidence");
      setOverrideNote("");
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

      {/* Processing state */}
      {isProcessing && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span className="font-semibold text-blue-700">
              {doc.status === "extracting" && "Extracting molecular claims…"}
              {doc.status === "validating" && "Validating claims against PDB…"}
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
                    <div className="mt-4 border border-blue-200 rounded-lg p-4 bg-blue-50">
                      <p className="text-xs font-semibold text-blue-700 mb-3">Override Verdict</p>
                      <div className="grid grid-cols-2 gap-2 mb-3">
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
                      <textarea
                        className="w-full text-xs border border-blue-200 rounded p-2 mb-3 bg-white resize-none"
                        rows={2}
                        placeholder="Reviewer note (optional)"
                        value={overrideNote}
                        onChange={(e) => setOverrideNote(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="bg-blue-700 hover:bg-blue-800 text-xs"
                          disabled={overrideMutation.isPending}
                          onClick={() =>
                            overrideMutation.mutate({
                              claimId: claim.id,
                              documentId: docId,
                              overriddenVerdict: overrideVerdict,
                              reviewNotes: overrideNote,
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
