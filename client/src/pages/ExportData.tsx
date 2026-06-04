/**
 * ExportData.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Structured data export page.
 *
 * Route: /export
 *
 * Allows users to download claims, audit reports, and entities as CSV or JSON
 * with optional filters (vertical, verdict, date range, document ID).
 */

import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Download, FileJson, FileText, Table2, GitBranch, Building2 } from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExportFilters {
  vertical: string;
  verdict: string;
  from: string;
  to: string;
  documentId: string;
  limit: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQueryString(filters: ExportFilters, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (filters.vertical && filters.vertical !== "all") params.set("vertical", filters.vertical);
  if (filters.verdict && filters.verdict !== "all") params.set("verdict", filters.verdict);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.documentId) params.set("documentId", filters.documentId);
  if (filters.limit && filters.limit !== "500") params.set("limit", filters.limit);
  if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function triggerDownload(url: string, filename: string, isJson: boolean) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
    toast.success(`Downloaded ${filename}`);
  } catch (err) {
    toast.error(`Export failed: ${(err as Error).message}`);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExportData() {
  const [filters, setFilters] = useState<ExportFilters>({
    vertical: "all",
    verdict: "all",
    from: "",
    to: "",
    documentId: "",
    limit: "500",
  });
  const [loading, setLoading] = useState<string | null>(null);

  const setFilter = (key: keyof ExportFilters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const download = async (endpoint: string, ext: "csv" | "json", label: string) => {
    const qs = buildQueryString(filters);
    const url = `/api/v2/export/${endpoint}.${ext}${qs}`;
    const filename = `truth-desk-${endpoint}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    setLoading(`${endpoint}-${ext}`);
    await triggerDownload(url, filename, ext === "json");
    setLoading(null);
  };

  const isLoading = (key: string) => loading === key;

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto py-8 px-4 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Data Export</h1>
          <p className="text-slate-400 text-sm">
            Download verified claims, audit reports, and entities as CSV or JSON. All exports are
            rate-limited to 20 requests per minute. Maximum 5,000 rows per export.
          </p>
        </div>

        {/* Filter panel */}
        <Card className="bg-slate-900/60 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white">Export Filters</CardTitle>
            <CardDescription className="text-slate-400 text-xs">
              Filters apply to all exports below. Leave blank to export all data.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {/* Vertical */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Vertical Domain</Label>
              <Select value={filters.vertical} onValueChange={(v) => setFilter("vertical", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200 h-8 text-xs">
                  <SelectValue placeholder="All verticals" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All verticals</SelectItem>
                  <SelectItem value="structural_biology">Structural Biology</SelectItem>
                  <SelectItem value="salmon_biotech">Salmon Biotech</SelectItem>
                  <SelectItem value="protein_supplement">Protein Supplement</SelectItem>
                  <SelectItem value="creatine_ergogenics">Creatine Ergogenics</SelectItem>
                  <SelectItem value="gut_microbiome">Gut Microbiome</SelectItem>
                  <SelectItem value="collagen_peptides">Collagen Peptides</SelectItem>
                  <SelectItem value="plant_based_protein">Plant-Based Protein</SelectItem>
                  <SelectItem value="sports_nutrition_rct">Sports Nutrition RCT</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Verdict */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Verdict</Label>
              <Select value={filters.verdict} onValueChange={(v) => setFilter("verdict", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200 h-8 text-xs">
                  <SelectValue placeholder="All verdicts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All verdicts</SelectItem>
                  <SelectItem value="Supported">Supported</SelectItem>
                  <SelectItem value="Partially Supported">Partially Supported</SelectItem>
                  <SelectItem value="Contradicted">Contradicted</SelectItem>
                  <SelectItem value="Ambiguous">Ambiguous</SelectItem>
                  <SelectItem value="Insufficient Evidence">Insufficient Evidence</SelectItem>
                  <SelectItem value="Needs Expert Review">Needs Expert Review</SelectItem>
                  <SelectItem value="Out of Scope">Out of Scope</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Limit */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Max Rows</Label>
              <Select value={filters.limit} onValueChange={(v) => setFilter("limit", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                  <SelectItem value="1000">1,000</SelectItem>
                  <SelectItem value="5000">5,000</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date from */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">From Date</Label>
              <Input
                type="date"
                value={filters.from}
                onChange={(e) => setFilter("from", e.target.value)}
                className="bg-slate-800 border-slate-600 text-slate-200 h-8 text-xs"
              />
            </div>

            {/* Date to */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">To Date</Label>
              <Input
                type="date"
                value={filters.to}
                onChange={(e) => setFilter("to", e.target.value)}
                className="bg-slate-800 border-slate-600 text-slate-200 h-8 text-xs"
              />
            </div>

            {/* Document ID */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Document ID (optional)</Label>
              <Input
                type="number"
                placeholder="e.g. 42"
                value={filters.documentId}
                onChange={(e) => setFilter("documentId", e.target.value)}
                className="bg-slate-800 border-slate-600 text-slate-200 h-8 text-xs"
              />
            </div>
          </CardContent>
        </Card>

        {/* Export cards */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Claims */}
          <Card className="bg-slate-900/60 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Table2 className="w-4 h-4 text-violet-400" />
                <CardTitle className="text-sm text-white">Claims</CardTitle>
                <Badge variant="outline" className="text-violet-400 border-violet-400/30 text-xs ml-auto">
                  Verified
                </Badge>
              </div>
              <CardDescription className="text-slate-400 text-xs">
                All extracted and verified scientific claims with verdicts, confidence scores, PDB IDs, and rationale.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 border-slate-600 text-slate-300 hover:text-white text-xs"
                disabled={isLoading("claims-csv")}
                onClick={() => download("claims", "csv", "Claims CSV")}
              >
                <FileText className="w-3.5 h-3.5" />
                {isLoading("claims-csv") ? "Downloading…" : "Download CSV"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 border-slate-600 text-slate-300 hover:text-white text-xs"
                disabled={isLoading("claims-json")}
                onClick={() => download("claims", "json", "Claims JSON")}
              >
                <FileJson className="w-3.5 h-3.5" />
                {isLoading("claims-json") ? "Downloading…" : "Download JSON"}
              </Button>
            </CardContent>
          </Card>

          {/* Reports */}
          <Card className="bg-slate-900/60 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-blue-400" />
                <CardTitle className="text-sm text-white">Audit Reports</CardTitle>
                <Badge variant="outline" className="text-blue-400 border-blue-400/30 text-xs ml-auto">
                  Summaries
                </Badge>
              </div>
              <CardDescription className="text-slate-400 text-xs">
                Audit report summaries including document title, vertical domain, total claims, high-risk count, and verdict distribution.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 border-slate-600 text-slate-300 hover:text-white text-xs"
                disabled={isLoading("reports-csv")}
                onClick={() => download("reports", "csv", "Reports CSV")}
              >
                <FileText className="w-3.5 h-3.5" />
                {isLoading("reports-csv") ? "Downloading…" : "Download CSV"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 border-slate-600 text-slate-300 hover:text-white text-xs"
                disabled={isLoading("reports-json")}
                onClick={() => download("reports", "json", "Reports JSON")}
              >
                <FileJson className="w-3.5 h-3.5" />
                {isLoading("reports-json") ? "Downloading…" : "Download JSON"}
              </Button>
            </CardContent>
          </Card>

          {/* Entities */}
          <Card className="bg-slate-900/60 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 mb-1">
                <GitBranch className="w-4 h-4 text-emerald-400" />
                <CardTitle className="text-sm text-white">Entities</CardTitle>
                <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 text-xs ml-auto">
                  Knowledge Graph
                </Badge>
              </div>
              <CardDescription className="text-slate-400 text-xs">
                All knowledge graph entities (proteins, PDB IDs, methods, organisms, ligands) with canonical names and metadata.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 border-slate-600 text-slate-300 hover:text-white text-xs"
                disabled={isLoading("entities-csv")}
                onClick={() => download("entities", "csv", "Entities CSV")}
              >
                <FileText className="w-3.5 h-3.5" />
                {isLoading("entities-csv") ? "Downloading…" : "Download CSV"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 border-slate-600 text-slate-300 hover:text-white text-xs"
                disabled={isLoading("entities-json")}
                onClick={() => download("entities", "json", "Entities JSON")}
              >
                <FileJson className="w-3.5 h-3.5" />
                {isLoading("entities-json") ? "Downloading…" : "Download JSON"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Separator className="bg-slate-800" />

        {/* API reference */}
        <div>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Direct API Access
          </h2>
          <div className="rounded-lg bg-slate-900 border border-slate-700 p-4 space-y-2">
            <p className="text-xs text-slate-400 mb-3">
              All export endpoints are publicly accessible. Rate limit: 20 requests/minute per IP.
              Maximum 5,000 rows per request.
            </p>
            {[
              { method: "GET", path: "/api/v2/export/claims.csv", desc: "Claims as CSV" },
              { method: "GET", path: "/api/v2/export/claims.json", desc: "Claims as JSON" },
              { method: "GET", path: "/api/v2/export/reports.csv", desc: "Audit reports as CSV" },
              { method: "GET", path: "/api/v2/export/reports.json", desc: "Audit reports as JSON" },
              { method: "GET", path: "/api/v2/export/entities.csv", desc: "Entities as CSV" },
              { method: "GET", path: "/api/v2/export/entities.json", desc: "Entities as JSON" },
            ].map((ep) => (
              <div key={ep.path} className="flex items-center gap-3 text-xs">
                <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 font-mono shrink-0">
                  {ep.method}
                </Badge>
                <code className="text-slate-300 font-mono">{ep.path}</code>
                <span className="text-slate-500 hidden md:block">— {ep.desc}</span>
              </div>
            ))}
            <p className="text-xs text-slate-500 mt-3">
              Query params: <code className="text-slate-400">vertical</code>,{" "}
              <code className="text-slate-400">verdict</code>,{" "}
              <code className="text-slate-400">from</code>,{" "}
              <code className="text-slate-400">to</code>,{" "}
              <code className="text-slate-400">documentId</code>,{" "}
              <code className="text-slate-400">limit</code> (max 5000)
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
