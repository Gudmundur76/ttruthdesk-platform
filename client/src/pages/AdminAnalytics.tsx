import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  Network,
  Zap,
  TrendingUp,
  Activity,
  AlertTriangle,
  Award,
  Layers,
} from "lucide-react";

// ─── Colour helpers ──────────────────────────────────────────────────────────

const VERDICT_COLORS: Record<string, string> = {
  Supported: "bg-emerald-500",
  Contradicted: "bg-rose-500",
  "Partially Supported": "bg-amber-400",
  Ambiguous: "bg-slate-400",
  "Insufficient Evidence": "bg-slate-300",
  "Out of Scope": "bg-violet-400",
  "Needs Expert Review": "bg-orange-400",
};

const STATUS_BADGE: Record<string, string> = {
  complete: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  pending: "bg-amber-100 text-amber-800",
  processing: "bg-blue-100 text-blue-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  stalled: "bg-orange-100 text-orange-800",
  document: "bg-indigo-100 text-indigo-800",
  task: "bg-violet-100 text-violet-800",
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "text-foreground",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VerdictBar({ verdict, count, percentage }: { verdict: string; count: number; percentage: number }) {
  const color = VERDICT_COLORS[verdict] ?? "bg-slate-400";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{verdict}</span>
        <span className="text-muted-foreground">{count.toLocaleString()} ({percentage}%)</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function TrendSparkline({ data }: { data: { date: string; documentsProcessed: number; claimsExtracted: number }[] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>;

  const maxClaims = Math.max(...data.map((d) => d.claimsExtracted), 1);
  const maxDocs = Math.max(...data.map((d) => d.documentsProcessed), 1);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground mb-2 font-medium">Claims extracted / day</p>
        <div className="flex items-end gap-0.5 h-16">
          {data.map((d) => (
            <div
              key={d.date}
              className="flex-1 bg-primary/80 rounded-t transition-all duration-500 hover:bg-primary"
              style={{ height: `${Math.max(4, (d.claimsExtracted / maxClaims) * 64)}px` }}
              title={`${d.date}: ${d.claimsExtracted} claims`}
            />
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2 font-medium">Documents processed / day</p>
        <div className="flex items-end gap-0.5 h-10">
          {data.map((d) => (
            <div
              key={d.date}
              className="flex-1 bg-emerald-500/70 rounded-t transition-all duration-500 hover:bg-emerald-500"
              style={{ height: `${Math.max(4, (d.documentsProcessed / maxDocs) * 40)}px` }}
              title={`${d.date}: ${d.documentsProcessed} docs`}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function ConfidenceHistogram({ data }: { data: { range: string; count: number }[] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">No scored claims yet</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-24">
      {data.map((d) => (
        <div key={d.range} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-violet-500/70 rounded-t hover:bg-violet-500 transition-colors"
            style={{ height: `${Math.max(4, (d.count / max) * 80)}px` }}
            title={`${d.range}: ${d.count} claims`}
          />
          <span className="text-[9px] text-muted-foreground rotate-45 origin-left whitespace-nowrap">{d.range}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function AdminAnalytics() {
  const { data, isLoading, error } = trpc.admin.analyticsOverview.useQuery(undefined, {
    refetchInterval: 30_000, // refresh every 30 s
  });

  const completionRate = useMemo(() => {
    if (!data?.overview) return null;
    const { completedDocuments, totalDocuments } = data.overview;
    return totalDocuments > 0 ? Math.round((completedDocuments / totalDocuments) * 100) : 0;
  }, [data]);

  if (error) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {error.message.includes("FORBIDDEN")
                ? "Admin access required to view analytics."
                : `Failed to load analytics: ${error.message}`}
            </AlertDescription>
          </Alert>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              Analytics Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time platform health — refreshes every 30 seconds
            </p>
          </div>
          {data && (
            <Badge variant="outline" className="text-xs">
              Live
            </Badge>
          )}
        </div>

        {/* Overview stat cards */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={FileText}
              label="Total Documents"
              value={data!.overview.totalDocuments.toLocaleString()}
              sub={`${completionRate}% completion rate`}
            />
            <StatCard
              icon={CheckCircle}
              label="Completed"
              value={data!.overview.completedDocuments.toLocaleString()}
              color="text-emerald-600"
            />
            <StatCard
              icon={XCircle}
              label="Failed"
              value={data!.overview.failedDocuments.toLocaleString()}
              color={data!.overview.failedDocuments > 0 ? "text-rose-600" : "text-foreground"}
            />
            <StatCard
              icon={Clock}
              label="Pending"
              value={data!.overview.pendingDocuments.toLocaleString()}
              color="text-amber-600"
            />
            <StatCard
              icon={BarChart3}
              label="Total Claims"
              value={data!.overview.totalClaims.toLocaleString()}
              sub={`${data!.overview.verifiedClaims.toLocaleString()} verified`}
            />
            <StatCard
              icon={AlertTriangle}
              label="Contradictions"
              value={data!.overview.contradictionCount.toLocaleString()}
              color={data!.overview.contradictionCount > 0 ? "text-rose-600" : "text-foreground"}
            />
            <StatCard
              icon={Network}
              label="Graph Entities"
              value={data!.overview.totalEntities.toLocaleString()}
              sub={`${data!.overview.totalRelations.toLocaleString()} relations`}
            />
            <StatCard
              icon={Zap}
              label="Active Agents"
              value={data!.overview.coordTasksActive.toLocaleString()}
              sub={`${data!.overview.coordTasksCompleted.toLocaleString()} completed`}
              color={data!.overview.coordTasksActive > 0 ? "text-blue-600" : "text-foreground"}
            />
          </div>
        )}

        {/* Middle row: Verdict distribution + Processing trend */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Verdict distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="h-4 w-4 text-primary" />
                Verdict Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6" />)}
                </div>
              ) : data!.verdicts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No verified claims yet</p>
              ) : (
                <div className="space-y-3">
                  {data!.verdicts.map((v) => (
                    <VerdictBar key={v.verdict} verdict={v.verdict} count={v.count} percentage={v.percentage} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Processing trend */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                30-Day Processing Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-40" />
              ) : (
                <TrendSparkline data={data!.trend} />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Second row: Confidence histogram + Top entities */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Confidence histogram */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Confidence Score Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-32" />
              ) : (
                <ConfidenceHistogram data={data!.quality} />
              )}
            </CardContent>
          </Card>

          {/* Top entities */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                Top Graph Entities
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
                </div>
              ) : data!.topEntities.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No entities yet</p>
              ) : (
                <div className="space-y-2">
                  {data!.topEntities.map((e) => (
                    <div key={e.canonicalName} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="text-[10px] shrink-0">{e.entityType}</Badge>
                        <span className="text-sm font-medium truncate">{e.canonicalName}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">
                        {e.claimCount} rel.
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Vertical health */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Vertical Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-40" />
            ) : data!.verticals.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No verticals with data yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left py-2 pr-4 font-medium">Vertical</th>
                      <th className="text-right py-2 px-2 font-medium">Docs</th>
                      <th className="text-right py-2 px-2 font-medium">Claims</th>
                      <th className="text-right py-2 px-2 font-medium">Completed</th>
                      <th className="text-right py-2 px-2 font-medium">Failed</th>
                      <th className="text-right py-2 pl-2 font-medium">Avg Conf.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.verticals.map((v) => (
                      <tr key={v.verticalDomain} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                        <td className="py-2 pr-4 font-medium">{v.verticalDomain ?? "—"}</td>
                        <td className="text-right py-2 px-2 tabular-nums">{v.documentCount.toLocaleString()}</td>
                        <td className="text-right py-2 px-2 tabular-nums">{v.claimCount.toLocaleString()}</td>
                        <td className="text-right py-2 px-2 tabular-nums text-emerald-600">{v.completedCount.toLocaleString()}</td>
                        <td className="text-right py-2 px-2 tabular-nums text-rose-600">{v.failedCount.toLocaleString()}</td>
                        <td className="text-right py-2 pl-2 tabular-nums">
                          {v.avgConfidence != null ? `${(v.avgConfidence * 100).toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent activity feed */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : data!.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
            ) : (
              <div className="space-y-2">
                {data!.activity.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
                    <Badge
                      className={`text-[10px] shrink-0 ${STATUS_BADGE[item.type] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {item.type}
                    </Badge>
                    <span className="text-sm font-medium truncate flex-1">{item.label}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${STATUS_BADGE[item.status ?? ""] ?? ""}`}
                    >
                      {item.status ?? "—"}
                    </Badge>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {item.timestamp
                        ? new Date(item.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
