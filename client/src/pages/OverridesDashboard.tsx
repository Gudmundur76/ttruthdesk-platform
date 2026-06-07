import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, BarChart3, FileText, TrendingUp } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  domain_expertise: "Domain Expertise",
  new_evidence: "New Evidence",
  context_clarification: "Context Clarification",
  scope_adjustment: "Scope Adjustment",
  error_correction: "Error Correction",
};

const CATEGORY_COLORS: Record<string, string> = {
  domain_expertise: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  new_evidence: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  context_clarification: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  scope_adjustment: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  error_correction: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const VERDICT_COLORS: Record<string, string> = {
  "Supported": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Contradicted": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  "Partially Supported": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  "Insufficient Evidence": "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  "Ambiguous": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "Out of Scope": "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
  "Needs Expert Review": "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
};

export default function OverridesDashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data: summary, isLoading: summaryLoading } = trpc.overrides.summary.useQuery();
  const { data: flipData, isLoading: flipLoading } = trpc.overrides.flipAnalysis.useQuery();
  const { data: listData, isLoading: listLoading } = trpc.overrides.list.useQuery({
    category: categoryFilter !== "all" ? categoryFilter as "domain_expertise" | "new_evidence" | "context_clarification" | "scope_adjustment" | "error_correction" : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Admin access required.
      </div>
    );
  }

  const totalOverrides = summary?.reduce((sum, s) => sum + Number(s.total), 0) ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Override Audit Log</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Epistemic category breakdown of human verdict corrections — reveals systematic LLM failure modes.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{totalOverrides}</div>
            <div className="text-sm text-muted-foreground mt-1">Total Overrides</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{summary?.length ?? 0}</div>
            <div className="text-sm text-muted-foreground mt-1">Active Categories</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{flipData?.length ?? 0}</div>
            <div className="text-sm text-muted-foreground mt-1">Verdict Flip Patterns</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">
              {summary && summary.length > 0
                ? CATEGORY_LABELS[summary[0].overrideCategory] ?? summary[0].overrideCategory
                : "—"}
            </div>
            <div className="text-sm text-muted-foreground mt-1">Most Common Category</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Category breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />
              By Epistemic Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : !summary || summary.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No overrides recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {summary.map((row) => {
                  const pct = totalOverrides > 0 ? Math.round((Number(row.total) / totalOverrides) * 100) : 0;
                  return (
                    <div key={row.overrideCategory}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[row.overrideCategory] ?? ""}`}>
                          {CATEGORY_LABELS[row.overrideCategory] ?? row.overrideCategory}
                        </span>
                        <span className="text-sm font-semibold">{row.total} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Verdict flip analysis */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Verdict Flip Patterns
            </CardTitle>
          </CardHeader>
          <CardContent>
            {flipLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : !flipData || flipData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No flip patterns yet.</p>
            ) : (
              <div className="space-y-2">
                {flipData.slice(0, 10).map((row, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Badge className={`text-xs ${VERDICT_COLORS[row.originalVerdict] ?? ""}`}>
                      {row.originalVerdict}
                    </Badge>
                    <span className="text-muted-foreground">→</span>
                    <Badge className={`text-xs ${VERDICT_COLORS[row.newVerdict] ?? ""}`}>
                      {row.newVerdict}
                    </Badge>
                    <span className="ml-auto font-semibold text-muted-foreground">{row.total}×</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Override log table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Override Records
            </CardTitle>
            <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(0); }}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {listLoading ? (
            <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !listData || listData.items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No overrides found.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Original</TableHead>
                    <TableHead>New</TableHead>
                    <TableHead>Justification</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listData.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">#{row.claimId}</TableCell>
                      <TableCell>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[row.overrideCategory] ?? ""}`}>
                          {CATEGORY_LABELS[row.overrideCategory] ?? row.overrideCategory}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${VERDICT_COLORS[row.originalVerdict] ?? ""}`}>
                          {row.originalVerdict}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${VERDICT_COLORS[row.newVerdict] ?? ""}`}>
                          {row.newVerdict}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-xs text-muted-foreground truncate" title={row.justification}>
                          {row.justification}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* Pagination */}
              {listData.total > PAGE_SIZE && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, Number(listData.total))} of {listData.total}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= Number(listData.total)}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
