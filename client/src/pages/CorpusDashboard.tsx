/**
 * CorpusDashboard.tsx
 *
 * Public-facing corpus metrics dashboard for citation.is.
 * Shows live claim counts, verdict distribution, MRAgent cache stats,
 * SIA self-improvement loop status, and top verticals.
 *
 * Fetches from GET /api/public/corpus-dashboard with a 60-second refresh.
 * Falls back gracefully if the API is unavailable.
 */
import { useEffect, useState, useCallback } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// ─── Types ────────────────────────────────────────────────────────────────────

interface VerticalStat {
  domain: string;
  totalClaims: number;
  supportedClaims: number;
}

interface DashboardSnapshot {
  ok: boolean;
  live: boolean;
  generatedAt: string;
  platform: {
    totalDocuments: number;
    totalClaims: number;
    supportedVerdicts: number;
    verifiedSources: number;
  };
  growth: {
    claimsToday: number;
    papersToday: number;
    graphNodesToday: number;
    totalClaims: number;
    totalGraphNodes: number;
    totalGraphEdges: number;
  };
  verdictDistribution: {
    supported: number;
    partiallySupported: number;
    contradicted: number;
    insufficientEvidence: number;
  };
  verticals: VerticalStat[];
  mragent: {
    totalEpisodes: number;
    cacheHitRate: number;
    available: boolean;
  };
  sia: {
    generation: number;
    lastRunAt: string | null;
    f1Before: number | null;
    f1After: number | null;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function pct(a: number, total: number): string {
  if (total === 0) return "0%";
  return `${((a / total) * 100).toFixed(1)}%`;
}

function domainLabel(domain: string): string {
  return domain.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </div>
      <div className={`text-3xl font-bold tabular-nums ${accent ?? "text-slate-900"}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function VerdictChart({ dist }: { dist: DashboardSnapshot["verdictDistribution"] }) {
  const data = {
    labels: ["Supported", "Partially Supported", "Contradicted", "Insufficient Evidence"],
    datasets: [
      {
        data: [
          dist.supported,
          dist.partiallySupported,
          dist.contradicted,
          dist.insufficientEvidence,
        ],
        backgroundColor: [
          "rgba(16, 185, 129, 0.85)",
          "rgba(45, 212, 191, 0.85)",
          "rgba(239, 68, 68, 0.85)",
          "rgba(203, 213, 225, 0.85)",
        ],
        borderRadius: 4,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"bar">) =>
            ` ${ctx.label}: ${fmt(ctx.parsed.y ?? 0)}`,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { font: { size: 11 } },
        grid: { color: "rgba(0,0,0,0.04)" },
      },
      x: { ticks: { font: { size: 11 } } },
    },
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-slate-400 mb-4">
        Verdict Distribution
      </div>
      <Bar data={data} options={options} height={120} />
    </div>
  );
}

function VerticalTable({ verticals }: { verticals: VerticalStat[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Top Verticals
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs text-slate-400">
            <th className="px-5 py-2 text-left font-medium">Domain</th>
            <th className="px-5 py-2 text-right font-medium">Claims</th>
            <th className="px-5 py-2 text-right font-medium">Supported</th>
            <th className="px-5 py-2 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          {verticals.map((v, i) => (
            <tr
              key={v.domain}
              className={`border-b border-slate-50 ${i % 2 === 0 ? "" : "bg-slate-50/40"}`}
            >
              <td className="px-5 py-3 font-medium text-slate-700">
                {domainLabel(v.domain)}
              </td>
              <td className="px-5 py-3 text-right font-mono text-slate-500">
                {fmt(v.totalClaims)}
              </td>
              <td className="px-5 py-3 text-right font-mono text-emerald-600">
                {fmt(v.supportedClaims)}
              </td>
              <td className="px-5 py-3 text-right font-mono text-slate-400">
                {pct(v.supportedClaims, v.totalClaims)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SIAPanel({ sia, live }: { sia: DashboardSnapshot["sia"]; live: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Self-Improvement Loop (SIA)
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            live
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-slate-100 text-slate-500 border border-slate-200"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              live ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
            }`}
          />
          {live ? "Running" : "Offline"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-slate-900">{sia.generation}</div>
          <div className="text-xs text-slate-400 mt-0.5">Generation</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-slate-900">
            {sia.f1Before != null ? sia.f1Before.toFixed(3) : "—"}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">F1 Before</div>
        </div>
        <div>
          <div
            className={`text-2xl font-bold ${
              sia.f1After != null && sia.f1Before != null && sia.f1After > sia.f1Before
                ? "text-emerald-600"
                : "text-slate-900"
            }`}
          >
            {sia.f1After != null ? sia.f1After.toFixed(3) : "—"}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">F1 After</div>
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-400 leading-relaxed">
        Every verified claim feeds back into the SIA training pipeline. Each generation
        improves the verdict engine's precision without human intervention.
      </p>
    </div>
  );
}

function MRAgentPanel({ mragent }: { mragent: DashboardSnapshot["mragent"] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
          MRAgent Memory
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            mragent.available
              ? "bg-blue-50 text-blue-700 border border-blue-200"
              : "bg-slate-100 text-slate-500 border border-slate-200"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              mragent.available ? "bg-blue-500" : "bg-slate-400"
            }`}
          />
          {mragent.available ? "Connected" : "Offline"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 text-center">
        <div>
          <div className="text-2xl font-bold text-slate-900">
            {fmt(mragent.totalEpisodes)}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Episodes stored</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-slate-900">
            {mragent.available ? `${(mragent.cacheHitRate * 100).toFixed(1)}%` : "—"}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Cache hit rate</div>
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-400 leading-relaxed">
        Repeat claims return from memory in under 100ms. Every new verdict is stored
        with its citation evidence, compounding accuracy over time.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CorpusDashboard() {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/public/corpus-dashboard");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DashboardSnapshot;
      setData(json);
      setLastRefresh(new Date());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 60_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Corpus Dashboard</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Live metrics from the citation.is verification engine
              </p>
            </div>
            <div className="flex items-center gap-3">
              {data?.live && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              )}
              {data && !data.live && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 border border-amber-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Snapshot
                </span>
              )}
              {lastRefresh && (
                <span className="text-xs text-slate-400">
                  Updated {lastRefresh.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {!data ? (
          <div className="flex items-center justify-center py-24">
            {error ? (
              <p className="text-sm text-slate-500">Could not load dashboard data.</p>
            ) : (
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Top metrics row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard
                label="Total Claims"
                value={fmt(data.platform.totalClaims)}
                sub={`+${data.growth.claimsToday} today`}
              />
              <MetricCard
                label="Supported"
                value={fmt(data.platform.supportedVerdicts)}
                sub={pct(data.platform.supportedVerdicts, data.platform.totalClaims)}
                accent="text-emerald-600"
              />
              <MetricCard
                label="Documents"
                value={fmt(data.platform.totalDocuments)}
                sub={`${data.growth.papersToday} papers today`}
              />
              <MetricCard
                label="Graph Nodes"
                value={fmt(data.growth.totalGraphNodes)}
                sub={`+${data.growth.graphNodesToday} today`}
              />
            </div>

            {/* Verdict distribution chart */}
            <VerdictChart dist={data.verdictDistribution} />

            {/* Two-column: SIA + MRAgent */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SIAPanel sia={data.sia} live={data.live} />
              <MRAgentPanel mragent={data.mragent} />
            </div>

            {/* Verticals table */}
            <VerticalTable verticals={data.verticals} />

            {/* Footer */}
            <p className="text-center text-xs text-slate-400">
              Data refreshes every 60 seconds · Powered by citation.is ·{" "}
              <a
                href="/api/public/corpus-dashboard"
                className="underline hover:text-slate-600"
                target="_blank"
                rel="noreferrer"
              >
                Raw JSON
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
