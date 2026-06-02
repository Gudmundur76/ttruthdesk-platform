import { TopNav } from "@/components/TopNav";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";

type FeedItem = {
  id: number;
  documentId: number;
  source: "pubmed" | "biorxiv" | "patent";
  title: string;
  summary: string | null;
  url: string | null;
  relevanceScore: number | null;
  publishedAt: Date | null;
  discoveredAt: Date;
};

const SOURCE_META: Record<string, { label: string; color: string; icon: string }> = {
  pubmed: {
    label: "PubMed",
    color: "text-blue-700 bg-blue-50 border-blue-200",
    icon: "🔬",
  },
  biorxiv: {
    label: "bioRxiv",
    color: "text-green-700 bg-green-50 border-green-200",
    icon: "🧬",
  },
  patent: {
    label: "Patent",
    color: "text-amber-700 bg-amber-50 border-amber-200",
    icon: "📄",
  },
};

function RelevanceDot({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? "bg-red-500" : pct >= 60 ? "bg-amber-400" : pct >= 40 ? "bg-yellow-300" : "bg-slate-300";
  return (
    <span className="flex items-center gap-1 text-xs text-slate-500">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {pct}% relevance
    </span>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  const meta = SOURCE_META[item.source] ?? SOURCE_META.pubmed;
  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${meta.color}`}>
            <span>{meta.icon}</span>
            {meta.label}
          </span>
          <RelevanceDot score={item.relevanceScore} />
        </div>
        <span className="text-xs text-slate-400 shrink-0">
          {item.publishedAt
            ? new Date(item.publishedAt).toLocaleDateString()
            : new Date(item.discoveredAt).toLocaleDateString()}
        </span>
      </div>
      <h3 className="font-semibold text-slate-900 text-sm leading-snug mb-2">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue-700 transition-colors"
          >
            {item.title}
          </a>
        ) : (
          item.title
        )}
      </h3>
      {item.summary && (
        <p className="text-xs text-slate-500 leading-relaxed line-clamp-3">{item.summary}</p>
      )}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-3 text-xs text-blue-700 hover:underline"
        >
          View source ↗
        </a>
      )}
    </div>
  );
}

export default function MonitoringFeed() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const { data: feed, isLoading } = trpc.monitoring.all.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <TopNav />
        <div className="container py-24 text-center max-w-md">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Sign in to view the monitoring feed</h2>
          <p className="text-slate-500 text-sm mb-6">
            The monitoring feed tracks new publications and patents relevant to your audited documents.
          </p>
          <a
            href={getLoginUrl()}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            Sign in
          </a>
        </div>
      </div>
    );
  }

  const items = (feed ?? []) as FeedItem[];

  // Group by source
  const bySource: Record<string, FeedItem[]> = { pubmed: [], biorxiv: [], patent: [] };
  for (const item of items) {
    bySource[item.source]?.push(item);
  }

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="container py-10 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Monitoring Feed</h1>
          <p className="text-slate-500 text-sm">
            New publications and patents discovered across PubMed, bioRxiv, and patent databases — matched against your audited documents.
          </p>
        </div>

        {/* Stats bar */}
        {items.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            {(["pubmed", "biorxiv", "patent"] as const).map((src) => {
              const meta = SOURCE_META[src];
              const count = bySource[src].length;
              return (
                <div key={src} className="bg-white rounded-xl border border-border p-4 shadow-sm text-center">
                  <div className="text-2xl mb-1">{meta.icon}</div>
                  <div className="text-xl font-bold text-slate-900">{count}</div>
                  <div className="text-xs text-slate-500">{meta.label} items</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && items.length === 0 && (
          <div className="bg-white rounded-xl border border-border p-16 text-center shadow-sm">
            <div className="text-4xl mb-4">📡</div>
            <h3 className="font-semibold text-slate-900 mb-2">No feed items yet</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              The monitoring system will automatically discover new publications and patents relevant to your audited documents. Check back after submitting your first document.
            </p>
            <button
              onClick={() => navigate("/submit")}
              className="mt-6 inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 transition-colors"
            >
              Submit a document
            </button>
          </div>
        )}

        {/* Feed items — all mixed, sorted by date */}
        {!isLoading && items.length > 0 && (
          <div className="space-y-4">
            {items.map((item) => (
              <FeedCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
