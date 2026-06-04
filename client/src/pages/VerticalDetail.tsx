/**
 * VerticalDetail.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Public landing page for a single research vertical.
 *
 * Shows:
 *  - Vertical name, description, and evidence sources
 *  - Live stats: document count, claim count, verdict distribution
 *  - Top 10 claims ranked by quality score with verdict badges and evidence links
 *  - Call-to-action to submit a paper for audit
 */
import { useParams, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { TopNav } from "@/components/TopNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, FileSearch, TrendingUp, CheckCircle, XCircle, AlertCircle, HelpCircle, BookOpen, Beaker } from "lucide-react";

// ─── Verdict styling ──────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  "Supported": {
    label: "Supported",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: <CheckCircle className="w-3.5 h-3.5" />,
  },
  "Partially Supported": {
    label: "Partial",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    icon: <CheckCircle className="w-3.5 h-3.5" />,
  },
  "Contradicted": {
    label: "Contradicted",
    color: "bg-red-100 text-red-800 border-red-200",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  "Ambiguous": {
    label: "Ambiguous",
    color: "bg-amber-100 text-amber-800 border-amber-200",
    icon: <AlertCircle className="w-3.5 h-3.5" />,
  },
  "Insufficient Evidence": {
    label: "Insufficient",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    icon: <HelpCircle className="w-3.5 h-3.5" />,
  },
  "Needs Expert Review": {
    label: "Expert Review",
    color: "bg-purple-100 text-purple-800 border-purple-200",
    icon: <AlertCircle className="w-3.5 h-3.5" />,
  },
};

