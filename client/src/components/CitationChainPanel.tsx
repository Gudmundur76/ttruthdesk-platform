/**
 * CitationChainPanel.tsx
 *
 * Phase 102 — Citation Chain Analysis
 *
 * Displays the citation propagation chain for a document: citing papers,
 * distortion scores, distortion type badges, and rationale text.
 *
 * Rendered as a collapsible section at the bottom of AuditReport.tsx.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Distortion type colour mapping (mirrors misrepresentation badge palette) ──

type DistortionType =
  | "faithful"
  | "amplification"
  | "selective_omission"
  | "scope_drift"
  | "causal_overclaim"
  | "fabrication"
  | "unknown";

const DISTORTION_COLORS: Record<
  DistortionType,
  { bg: string; text: string; border: string; label: string }
> = {
  faithful: {
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
    label: "Faithful",
  },
  amplification: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    label: "Amplification",
  },
  selective_omission: {
    bg: "bg-orange-50",
    text: "text-orange-800",
    border: "border-orange-200",
    label: "Selective Omission",
  },
  scope_drift: {
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
    label: "Scope Drift",
  },
  causal_overclaim: {
    bg: "bg-red-50",
    text: "text-red-800",
    border: "border-red-200",
    label: "Causal Overclaim",
  },
  fabrication: {
    bg: "bg-rose-50",
    text: "text-rose-800",
    border: "border-rose-200",
    label: "Fabrication",
  },
  unknown: {
    bg: "bg-slate-50",
    text: "text-slate-600",
    border: "border-slate-200",
    label: "Unknown",
  },
};

function distortionColor(type: string | null | undefined) {
  const key = (type ?? "unknown") as DistortionType;
  return DISTORTION_COLORS[key] ?? DISTORTION_COLORS.unknown;
}

// ─── Distortion score bar ─────────────────────────────────────────────────────

function DistortionBar({ score }: { score: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const color =
    pct < 20
      ? "bg-emerald-500"
      : pct < 50
        ? "bg-amber-500"
        : pct < 75
          ? "bg-orange-500"
          : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-slate-500 w-8 text-right">
        {pct}%
      </span>
    </div>
  );
}

// ─── Single hop card ──────────────────────────────────────────────────────────

interface HopCardProps {
  hop: {
    hopNumber: number;
    targetTitle: string | null;
    targetPmid: string | null;
    targetDoi: string | null;
    distortionScore: number | null;
    distortionType: string | null;
    distortionRationale: string | null;
    citingClaimText: string | null;
    analysisStatus: string | null;
  };
}

function HopCard({ hop }: HopCardProps) {
  const [expanded, setExpanded] = useState(false);
  const color = distortionColor(hop.distortionType);
  const score = hop.distortionScore ?? 0;
  const isFailed = hop.analysisStatus === "failed";

  return (
    <div
      className={`rounded-lg border p-4 ${color.bg} ${color.border} transition-all`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono text-slate-400 shrink-0">
            #{hop.hopNumber}
          </span>
          <p className="text-sm font-medium text-slate-800 truncate">
            {hop.targetTitle ?? "Unknown title"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isFailed && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border ${color.bg} ${color.text} ${color.border}`}
            >
              {color.label}
            </span>
          )}
          {isFailed && (
            <Badge variant="outline" className="text-xs text-slate-400">
              Analysis failed
            </Badge>
          )}
        </div>
      </div>

      {/* Distortion bar */}
      {!isFailed && <DistortionBar score={score} />}

      {/* Rationale + citing claim (expandable) */}
      {!isFailed && (hop.distortionRationale || hop.citingClaimText) && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs underline opacity-60 hover:opacity-100 transition-opacity"
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
          {expanded && (
            <div className="mt-2 space-y-2">
              {hop.distortionRationale && (
                <p className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-semibold">Distortion: </span>
                  {hop.distortionRationale}
                </p>
              )}
              {hop.citingClaimText && (
                <blockquote className="border-l-2 border-slate-300 pl-3 text-xs italic text-slate-600 leading-relaxed">
                  &ldquo;{hop.citingClaimText}&rdquo;
                </blockquote>
              )}
              {hop.targetPmid && (
                <a
                  href={`https://pubmed.ncbi.nlm.nih.gov/${hop.targetPmid}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  PMID {hop.targetPmid}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface CitationChainPanelProps {
  documentId: number;
}

export function CitationChainPanel({ documentId }: CitationChainPanelProps) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = trpc.citationChain.getByDocument.useQuery(
    { documentId },
    { enabled: open && !!documentId }
  );

  const edges = data?.edges ?? [];
  const stats = data?.stats;

  // Don't render the section header until we know there's data (or we're open)
  // Always render the toggle so users can trigger the query.

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden mb-6">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-slate-400 shrink-0"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
          </svg>
          <h2 className="font-semibold text-slate-900 text-sm">
            Citation Chain Analysis
          </h2>
          {stats && stats.totalCitingPapers > 0 && (
            <span className="text-xs text-slate-500">
              {stats.totalCitingPapers} citing paper
              {stats.totalCitingPapers !== 1 ? "s" : ""}
              {stats.maxDistortionScore > 0 && (
                <>
                  {" · "}
                  <span
                    className={
                      stats.maxDistortionScore > 0.5
                        ? "text-red-600 font-medium"
                        : "text-amber-600"
                    }
                  >
                    max distortion {Math.round(stats.maxDistortionScore * 100)}%
                  </span>
                </>
              )}
            </span>
          )}
          {open && !isLoading && edges.length === 0 && data && (
            <span className="text-xs text-slate-400">
              No citing papers found (requires PubMed ID)
            </span>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Panel body */}
      {open && (
        <div className="border-t border-border px-5 py-4">
          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          )}

          {!isLoading && edges.length === 0 && (
            <p className="text-sm text-slate-500 py-4 text-center">
              No citation chain data available. Chain analysis runs
              automatically for documents with a PubMed ID after the pipeline
              completes.
            </p>
          )}

          {!isLoading && edges.length > 0 && (
            <>
              {/* Stats summary */}
              {stats && (
                <div className="flex flex-wrap gap-3 mb-4 pb-4 border-b border-border">
                  <div className="text-xs text-slate-600">
                    <span className="font-semibold">
                      {stats.totalCitingPapers}
                    </span>{" "}
                    citing papers analysed
                  </div>
                  {stats.maxDistortionScore > 0 && (
                    <div className="text-xs text-slate-600">
                      Max distortion:{" "}
                      <span
                        className={
                          stats.maxDistortionScore > 0.5
                            ? "font-semibold text-red-600"
                            : "font-semibold text-amber-600"
                        }
                      >
                        {Math.round(stats.maxDistortionScore * 100)}%
                      </span>
                    </div>
                  )}
                  {stats.dominantType && stats.dominantType !== "unknown" && (
                    <div className="text-xs text-slate-600">
                      Dominant distortion:{" "}
                      <span
                        className={`font-semibold ${distortionColor(stats.dominantType).text}`}
                      >
                        {distortionColor(stats.dominantType).label}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Hop cards */}
              <div className="space-y-3">
                {edges.map(edge => (
                  <HopCard
                    key={edge.id}
                    hop={{
                      hopNumber: edge.hopNumber,
                      targetTitle: edge.targetTitle,
                      targetPmid: edge.targetPmid,
                      targetDoi: edge.targetDoi,
                      distortionScore: edge.distortionScore,
                      distortionType: edge.distortionType,
                      distortionRationale: edge.distortionRationale,
                      citingClaimText: edge.citingClaimText,
                      analysisStatus: edge.analysisStatus,
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
