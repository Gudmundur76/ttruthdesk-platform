/**
 * Registry.tsx — Public Verifiable Claims Registry
 *
 * Fetches /api/public/claims.json and renders the most recent verified
 * molecular claims across all audited documents.  No login required.
 */

import { useState, useEffect } from "react";
import { TopNav } from "@/components/TopNav";
import { VerdictBadge } from "@/components/VerdictBadge";
import { getLoginUrl } from "@/const";

type SourceRef = {
  database: string;
  entry_id: string;
  url: string;
};

type ClaimRecord = {
  id: string;
  value: string;
  label: string;
  claim_type: string;
  extracted_value: string | null;
  verdict: string | null;
  verdict_rationale: string | null;
  manually_reviewed: boolean;
  evidence_checked_at: string | null;
  source_refs: SourceRef[];
  page_anchors: string[];
  date_observed: string;
};

type Registry = {
  standard: string;
  generated_at: string;
  count: number;
  claims: ClaimRecord[];
};

const VERDICT_COLORS: Record<string, string> = {
  Supported: "text-green-700 bg-green-50 border-green-200",
  "Partially Supported": "text-yellow-700 bg-yellow-50 border-yellow-200",
  Ambiguous: "text-purple-700 bg-purple-50 border-purple-200",
  "Insufficient Evidence": "text-slate-600 bg-slate-50 border-slate-200",
  "Needs Expert Review": "text-blue-700 bg-blue-50 border-blue-200",
  Contradicted: "text-red-700 bg-red-50 border-red-200",
  "Out of Scope": "text-slate-500 bg-slate-50 border-slate-200",
};

function VerdictPill({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-xs text-slate-400 italic">Unverified</span>;
  const cls = VERDICT_COLORS[verdict] ?? "text-slate-600 bg-slate-50 border-slate-200";
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      {verdict}
    </span>
  );
}

export default function Registry() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/api/public/claims.json")
      .then((r) => r.json())
      .then((d: Registry) => { setRegistry(d); setLoading(false); })
      .catch(() => { setError("Failed to load registry"); setLoading(false); });
  }, []);

  const verdictOptions = [
    "all",
    "Supported",
    "Partially Supported",
    "Contradicted",
    "Ambiguous",
    "Insufficient Evidence",
    "Needs Expert Review",
    "Out of Scope",
  ];

  const filtered = registry?.claims.filter(
    (c) => filter === "all" || c.verdict === filter
  ) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      {/* Hero */}
      <div className="border-b border-border bg-slate-50">
        <div className="container py-10 max-w-5xl">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Registry
              </div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                Verifiable Claims Registry
              </h1>
              <p className="text-slate-500 max-w-xl text-sm leading-relaxed">
                Every molecular claim audited by Protein Truth Desk is published here as a
                machine-readable record, traceable back to its authoritative PDB source.
                Free to query, cite, and integrate.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <a
                href="/api/public/claims.json"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-1.5 hover:bg-emerald-100 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
                </svg>
                /api/public/claims.json
              </a>
              <a
                href="/api/public/schemas/claims.schema.json"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
              >
                JSON Schema ↗
              </a>
            </div>
          </div>

          {/* Stats bar */}
          {registry && (
            <div className="mt-6 flex flex-wrap gap-6 text-sm">
              <div>
                <span className="font-semibold text-slate-900">{registry.count}</span>
                <span className="text-slate-500 ml-1">verified claims</span>
              </div>
              <div>
                <span className="font-semibold text-slate-900">
                  {registry.claims.filter((c) => c.verdict === "Supported").length}
                </span>
                <span className="text-slate-500 ml-1">supported</span>
              </div>
              <div>
                <span className="font-semibold text-slate-900">
                  {registry.claims.filter((c) => c.verdict === "Contradicted").length}
                </span>
                <span className="text-slate-500 ml-1">contradicted</span>
              </div>
              <div>
                <span className="font-semibold text-slate-900">
                  {registry.claims.filter((c) => c.manually_reviewed).length}
                </span>
                <span className="text-slate-500 ml-1">expert-reviewed</span>
              </div>
              <div className="text-slate-400 text-xs self-end">
                Updated {new Date(registry.generated_at).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="container py-8 max-w-5xl">
        {loading && (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-red-700 font-medium mb-1">Could not load registry</p>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {registry && registry.count === 0 && (
          <div className="rounded-xl border border-border bg-slate-50 p-10 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Registry is empty</h2>
            <p className="text-sm text-slate-500 mb-5">
              No verified claims yet. Submit a biotech document to populate the registry.
            </p>
            <a
              href={getLoginUrl()}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg px-4 py-2 transition-colors"
            >
              Submit a document →
            </a>
          </div>
        )}

        {registry && registry.count > 0 && (
          <>
            {/* Filter bar */}
            <div className="flex flex-wrap gap-2 mb-6">
              {verdictOptions.map((v) => (
                <button
                  key={v}
                  onClick={() => setFilter(v)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    filter === v
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-border hover:border-slate-400"
                  }`}
                >
                  {v === "all" ? `All (${registry.count})` : v}
                </button>
              ))}
            </div>

            {/* Claims list */}
            <div className="space-y-3">
              {filtered.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">No claims match this filter.</p>
              )}
              {filtered.map((claim) => (
                <div
                  key={claim.id}
                  className="bg-white rounded-xl border border-border p-5 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <VerdictPill verdict={claim.verdict} />
                        {claim.manually_reviewed && (
                          <span className="text-xs text-slate-400 italic">expert-reviewed</span>
                        )}
                        <span className="text-xs font-mono text-slate-400 uppercase">{claim.claim_type.replace(/_/g, " ")}</span>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">{claim.value}</p>
                    </div>
                    <span className="text-xs font-mono text-slate-300 shrink-0">{claim.id}</span>
                  </div>

                  {claim.verdict_rationale && (
                    <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5 mb-3 leading-relaxed">
                      {claim.verdict_rationale}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    {claim.source_refs.map((ref) => (
                      <a
                        key={ref.entry_id}
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-mono text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded hover:bg-blue-100 transition-colors"
                      >
                        {ref.database.includes("Protein") ? "PDB" : ref.database}: {ref.entry_id} ↗
                      </a>
                    ))}
                    {claim.page_anchors[0] && (
                      <a
                        href={claim.page_anchors[0]}
                        className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
                      >
                        View in report ↗
                      </a>
                    )}
                    {claim.evidence_checked_at && (
                      <span className="text-xs text-slate-300 ml-auto">
                        Checked {new Date(claim.evidence_checked_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