function VerdictBadge({ verdict }: { verdict: string | null }) {
  const cfg = VERDICT_CONFIG[verdict ?? ""] ?? {
    label: verdict ?? "Unknown",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    icon: <HelpCircle className="w-3.5 h-3.5" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ─── Quality score bar ────────────────────────────────────────────────────────

function QualityBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">Unscored</span>;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 45 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-card border rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ─── Verdict distribution bar ─────────────────────────────────────────────────

function VerdictDistribution({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) return <p className="text-sm text-muted-foreground">No claims yet.</p>;

  const segments = [
    { key: "Supported", color: "bg-emerald-500", label: "Supported" },
    { key: "Partially Supported", color: "bg-blue-400", label: "Partial" },
    { key: "Contradicted", color: "bg-red-400", label: "Contradicted" },
    { key: "Ambiguous", color: "bg-amber-400", label: "Ambiguous" },
    { key: "Insufficient Evidence", color: "bg-slate-300", label: "Insufficient" },
    { key: "Needs Expert Review", color: "bg-purple-400", label: "Expert Review" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        {segments.map(({ key, color }) => {
          const count = counts[key] ?? 0;
          const pct = (count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={key}
              className={`${color} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${key}: ${count}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        {segments.map(({ key, color, label }) => {
          const count = counts[key] ?? 0;
          if (count === 0) return null;
          const pct = Math.round((count / total) * 100);
          return (
            <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className={`w-2.5 h-2.5 rounded-sm ${color}`} />
              <span>{label}</span>
              <span className="font-medium text-foreground">{count}</span>
              <span>({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function VerticalDetail() {
  const { domainKey } = useParams<{ domainKey: string }>();

  const { data, isLoading, error } = trpc.verticals.detail.useQuery(
    { domainKey: domainKey ?? "" },
    { enabled: !!domainKey }
  );

  if (isLoading) {
    return (
      <>
        <TopNav />
        <div className="container max-w-4xl py-12 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <TopNav />
        <div className="container max-w-4xl py-24 text-center space-y-4">
          <Beaker className="w-12 h-12 text-muted-foreground mx-auto" />
          <h1 className="text-2xl font-bold">Vertical not found</h1>
          <p className="text-muted-foreground">
            The research vertical <code className="font-mono text-sm">{domainKey}</code> does not exist.
          </p>
          <Link href="/verticals">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to all verticals
            </Button>
          </Link>
        </div>
      </>
    );
  }

  const { displayName, description, discoverySearchTerms, stats, topClaims } = data;
  const supportRate = stats.totalClaims > 0
    ? Math.round(((stats.verdictCounts["Supported"] ?? 0) + (stats.verdictCounts["Partially Supported"] ?? 0)) / stats.totalClaims * 100)
    : 0;

  return (
    <>
      <TopNav />
      <div className="container max-w-4xl py-10 space-y-10">

        {/* ── Breadcrumb ── */}
        <Link href="/verticals" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          All research verticals
        </Link>

        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="space-y-3"
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
              <p className="text-muted-foreground max-w-2xl leading-relaxed">{description}</p>
            </div>
            <Link href="/submit">
              <Button className="gap-2 shrink-0">
                <FileSearch className="w-4 h-4" />
                Audit a paper
              </Button>
            </Link>
          </div>

          {/* Search terms */}
          <div className="flex flex-wrap gap-1.5">
            {discoverySearchTerms.slice(0, 6).map((term) => (
              <Badge key={term} variant="secondary" className="text-xs font-normal">{term}</Badge>
            ))}
          </div>
        </motion.div>

        {/* ── Stats grid ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05, ease: [0.23, 1, 0.32, 1] }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          <StatCard label="Papers audited" value={stats.completedDocs} sub={`of ${stats.totalDocs} submitted`} />
          <StatCard label="Claims analysed" value={stats.totalClaims} />
          <StatCard label="Support rate" value={`${supportRate}%`} sub="Supported or Partial" />
          <StatCard
            label="Avg quality score"
            value={stats.avgConfidence !== null ? `${Math.round(stats.avgConfidence * 100)}%` : "—"}
            sub="Composite confidence"
          />
        </motion.div>

        {/* ── Verdict distribution ── */}
        {stats.totalClaims > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.10, ease: [0.23, 1, 0.32, 1] }}
            className="bg-card border rounded-xl p-5 space-y-3"
          >
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">Verdict distribution</h2>
              <span className="text-xs text-muted-foreground ml-auto">{stats.totalClaims} claims</span>
            </div>
            <VerdictDistribution counts={stats.verdictCounts} total={stats.totalClaims} />
          </motion.section>
        )}

        {/* ── Top claims ── */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold">Top claims by evidence quality</h2>
          </div>

          {topClaims.length === 0 ? (
            <div className="bg-card border rounded-xl p-8 text-center space-y-2">
              <FileSearch className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                No scored claims yet in this vertical. Be the first to submit a paper.
              </p>
              <Link href="/submit">
                <Button variant="outline" size="sm" className="mt-2">Submit a paper</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y border rounded-xl overflow-hidden bg-card">
              {topClaims.map((claim, i) => (
                <motion.div
                  key={claim.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: 0.15 + i * 0.03, ease: [0.23, 1, 0.32, 1] }}
                  className="px-4 py-3 flex flex-col gap-2 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-mono text-muted-foreground tabular-nums mt-0.5 w-5 shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <p className="text-sm leading-snug">{claim.claimText}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <VerdictBadge verdict={claim.verdict} />
                        <div className="flex-1 min-w-[120px] max-w-[200px]">
                          <QualityBar score={claim.confidenceScore} />
                        </div>
                        {claim.pdbEvidenceUrl && (
                          <a
                            href={claim.pdbEvidenceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
                          >
                            Evidence
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.section>

        {/* ── CTA ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.25, ease: [0.23, 1, 0.32, 1] }}
          className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <h3 className="font-semibold">Have a paper in this area?</h3>
            <p className="text-sm text-muted-foreground">
              Submit it for automated claim extraction and evidence verification against {displayName} databases.
            </p>
          </div>
          <Link href="/submit">
            <Button className="gap-2 shrink-0">
              <FileSearch className="w-4 h-4" />
              Audit a paper
            </Button>
          </Link>
        </motion.div>

      </div>
    </>
  );
}
