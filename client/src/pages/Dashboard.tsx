import { useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VerdictBadge } from "@/components/VerdictBadge";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "text-amber-600 bg-amber-50 border-amber-200" },
  extracting: { label: "Extracting", color: "text-blue-600 bg-blue-50 border-blue-200" },
  validating: { label: "Validating", color: "text-blue-600 bg-blue-50 border-blue-200" },
  generating_report: { label: "Generating Report", color: "text-blue-600 bg-blue-50 border-blue-200" },
  complete: { label: "Complete", color: "text-green-600 bg-green-50 border-green-200" },
  failed: { label: "Failed", color: "text-red-600 bg-red-50 border-red-200" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? STATUS_LABELS.pending;
  const isProcessing = ["extracting", "validating", "generating_report"].includes(status);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${s.color}`}>
      {isProcessing && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-pulse" />
      )}
      {s.label}
    </span>
  );
}

function AuthorReliabilityBadge() {
  const { data: reliability } = trpc.predictions.authorReliability.useQuery();
  if (!reliability) return null;
  const tierColors: Record<string, string> = {
    HIGH: "text-green-700 bg-green-50 border-green-200",
    AVERAGE: "text-amber-700 bg-amber-50 border-amber-200",
    LOW: "text-red-700 bg-red-50 border-red-200",
    INSUFFICIENT_DATA: "text-slate-500 bg-slate-50 border-slate-200",
  };
  const tierLabels: Record<string, string> = {
    HIGH: "High Reliability",
    AVERAGE: "Average Reliability",
    LOW: "Low Reliability",
    INSUFFICIENT_DATA: "Reliability: Insufficient Data",
  };
  const color = tierColors[reliability.reliabilityTier] ?? tierColors.INSUFFICIENT_DATA;
  const label = tierLabels[reliability.reliabilityTier] ?? "Reliability";
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${color}`}
      title={`Contradiction rate: ${Math.round(reliability.contradictionRate * 100)}% vs field avg ${Math.round(reliability.fieldAverageRate * 100)}% (${reliability.totalClaimsAudited} claims audited)`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}
      {reliability.totalClaimsAudited >= 3 && (
        <span className="opacity-70">· {Math.round(reliability.contradictionRate * 100)}% contradiction rate</span>
      )}
    </div>
  );
}

function DashboardContent() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { data: docs, isLoading } = trpc.documents.list.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 5000,
  });

  // Redirect unauthenticated users to sign-in (must be in useEffect to avoid render-phase side effects)
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/");
    }
  }, [authLoading, isAuthenticated, navigate]);

  if (!authLoading && !isAuthenticated) return null;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">My Audits</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-slate-500 text-sm">
              {docs
                ? `${docs.length} document${docs.length !== 1 ? "s" : ""} submitted`
                : "Loading…"}
            </p>
            {isAuthenticated && <AuthorReliabilityBadge />}
          </div>
        </div>
        <Button asChild className="bg-slate-900 hover:bg-slate-800">
          <Link href="/submit">+ New Audit</Link>
        </Button>
      </div>

      {/* Stats row */}
      {docs && docs.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total", value: docs.length },
            { label: "Complete", value: docs.filter((d) => d.status === "complete").length },
            {
              label: "Processing",
              value: docs.filter((d) =>
                ["extracting", "validating", "generating_report"].includes(d.status)
              ).length,
            },
            {
              label: "Claims",
              value: docs.reduce((sum, d) => sum + (d.claimCount ?? 0), 0),
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white rounded-xl border border-border p-4 shadow-sm"
            >
              <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Documents table */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : docs && docs.length > 0 ? (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50">
                <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">
                  Document
                </th>
                <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden md:table-cell">
                  Status
                </th>
                <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden lg:table-cell">
                  Claims
                </th>
                <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden lg:table-cell">
                  Top Verdict
                </th>
                <th className="text-left px-5 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide hidden md:table-cell">
                  Submitted
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {docs.map((doc, i) => (
                <tr
                  key={doc.id}
                  className={`border-b border-border last:border-0 hover:bg-slate-50 transition-colors cursor-pointer ${
                    i % 2 === 0 ? "" : "bg-slate-50/30"
                  }`}
                  onClick={() => navigate(`/audit/${doc.id}`)}
                >
                  <td className="px-5 py-4">
                    <div className="font-medium text-slate-900 truncate max-w-xs">{doc.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5 md:hidden">
                      <StatusBadge status={doc.status} />
                    </div>
                  </td>
                  <td className="px-5 py-4 hidden md:table-cell">
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="px-5 py-4 hidden lg:table-cell">
                    <span className="font-mono text-slate-700">{doc.claimCount ?? "—"}</span>
                  </td>
                  <td className="px-5 py-4 hidden lg:table-cell">
                    {doc.topVerdict ? (
                      <VerdictBadge verdict={doc.topVerdict} />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 hidden md:table-cell text-slate-500 text-xs">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {doc.status === "complete" && (
                        <a
                          href={`/api/reports/${doc.id}/pdf`}
                          download={`audit-report-${doc.id}.pdf`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                          title="Export PDF"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          PDF
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/audit/${doc.id}`);
                        }}
                      >
                        View →
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border p-16 text-center shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#6b7280"
              strokeWidth="1.8"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <h3 className="font-semibold text-slate-900 mb-1">No documents yet</h3>
          <p className="text-sm text-slate-500 mb-5">
            Submit your first biotech document to begin molecular claim verification.
          </p>
          <Button asChild className="bg-slate-900 hover:bg-slate-800">
            <Link href="/submit">Submit First Document →</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  return (
    <DashboardLayout>
      <DashboardContent />
    </DashboardLayout>
  );
}
