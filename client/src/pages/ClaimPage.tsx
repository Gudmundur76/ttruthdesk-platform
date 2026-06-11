/**
 * ClaimPage.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Public page for a single verified claim.
 *
 * Route: /claim/:id
 *
 * Renders:
 *   - The claim text
 *   - Verdict badge with rationale
 *   - PDB evidence link
 *   - Source document link
 *   - ClaimReview JSON-LD schema (injected into <head>)
 *   - OG meta tags for social sharing
 *   - Link headers (via server-side /api/claim/:id response)
 *   - Contradiction badge embed code
 */

import { useParams, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle, XCircle, HelpCircle, ExternalLink, Copy, Share2, GitBranch, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { SimilarClaimsPanel } from "@/components/SimilarClaimsPanel";
import { SparklineChart } from "@/components/SparklineChart";
import { trpc } from "@/lib/trpc";

// ─── Confidence Sparkline ─────────────────────────────────────────────────────

function ConfidenceSparkline({ claimId }: { claimId: number }) {
  const { data: trend, isLoading } = trpc.confidenceTrend.forClaim.useQuery(
    { claimId },
    { staleTime: 60_000 }
  );

  if (isLoading) return <div className="h-12 animate-pulse bg-slate-800 rounded" />;
  if (!trend || trend.length === 0) return null;

  const W = 200;
  const H = 40;
  const PAD = 4;
  const points = trend.map((p, i) => ({
    x: PAD + (i / Math.max(trend.length - 1, 1)) * (W - PAD * 2),
    y: H - PAD - p.score * (H - PAD * 2),
    score: p.score,
    trigger: p.trigger,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const latest = points[points.length - 1];
  const scoreColor =
    latest.score >= 0.7 ? "#34d399" : latest.score >= 0.4 ? "#fbbf24" : "#f87171";

  return (
    <Card className="bg-slate-900/60 border-slate-700 mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-400 uppercase tracking-wide flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Confidence Trend
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-4">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-48 h-10 flex-shrink-0">
            <defs>
              <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={scoreColor} stopOpacity="0.3" />
                <stop offset="100%" stopColor={scoreColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={`${pathD} L ${points[points.length - 1].x.toFixed(1)} ${H} L ${points[0].x.toFixed(1)} ${H} Z`}
              fill="url(#spark-grad)"
            />
            <path d={pathD} stroke={scoreColor} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
            <circle cx={latest.x} cy={latest.y} r="3" fill={scoreColor} />
          </svg>
          <div className="space-y-1">
            <div className="text-2xl font-bold" style={{ color: scoreColor }}>
              {(latest.score * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-slate-500">
              {trend.length} data point{trend.length !== 1 ? "s" : ""} &middot; latest: {latest.trigger}
            </div>
          </div>
        </div>
        {trend.length > 1 && (
          <div className="mt-3 space-y-1">
            {[...trend].reverse().slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs text-slate-400">
                <span className="capitalize">{p.trigger}</span>
                <span className="font-mono" style={{ color: p.score >= 0.7 ? "#34d399" : p.score >= 0.4 ? "#fbbf24" : "#f87171" }}>
                  {(p.score * 100).toFixed(0)}%
                </span>
                <span className="text-slate-600">{new Date(p.recordedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Composite Truth Timeline ────────────────────────────────────────────────

function CompositeTruthTimeline({ claimId }: { claimId: number }) {
  const { data: history, isLoading } = trpc.claims.getScoreHistory.useQuery(
    { claimId, limit: 30 },
    { staleTime: 60_000 }
  );

  if (isLoading) return <div className="h-12 animate-pulse bg-slate-800 rounded mb-6" />;
  if (!history || history.length < 2) return null;

  const latest = history[history.length - 1];
  const latestScore = latest.compositeTruthScore;
  const latestLabel = latest.compositeTruthLabel ?? undefined;
  const scoreColor =
    latestScore >= 0.7 ? "#22c55e" : latestScore >= 0.4 ? "#f59e0b" : "#ef4444";

  return (
    <Card className="bg-slate-900/60 border-slate-700 mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-400 uppercase tracking-wide flex items-center gap-2">
          <GitBranch className="w-4 h-4" />
          Composite Truth Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-4">
          <SparklineChart
            data={history.map(h => ({
              compositeTruthScore: h.compositeTruthScore,
              compositeTruthLabel: h.compositeTruthLabel,
              snapshotAt: h.snapshotAt,
            }))}
            width={200}
            height={40}
            showLabels
          />
          <div className="space-y-1">
            <div className="text-2xl font-bold" style={{ color: scoreColor }}>
              {(latestScore * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-slate-500 capitalize">
              {latestLabel?.replace(/_/g, " ") ?? "unscored"}
            </div>
          </div>
        </div>
        {history.length > 1 && (
          <div className="mt-3 space-y-1">
            {([...history].reverse().slice(0, 5) as typeof history).map((h) => (
              <div key={h.id} className="flex items-center justify-between text-xs text-slate-400">
                <span className="capitalize">{h.triggerSource?.replace(/_/g, " ")}</span>
                <span className="font-mono" style={{ color: h.compositeTruthScore >= 0.7 ? "#22c55e" : h.compositeTruthScore >= 0.4 ? "#f59e0b" : "#ef4444" }}>
                  {(h.compositeTruthScore * 100).toFixed(0)}%
                </span>
                <span className="text-slate-600">{new Date(h.snapshotAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClaimData {
  id: number;
  claimText: string | null;
  verdict: string | null;
  verdictRationale: string | null;
  pdbId: string | null;
  pdbEvidenceUrl: string | null;
  createdAt: string | null;
  documentId: number;
}

interface DocumentData {
  id: number;
  title: string | null;
  createdAt: string | null;
}

interface ClaimPageData {
  claim: ClaimData;
  document: DocumentData;
  jsonld: Record<string, unknown>;
}

// ─── Verdict helpers ──────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<
  string,
  { color: string; icon: React.ReactNode; bg: string }
> = {
  Supported: {
    color: "text-emerald-400",
    bg: "bg-emerald-400/10 border-emerald-400/30",
    icon: <CheckCircle className="w-5 h-5 text-emerald-400" />,
  },
  "Partially Supported": {
    color: "text-yellow-400",
    bg: "bg-yellow-400/10 border-yellow-400/30",
    icon: <CheckCircle className="w-5 h-5 text-yellow-400" />,
  },
  Contradicted: {
    color: "text-red-400",
    bg: "bg-red-400/10 border-red-400/30",
    icon: <XCircle className="w-5 h-5 text-red-400" />,
  },
  Ambiguous: {
    color: "text-slate-400",
    bg: "bg-slate-400/10 border-slate-400/30",
    icon: <HelpCircle className="w-5 h-5 text-slate-400" />,
  },
  "Insufficient Evidence": {
    color: "text-slate-400",
    bg: "bg-slate-400/10 border-slate-400/30",
    icon: <HelpCircle className="w-5 h-5 text-slate-400" />,
  },
  "Needs Expert Review": {
    color: "text-orange-400",
    bg: "bg-orange-400/10 border-orange-400/30",
    icon: <AlertTriangle className="w-5 h-5 text-orange-400" />,
  },
  "Out of Scope": {
    color: "text-slate-400",
    bg: "bg-slate-400/10 border-slate-400/30",
    icon: <HelpCircle className="w-5 h-5 text-slate-400" />,
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClaimPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [data, setData] = useState<ClaimPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/claim/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Claim not found (${r.status})`);
        return r.json() as Promise<ClaimPageData>;
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  // Inject JSON-LD ClaimReview schema and OG meta tags
  useEffect(() => {
    if (!data) return;

    // JSON-LD
    const existingScript = document.getElementById("claim-jsonld");
    if (existingScript) existingScript.remove();
    const script = document.createElement("script");
    script.id = "claim-jsonld";
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(data.jsonld);
    document.head.appendChild(script);

    // Page title
    document.title = `Claim #${data.claim.id}: ${data.claim.verdict ?? "Unknown"} — Truth Desk`;

    // OG meta tags
    const setMeta = (property: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    setMeta("og:title", `Claim #${data.claim.id}: ${data.claim.verdict ?? "Unknown"} — Truth Desk`);
    setMeta("og:description", data.claim.claimText?.slice(0, 200) ?? "Scientific claim verification");
    setMeta("og:url", window.location.href);
    setMeta("og:type", "article");

    return () => {
      const s = document.getElementById("claim-jsonld");
      if (s) s.remove();
      document.title = "Truth Desk";
    };
  }, [data]);

  const verdictCfg = VERDICT_CONFIG[data?.claim.verdict ?? ""] ?? VERDICT_CONFIG["Ambiguous"];

  const badgeEmbedCode = data
    ? `<a href="${window.location.origin}/claim/${data.claim.id}" target="_blank" rel="noopener">
  <img src="${window.location.origin}/badge/${data.claim.id}.svg" alt="Truth Desk: ${data.claim.verdict ?? 'Verified'}" />
</a>`
    : "";

  const copyBadge = () => {
    navigator.clipboard.writeText(badgeEmbedCode).then(() => {
      toast.success("Badge embed code copied!");
    });
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      toast.success("Claim URL copied!");
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] text-white">
        <TopNav />
        <div className="max-w-3xl mx-auto px-4 py-10 space-y-4">
          <Skeleton className="h-6 w-48 bg-slate-800" />
          <Skeleton className="h-32 w-full bg-slate-800" />
          <Skeleton className="h-24 w-full bg-slate-800" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] text-white">
        <TopNav />
        <div className="max-w-3xl mx-auto px-4 py-10 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Claim Not Found</h1>
          <p className="text-slate-400 mb-6">{error ?? "This claim does not exist or has been removed."}</p>
          <Button variant="outline" onClick={() => navigate("/registry")}>
            Browse Registry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      <TopNav />

      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500 mb-6">
          <button onClick={() => navigate("/registry")} className="hover:text-slate-300 transition-colors">
            Registry
          </button>
          <span>/</span>
          <button
            onClick={() => navigate(`/audit/${data.document.id}`)}
            className="hover:text-slate-300 transition-colors"
          >
            Document #{data.document.id}
          </button>
          <span>/</span>
          <span className="text-slate-300">Claim #{data.claim.id}</span>
        </nav>

        {/* Verdict banner */}
        <div className={`rounded-xl border p-5 mb-6 ${verdictCfg.bg}`}>
          <div className="flex items-center gap-3 mb-2">
            {verdictCfg.icon}
            <span className={`text-xl font-bold ${verdictCfg.color}`}>
              {data.claim.verdict ?? "Unknown"}
            </span>
          </div>
          <p className="text-slate-300 text-sm leading-relaxed">
            {data.claim.verdictRationale ?? "No rationale provided."}
          </p>
        </div>

        {/* Claim text */}
        <Card className="bg-slate-900/60 border-slate-700 mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400 uppercase tracking-wide">
              Claim Text
            </CardTitle>
          </CardHeader>
          <CardContent>
            <blockquote className="text-white text-base leading-relaxed border-l-2 border-slate-600 pl-4 italic">
              {data.claim.claimText ?? "No claim text available."}
            </blockquote>
          </CardContent>
        </Card>

        {/* Evidence */}
        {data.claim.pdbEvidenceUrl && (
          <Card className="bg-slate-900/60 border-slate-700 mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-400 uppercase tracking-wide">
                Evidence Source
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <Badge variant="outline" className="text-blue-400 border-blue-400/30">
                PDB: {data.claim.pdbId ?? "—"}
              </Badge>
              <a
                href={data.claim.pdbEvidenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm transition-colors"
              >
                View on RCSB PDB <ExternalLink className="w-3 h-3" />
              </a>
            </CardContent>
          </Card>
        )}

        {/* Confidence trend sparkline */}
        <ConfidenceSparkline claimId={data.claim.id} />

        {/* Composite Truth Timeline — Phase 108 */}
        <CompositeTruthTimeline claimId={data.claim.id} />

        {/* Source document */}
        <Card className="bg-slate-900/60 border-slate-700 mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400 uppercase tracking-wide">
              Source Document
            </CardTitle>
          </CardHeader>
          <CardContent>
            <button
              onClick={() => navigate(`/audit/${data.document.id}`)}
              className="text-violet-400 hover:text-violet-300 text-sm transition-colors"
            >
              {data.document.title ?? `Document #${data.document.id}`}
            </button>
            {data.claim.createdAt && (
              <p className="text-slate-500 text-xs mt-1">
                Verified {new Date(data.claim.createdAt).toLocaleDateString()}
              </p>
            )}
          </CardContent>
        </Card>

        <Separator className="bg-slate-800 mb-6" />

        {/* Share / embed section */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
            Share & Cite
          </h2>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/provenance/${data.claim.id}`)}
              className="gap-2 border-violet-700 text-violet-400 hover:text-violet-200 hover:border-violet-500"
            >
              <GitBranch className="w-4 h-4" />
              View Provenance
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyLink}
              className="gap-2 border-slate-700 text-slate-300 hover:text-white"
            >
              <Share2 className="w-4 h-4" />
              Copy Claim URL
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyBadge}
              className="gap-2 border-slate-700 text-slate-300 hover:text-white"
            >
              <Copy className="w-4 h-4" />
              Copy Badge Embed
            </Button>
          </div>

          {/* Badge preview */}
          <div className="rounded-lg bg-slate-900 border border-slate-700 p-4">
            <p className="text-xs text-slate-500 mb-3">Embed this verification badge on your site:</p>
            <img
              src={`/badge/${data.claim.id}.svg`}
              alt={`Truth Desk: ${data.claim.verdict ?? "Verified"}`}
              className="mb-3"
            />
            <pre className="text-xs text-slate-400 bg-slate-950 rounded p-3 overflow-x-auto whitespace-pre-wrap">
              {badgeEmbedCode}
            </pre>
          </div>

          {/* Similar claims */}
          <div className="pt-2">
            <SimilarClaimsPanel
              claimId={data.claim.id}
              threshold={0.35}
              topK={6}
              className="bg-slate-900/50 border-slate-700"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
