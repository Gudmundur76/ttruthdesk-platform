import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeftRight, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, Info } from "lucide-react";

const VERDICT_COLORS: Record<string, string> = {
  Supported: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Contradicted: "bg-red-500/15 text-red-400 border-red-500/30",
  "Partially Supported": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Ambiguous: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  "Insufficient Evidence": "bg-slate-500/15 text-slate-400 border-slate-500/30",
  "Out of Scope": "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  "Needs Expert Review": "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-muted-foreground text-xs italic">—</span>;
  return (
    <Badge variant="outline" className={`text-xs border ${VERDICT_COLORS[verdict] ?? "bg-muted text-muted-foreground"}`}>
      {verdict}
    </Badge>
  );
}

function ConfidenceBar({ value }: { value: number | null }) {
  const pct = Math.round((value ?? 0) * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
    </div>
  );
}

function DeltaIndicator({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.01) return <Minus className="w-3 h-3 text-muted-foreground" />;
  if (delta > 0) return <TrendingUp className="w-3 h-3 text-emerald-400" />;
  return <TrendingDown className="w-3 h-3 text-red-400" />;
}

export default function AuditComparison() {
  const [docIdA, setDocIdA] = useState<string>("");
  const [docIdB, setDocIdB] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "changed" | "unique">("all");

  const { data: docs, isLoading: docsLoading } = trpc.auditComparison.listForPicker.useQuery();

  const enabled = !!docIdA && !!docIdB && docIdA !== docIdB;
  const { data, isLoading, error } = trpc.auditComparison.compare.useQuery(
    { documentIdA: parseInt(docIdA), documentIdB: parseInt(docIdB) },
    { enabled }
  );

  const filteredPairs = useMemo(() => {
    if (!data) return [];
    if (filter === "changed") return data.pairs.filter((p) => p.verdictChanged || p.confidenceChanged);
    if (filter === "unique") return data.pairs.filter((p) => !p.claimA || !p.claimB);
    return data.pairs;
  }, [data, filter]);

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <ArrowLeftRight className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Audit Comparison</h1>
            <p className="text-sm text-muted-foreground">Compare two audit reports side-by-side to track how evidence has changed</p>
          </div>
        </div>

        {/* Document Picker */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Documents to Compare</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Document A (baseline)</label>
                {docsLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={docIdA} onValueChange={setDocIdA}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a document…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(docs ?? []).map((d) => (
                        <SelectItem key={d.id} value={String(d.id)} disabled={String(d.id) === docIdB}>
                          {d.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Document B (comparison)</label>
                {docsLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={docIdB} onValueChange={setDocIdB}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a document…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(docs ?? []).map((d) => (
                        <SelectItem key={d.id} value={String(d.id)} disabled={String(d.id) === docIdA}>
                          {d.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            {docIdA && docIdB && docIdA === docIdB && (
              <p className="text-sm text-destructive mt-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Please select two different documents.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Loading */}
        {isLoading && enabled && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
          </div>
        )}

        {/* Error */}
        {error && (
          <Card className="border-destructive/50">
            <CardContent className="pt-6 flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm">{error.message}</span>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {data && (
          <div className="space-y-5">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="bg-card/50">
                <CardContent className="pt-4 pb-3">
                  <div className="text-2xl font-bold tabular-nums">{data.summary.matchedPairs}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Matched pairs</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50">
                <CardContent className="pt-4 pb-3">
                  <div className="text-2xl font-bold tabular-nums text-amber-400">{data.summary.verdictChanges}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Verdict changes</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50">
                <CardContent className="pt-4 pb-3">
                  <div className="text-2xl font-bold tabular-nums text-blue-400">{data.summary.onlyInA + data.summary.onlyInB}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Unique claims</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-1.5">
                    <DeltaIndicator delta={data.summary.confidenceDelta} />
                    <span className={`text-2xl font-bold tabular-nums ${data.summary.confidenceDelta > 0.01 ? "text-emerald-400" : data.summary.confidenceDelta < -0.01 ? "text-red-400" : "text-muted-foreground"}`}>
                      {data.summary.confidenceDelta > 0 ? "+" : ""}{(data.summary.confidenceDelta * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Avg confidence Δ</div>
                </CardContent>
              </Card>
            </div>

            {/* Document headers */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="pt-3 pb-3">
                  <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-0.5">Document A</div>
                  <div className="font-medium text-sm truncate">{data.documentA.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{data.summary.claimsInA} claims · avg {(data.summary.avgConfidenceA * 100).toFixed(1)}% confidence</div>
                </CardContent>
              </Card>
              <Card className="border-secondary/30 bg-secondary/5">
                <CardContent className="pt-3 pb-3">
                  <div className="text-xs font-semibold text-secondary-foreground uppercase tracking-wide mb-0.5">Document B</div>
                  <div className="font-medium text-sm truncate">{data.documentB.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{data.summary.claimsInB} claims · avg {(data.summary.avgConfidenceB * 100).toFixed(1)}% confidence</div>
                </CardContent>
              </Card>
            </div>

            {/* Filter bar */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Show:</span>
              {(["all", "changed", "unique"] as const).map((f) => (
                <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)} className="capitalize text-xs h-7">
                  {f === "all" ? `All (${data.pairs.length})` : f === "changed" ? `Changed (${data.pairs.filter((p) => p.verdictChanged || p.confidenceChanged).length})` : `Unique (${data.summary.onlyInA + data.summary.onlyInB})`}
                </Button>
              ))}
            </div>

            {/* Claim pairs */}
            <div className="space-y-2">
              {filteredPairs.length === 0 && (
                <Card>
                  <CardContent className="pt-6 pb-6 flex flex-col items-center gap-2 text-muted-foreground">
                    <CheckCircle className="w-8 h-8 text-emerald-400" />
                    <span className="text-sm">No claims match this filter.</span>
                  </CardContent>
                </Card>
              )}
              {filteredPairs.map((pair, idx) => {
                const isChanged = pair.verdictChanged || pair.confidenceChanged;
                const isUniqueA = pair.claimA && !pair.claimB;
                const isUniqueB = !pair.claimA && pair.claimB;
                return (
                  <Card key={idx} className={`transition-colors ${isChanged ? "border-amber-500/40 bg-amber-500/5" : isUniqueA || isUniqueB ? "border-blue-500/30 bg-blue-500/5" : ""}`}>
                    <CardContent className="pt-3 pb-3">
                      {/* Similarity badge */}
                      <div className="flex items-center gap-2 mb-2">
                        {pair.similarity === "exact" && <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-400">Exact match</Badge>}
                        {pair.similarity === "similar" && <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">Similar</Badge>}
                        {pair.similarity === "unique" && isUniqueA && <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400">Only in A</Badge>}
                        {pair.similarity === "unique" && isUniqueB && <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400">Only in B</Badge>}
                        {pair.verdictChanged && <Badge variant="outline" className="text-xs border-orange-500/30 text-orange-400 flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> Verdict changed</Badge>}
                        {pair.confidenceChanged && !pair.verdictChanged && <Badge variant="outline" className="text-xs border-yellow-500/30 text-yellow-400 flex items-center gap-1"><Info className="w-2.5 h-2.5" /> Confidence changed</Badge>}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        {/* Side A */}
                        <div className="space-y-1.5">
                          {pair.claimA ? (
                            <>
                              <p className="text-sm leading-snug">{pair.claimA.claimText}</p>
                              <VerdictBadge verdict={pair.claimA.verdict} />
                              <ConfidenceBar value={pair.claimA.confidenceScore} />
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">— not present in Document A —</p>
                          )}
                        </div>
                        {/* Divider */}
                        <div className="border-l border-border pl-4 space-y-1.5">
                          {pair.claimB ? (
                            <>
                              <p className="text-sm leading-snug">{pair.claimB.claimText}</p>
                              <VerdictBadge verdict={pair.claimB.verdict} />
                              <ConfidenceBar value={pair.claimB.confidenceScore} />
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">— not present in Document B —</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!enabled && !isLoading && (
          <Card className="border-dashed">
            <CardContent className="pt-10 pb-10 flex flex-col items-center gap-3 text-muted-foreground">
              <ArrowLeftRight className="w-10 h-10 opacity-30" />
              <p className="text-sm text-center max-w-xs">Select two different documents above to see a side-by-side comparison of their audit results.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
