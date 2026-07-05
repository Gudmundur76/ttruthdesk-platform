/**
 * CorpusDashboard.tsx
 *
 * Public-facing corpus metrics dashboard for citation.is.
 * Shows live claim counts, verdict distribution, MRAgent cache stats,
 * SIA self-improvement loop status, and top verticals.
 *
 * Fetches from GET /api/public/corpus-dashboard with a 60-second refresh.
 * Falls back to mock data if the API is unavailable.
 */
import { createSignal, onMount, onCleanup, For, Show } from "solid-js";

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
  recentContradictions: unknown[];
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

function MetricCard(props: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="text-xs font-medium uppercase tracking-wider text-slate-400 mb-1">
        {props.label}
      </div>
      <div
        class={`text-3xl font-bold tabular-nums ${props.accent ?? "text-slate-900"}`}
      >
        {props.value}
      </div>
      <Show when={props.sub}>
        <div class="mt-1 text-xs text-slate-400">{props.sub}</div>
      </Show>
    </div>
  );
}

function VerdictBar(props: { dist: DashboardSnapshot["verdictDistribution"] }) {
  const total =
    props.dist.supported +
    props.dist.partiallySupported +
    props.dist.contradicted +
    props.dist.insufficientEvidence;

  const bars = [
    {
      label: "Supported",
      value: props.dist.supported,
      color: "bg-emerald-500",
    },
    {
      label: "Partially Supported",
      value: props.dist.partiallySupported,
      color: "bg-teal-400",
    },
    {
      label: "Contradicted",
      value: props.dist.contradicted,
      color: "bg-red-500",
    },
    {
      label: "Insufficient Evidence",
      value: props.dist.insufficientEvidence,
      color: "bg-slate-300",
    },
  ];

  return (
    <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="text-xs font-medium uppercase tracking-wider text-slate-400 mb-3">
        Verdict Distribution
      </div>
      {/* Stacked bar */}
      <div class="flex h-4 w-full overflow-hidden rounded-full mb-4">
        <For each={bars}>
          {(bar) => (
            <div
              class={`${bar.color} transition-all`}
              style={{ width: pct(bar.value, total) }}
              title={`${bar.label}: ${fmt(bar.value)}`}
            />
          )}
        </For>
      </div>
      {/* Legend */}
      <div class="grid grid-cols-2 gap-2">
        <For each={bars}>
          {(bar) => (
            <div class="flex items-center gap-2 text-xs text-slate-600">
              <span class={`inline-block h-2.5 w-2.5 rounded-sm ${bar.color}`} />
              <span>{bar.label}</span>
              <span class="ml-auto font-mono text-slate-400">
                {fmt(bar.value)}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function VerticalTable(props: { verticals: VerticalStat[] }) {
  return (
    <div class="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-100">
        <span class="text-xs font-medium uppercase tracking-wider text-slate-400">
          Top Verticals
        </span>
      </div>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-xs text-slate-400">
            <th class="px-5 py-2 text-left font-medium">Domain</th>
            <th class="px-5 py-2 text-right font-medium">Claims</th>
            <th class="px-5 py-2 text-right font-medium">Supported</th>
            <th class="px-5 py-2 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.verticals}>
            {(v, i) => (
              <tr
                class={`border-b border-slate-50 ${
                  i() % 2 === 0 ? "" : "bg-slate-50/40"
                }`}
              >
                <td class="px-5 py-3 font-medium text-slate-700">
                  {domainLabel(v.domain)}
                </td>
                <td class="px-5 py-3 text-right font-mono text-slate-500">
                  {fmt(v.totalClaims)}
                </td>
                <td class="px-5 py-3 text-right font-mono text-emerald-600">
                  {fmt(v.supportedClaims)}
                </td>
                <td class="px-5 py-3 text-right font-mono text-slate-400">
                  {pct(v.supportedClaims, v.totalClaims)}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function SIAPanel(props: { sia: DashboardSnapshot["sia"]; live: boolean }) {
  return (
    <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs font-medium uppercase tracking-wider text-slate-400">
          Self-Improvement Loop (SIA)
        </span>
        <span
          class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            props.live
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-slate-100 text-slate-500 border border-slate-200"
          }`}
        >
          <span
            class={`h-1.5 w-1.5 rounded-full ${
              props.live ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
            }`}
          />
          {props.live ? "Running" : "Offline"}
        </span>
      </div>
      <div class="grid grid-cols-3 gap-4 text-center">
        <div>
          <div class="text-2xl font-bold text-slate-900">
            {props.sia.generation}
          </div>
          <div class="text-xs text-slate-400 mt-0.5">Generation</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-slate-900">
            {props.sia.f1Before != null
              ? props.sia.f1Before.toFixed(3)
              : "—"}
          </div>
          <div class="text-xs text-slate-400 mt-0.5">F1 Before</div>
        </div>
        <div>
          <div
            class={`text-2xl font-bold ${
              props.sia.f1After != null &&
              props.sia.f1Before != null &&
              props.sia.f1After > props.sia.f1Before
                ? "text-emerald-600"
                : "text-slate-900"
            }`}
          >
            {props.sia.f1After != null ? props.sia.f1After.toFixed(3) : "—"}
          </div>
          <div class="text-xs text-slate-400 mt-0.5">F1 After</div>
        </div>
      </div>
      <p class="mt-4 text-xs text-slate-400 leading-relaxed">
        Every verified claim is stored in MRAgent memory and feeds back into
        the SIA training pipeline. Each generation improves the verdict engine's
        precision without human intervention.
      </p>
    </div>
  );
}

function MRAgentPanel(props: { mragent: DashboardSnapshot["mragent"] }) {
  return (
    <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs font-medium uppercase tracking-wider text-slate-400">
          MRAgent Memory
        </span>
        <span
          class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            props.mragent.available
              ? "bg-blue-50 text-blue-700 border border-blue-200"
              : "bg-slate-100 text-slate-500 border border-slate-200"
          }`}
        >
          <span
            class={`h-1.5 w-1.5 rounded-full ${
              props.mragent.available ? "bg-blue-500" : "bg-slate-400"
            }`}
          />
          {props.mragent.available ? "Connected" : "Offline"}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-4 text-center">
        <div>
          <div class="text-2xl font-bold text-slate-900">
            {fmt(props.mragent.totalEpisodes)}
          </div>
          <div class="text-xs text-slate-400 mt-0.5">Episodes stored</div>
        </div>
        <div>
          <div class="text-2xl font-bold text-slate-900">
            {props.mragent.available
              ? `${(props.mragent.cacheHitRate * 100).toFixed(1)}%`
              : "—"}
          </div>
          <div class="text-xs text-slate-400 mt-0.5">Cache hit rate</div>
        </div>
      </div>
      <p class="mt-4 text-xs text-slate-400 leading-relaxed">
        Repeat claims return from memory in under 100ms. Every new verdict is
        stored with its citation evidence, compounding accuracy over time.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CorpusDashboard() {
  const [data, setData] = createSignal<DashboardSnapshot | null>(null);
  const [error, setError] = createSignal(false);
  const [lastRefresh, setLastRefresh] = createSignal<Date | null>(null);

  async function fetchData() {
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
  }

  onMount(() => {
    fetchData();
    const timer = setInterval(fetchData, 60_000);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <div class="min-h-screen bg-slate-50">
      {/* Header */}
      <div class="border-b border-slate-200 bg-white">
        <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div class="flex items-center justify-between">
            <div>
              <h1 class="text-xl font-semibold text-slate-900">
                Corpus Dashboard
              </h1>
              <p class="mt-0.5 text-sm text-slate-500">
                Live metrics from the citation.is verification engine
              </p>
            </div>
            <div class="flex items-center gap-3">
              <Show when={data()?.live}>
                <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                  <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              </Show>
              <Show when={!data()?.live && data()}>
                <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 border border-amber-200">
                  <span class="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Snapshot
                </span>
              </Show>
              <Show when={lastRefresh()}>
                <span class="text-xs text-slate-400">
                  Updated {lastRefresh()!.toLocaleTimeString()}
                </span>
              </Show>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Show
          when={data()}
          fallback={
            <div class="flex items-center justify-center py-24">
              <Show
                when={!error()}
                fallback={
                  <p class="text-sm text-slate-500">
                    Could not load dashboard data.
                  </p>
                }
              >
                <div class="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              </Show>
            </div>
          }
        >
          {(snapshot) => (
            <div class="space-y-6">
              {/* Top metrics row */}
              <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <MetricCard
                  label="Total Claims"
                  value={fmt(snapshot().platform.totalClaims)}
                  sub={`+${snapshot().growth.claimsToday} today`}
                />
                <MetricCard
                  label="Supported"
                  value={fmt(snapshot().platform.supportedVerdicts)}
                  sub={pct(
                    snapshot().platform.supportedVerdicts,
                    snapshot().platform.totalClaims
                  )}
                  accent="text-emerald-600"
                />
                <MetricCard
                  label="Documents"
                  value={fmt(snapshot().platform.totalDocuments)}
                  sub={`${snapshot().growth.papersToday} papers today`}
                />
                <MetricCard
                  label="Graph Nodes"
                  value={fmt(snapshot().growth.totalGraphNodes)}
                  sub={`+${snapshot().growth.graphNodesToday} today`}
                />
              </div>

              {/* Verdict distribution */}
              <VerdictBar dist={snapshot().verdictDistribution} />

              {/* Two-column: SIA + MRAgent */}
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SIAPanel sia={snapshot().sia} live={snapshot().live} />
                <MRAgentPanel mragent={snapshot().mragent} />
              </div>

              {/* Verticals table */}
              <VerticalTable verticals={snapshot().verticals} />

              {/* Footer */}
              <p class="text-center text-xs text-slate-400">
                Data refreshes every 60 seconds · Powered by citation.is ·{" "}
                <a
                  href="/api/public/corpus-dashboard"
                  class="underline hover:text-slate-600"
                  target="_blank"
                >
                  Raw JSON
                </a>
              </p>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
