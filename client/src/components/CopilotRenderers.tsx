/**
 * CopilotRenderers.tsx
 *
 * Registers generative-UI renderers for every CopilotKit backend tool.
 * Mount this once inside DashboardLayout so the renderers are active on
 * every admin/dashboard page.
 *
 * Tools covered:
 *   verifyClaim · getRecentClaims · getEntityClaims · getDocumentAudit
 *   getPlatformStats · compareClaims · searchUniProt · getGraphSummary
 *   (searchPubMed / searchPDB handled via verifyClaim evidence display)
 */

import { useCopilotAction } from "@copilotkit/react-core";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, XCircle, AlertCircle, HelpCircle, Loader2, BarChart3, Dna, BookOpen, FileText, ExternalLink, Calendar, Users, Copy, Check } from "lucide-react";
import { useState, useCallback } from "react";
import { toast } from "sonner";

// ─── Verdict helpers ──────────────────────────────────────────────────────────

type Verdict =
  | "Supported"
  | "Contradicted"
  | "Partially Supported"
  | "Ambiguous"
  | "Insufficient Evidence"
  | "Out of Scope"
  | string;

function verdictColor(v: Verdict): string {
  if (!v) return "bg-muted text-muted-foreground";
  const lv = v.toLowerCase();
  if (lv.includes("support")) return "bg-green-100 text-green-800 border-green-200";
  if (lv.includes("contradict")) return "bg-red-100 text-red-800 border-red-200";
  if (lv.includes("partial")) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (lv.includes("ambiguous")) return "bg-purple-100 text-purple-800 border-purple-200";
  if (lv.includes("insufficient")) return "bg-gray-100 text-gray-600 border-gray-200";
  if (lv.includes("scope")) return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-muted text-muted-foreground";
}

function VerdictIcon({ verdict }: { verdict: Verdict }) {
  const lv = (verdict ?? "").toLowerCase();
  if (lv.includes("support")) return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (lv.includes("contradict")) return <XCircle className="h-4 w-4 text-red-600" />;
  if (lv.includes("partial")) return <AlertCircle className="h-4 w-4 text-yellow-600" />;
  return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${verdictColor(verdict)}`}
    >
      <VerdictIcon verdict={verdict} />
      {verdict ?? "Pending"}
    </span>
  );
}

// ─── 1. verifyClaim ───────────────────────────────────────────────────────────

function VerifyClaimRenderer({ args, result, status }: {
  args: { claimText: string };
  result?: {
    verdict?: Verdict;
    confidenceScore?: number;
    explanation?: string;
    sources?: string[];
    pdbId?: string;
    pubmedIds?: string[];
    error?: string;
  };
  status: string;
}) {
  if (status === "inProgress") {
    return (
      <Card className="my-2 border-blue-200 bg-blue-50/50">
        <CardContent className="pt-4 pb-3 flex items-center gap-2 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying claim against PDB, PubMed, and UniProt…
        </CardContent>
      </Card>
    );
  }
  if (!result) return null;
  if (result.error) {
    return (
      <Card className="my-2 border-red-200 bg-red-50/50">
        <CardContent className="pt-4 pb-3 text-sm text-red-700">{result.error}</CardContent>
      </Card>
    );
  }
  const confidence = result.confidenceScore != null
    ? `${Math.round(result.confidenceScore * 100)}%`
    : "—";
  return (
    <Card className="my-2">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm font-medium leading-snug text-foreground">
            {args.claimText}
          </CardTitle>
          <VerdictBadge verdict={result.verdict ?? "Pending"} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Confidence: <strong className="text-foreground">{confidence}</strong></span>
          {result.pdbId && (
            <a
              href={`https://www.rcsb.org/structure/${result.pdbId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              PDB: {result.pdbId}
            </a>
          )}
        </div>
        {result.explanation && (
          <p className="text-sm text-muted-foreground leading-relaxed">{result.explanation}</p>
        )}
        {result.sources && result.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {result.sources.map((s, i) => (
              <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>
            ))}
          </div>
        )}
        {result.pubmedIds && result.pubmedIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {result.pubmedIds.map((pmid) => (
              <a
                key={pmid}
                href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                PMID:{pmid}
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 2. getRecentClaims ───────────────────────────────────────────────────────

function RecentClaimsRenderer({ result, status }: {
  args: { limit?: number; verdict?: string };
  result?: { claims: Array<{ id: number; claimText: string; verdict: Verdict; confidenceScore: number | null; documentId: number; createdAt: unknown }>; total: number; error?: string };
  status: string;
}) {
  if (status === "inProgress") {
    return (
      <Card className="my-2 border-blue-200 bg-blue-50/50">
        <CardContent className="pt-4 pb-3 flex items-center gap-2 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Fetching recent claims…
        </CardContent>
      </Card>
    );
  }
  if (!result) return null;
  if (result.error) {
    return (
      <Card className="my-2 border-red-200 bg-red-50/50">
        <CardContent className="pt-4 pb-3 text-sm text-red-700">{result.error}</CardContent>
      </Card>
    );
  }
  const claims = result.claims ?? [];
  return (
    <Card className="my-2">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium">
          Recent Claims <span className="text-muted-foreground font-normal">({result.total} total)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Claim</TableHead>
              <TableHead className="text-xs w-32">Verdict</TableHead>
              <TableHead className="text-xs w-20">Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-xs max-w-xs truncate">{c.claimText}</TableCell>
                <TableCell><VerdictBadge verdict={c.verdict} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.confidenceScore != null ? `${Math.round(c.confidenceScore * 100)}%` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── 3. getEntityClaims ───────────────────────────────────────────────────────

function EntityClaimsRenderer({ args, result, status }: {
  args: { entityName: string; entityType?: string };
  result?: { entity: string; claims: Array<{ id: number; claimText: string; verdict: Verdict; confidenceScore: number | null }>; total: number; error?: string };
  status: string;
}) {
  if (status === "inProgress") {
    return (
      <Card className="my-2 border-blue-200 bg-blue-50/50">
        <CardContent className="pt-4 pb-3 flex items-center gap-2 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading claims for <strong>{args.entityName}</strong>…
        </CardContent>
      </Card>
    );
  }
  if (!result) return null;
  const claims = result.claims ?? [];
  return (
    <Card className="my-2">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Dna className="h-4 w-4 text-blue-600" />
          Claims for <span className="text-blue-700">{result.entity}</span>
          <span className="text-muted-foreground font-normal">({result.total})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="space-y-2">
          {claims.map((c) => (
            <div key={c.id} className="flex items-start gap-2 py-1.5 border-b last:border-0">
              <VerdictBadge verdict={c.verdict} />
              <p className="text-xs text-muted-foreground leading-relaxed flex-1">{c.claimText}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── 4. getDocumentAudit ─────────────────────────────────────────────────────

function DocumentAuditRenderer({ result, status }: {
  args: { documentId: number };
  result?: {
    document?: { id: number; title: string; status: string; verticalDomain: string | null; createdAt: unknown };
    claims?: Array<{ id: number; claimText: string; verdict: Verdict; confidenceScore: number | null }>;
    claimCount?: number;
    verdictBreakdown?: Record<string, number>;
    error?: string;
  };
  status: string;
}) {
  if (status === "inProgress") {
    return (
      <Card className="my-2 border-blue-200 bg-blue-50/50">
        <CardContent className="pt-4 pb-3 flex items-center gap-2 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading document audit…
        </CardContent>
      </Card>
    );
  }
  if (!result || !result.document) return null;
  const doc = result.document;
  const breakdown = result.verdictBreakdown ?? {};
  return (
    <Card className="my-2">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium">{doc.title}</CardTitle>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="text-xs">{doc.status}</Badge>
          {doc.verticalDomain && (
            <Badge variant="secondary" className="text-xs">{doc.verticalDomain}</Badge>
          )}
          <span className="text-xs text-muted-foreground">{result.claimCount} claims</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {Object.keys(breakdown).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(breakdown).map(([v, count]) => (
              <span key={v} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${verdictColor(v as Verdict)}`}>
                {v}: {count}
              </span>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          {(result.claims ?? []).slice(0, 5).map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <VerdictBadge verdict={c.verdict} />
              <p className="text-xs text-muted-foreground leading-relaxed">{c.claimText}</p>
            </div>
          ))}
          {(result.claimCount ?? 0) > 5 && (
            <p className="text-xs text-muted-foreground italic">
              …and {(result.claimCount ?? 0) - 5} more claims
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── 5. getPlatformStats ─────────────────────────────────────────────────────

function PlatformStatsRenderer({ result, status }: {
  args: Record<string, never>;
  result?: {
    totalDocuments?: number;
    totalClaims?: number;
    supportedVerdicts?: number;
    verifiedSources?: number;
    error?: string;
  };
  status: string;
}) {
  if (status === "inProgress") {
    return (
      <Card className="my-2 border-blue-200 bg-blue-50/50">
        <CardContent className="pt-4 pb-3 flex items-center gap-2 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading platform statistics…
        </CardContent>
      </Card>
    );
  }
  if (!result) return null;
  const stats = [
    { label: "Documents", value: result.totalDocuments ?? 0 },
    { label: "Claims", value: result.totalClaims ?? 0 },
    { label: "Supported", value: result.supportedVerdicts ?? 0 },
    { label: "Sources", value: result.verifiedSources ?? 0 },
  ];
  return (
    <Card className="my-2">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-blue-600" />
          Platform Statistics
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border bg-muted/30 p-3 text-center">
              <p className="text-xl font-bold text-foreground">{s.value.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── 6. compareClaims ────────────────────────────────────────────────────────

function CompareClaimsRenderer({ result, status }: {
  args: { claimIdA: number; claimIdB: number };
  result?: {
    claimA?: { id: number; claimText: string; verdict: Verdict; confidenceScore: number | null; pdbId?: string | null } | null;
    claimB?: { id: number; claimText: string; verdict: Verdict; confidenceScore: number | null; pdbId?: string | null } | null;
    error?: string;
  };
  status: string;
}) {
  if (status === "inProgress") {
    return (
      <Card className="my-2 border-blue-200 bg-blue-50/50">
        <CardContent className="pt-4 pb-3 flex items-center gap-2 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Comparing claims…
        </CardContent>
      </Card>
    );
  }
  if (!result) return null;
  const { claimA, claimB } = result;
  return (
    <Card className="my-2">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium">Claim Comparison</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[claimA, claimB].map((c, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Claim {i + 1}</p>
              {c ? (
                <>
                  <p className="text-sm leading-snug">{c.claimText}</p>
                  <div className="flex items-center gap-2">
                    <VerdictBadge verdict={c.verdict} />
                    <span className="text-xs text-muted-foreground">
                      {c.confidenceScore != null ? `${Math.round(c.confidenceScore * 100)}%` : "—"}
                    </span>
                  </div>
                  {c.pdbId && (
                    <a
                      href={`https://www.rcsb.org/structure/${c.pdbId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      PDB: {c.pdbId}
                    </a>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground italic">Not found</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── 7. searchUniProt ────────────────────────────────────────────────────────

function UniProtRenderer({ args, result, status }: {
  args: { query: string; limit?: number };
  result?: {
    found?: boolean;
    entries?: Array<{
      accession: string;
      name: string;
      organism: string;
      function?: string;
      length?: number;
    }>;
    error?: string;
  };
  status: string;
}) {
  if (status === "inProgress") {
    return (
      <Card className="my-2 border-blue-200 bg-blue-50/50">
        <CardContent className="pt-4 pb-3 flex items-center gap-2 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching UniProt for <strong>{args.query}</strong>…
        </CardContent>
      </Card>
    );
  }
  if (!result) return null;
  const entries = result.entries ?? [];
  return (
    <Card className="my-2">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Dna className="h-4 w-4 text-blue-600" />
          UniProt: {args.query}
          <span className="text-muted-foreground font-normal">({entries.length} results)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No entries found.</p>
        ) : (
          <div className="space-y-3">
            {entries.map((e) => (
              <div key={e.accession} className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <a
                    href={`https://www.uniprot.org/uniprot/${e.accession}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-600 hover:underline"
                  >
                    {e.accession}
                  </a>
                  <span className="text-sm text-foreground">{e.name}</span>
                </div>
                <p className="text-xs text-muted-foreground">{e.organism}</p>
                {e.function && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{e.function}</p>
                )}
                {e.length && (
                  <p className="text-xs text-muted-foreground">{e.length} aa</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 8. getGraphSummary ───────────────────────────────────────────────────────

function GraphSummaryRenderer({ result, status }: {
  args: Record<string, never>;
  result?: {
    documentCount?: number;
    claimCount?: number;
    statusBreakdown?: Record<string, number>;
    verdictBreakdown?: Record<string, number>;
    error?: string;
  };
  status: string;
}) {
  if (status === "inProgress") {
    return (
      <Card className="my-2 border-blue-200 bg-blue-50/50">
        <CardContent className="pt-4 pb-3 flex items-center gap-2 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading knowledge graph summary…
        </CardContent>
      </Card>
    );
  }
  if (!result) return null;
  return (
    <Card className="my-2">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-blue-600" />
          Knowledge Graph Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <p className="text-xl font-bold">{(result.documentCount ?? 0).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Documents</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <p className="text-xl font-bold">{(result.claimCount ?? 0).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Claims</p>
          </div>
        </div>
        {result.verdictBreakdown && Object.keys(result.verdictBreakdown).length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Verdict Distribution</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(result.verdictBreakdown).map(([v, count]) => (
                <span key={v} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${verdictColor(v as Verdict)}`}>
                  {v}: {count}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Cite This Paper button ──────────────────────────────────────────────────

function CiteButton({ paper }: {
  paper: {
    pmid: string;
    title: string;
    authors?: string[];
    journal?: string | null;
    year?: number | null;
    citationUrl: string;
  };
}) {
  const [copied, setCopied] = useState(false);

  const buildApa = useCallback(() => {
    const authorStr = paper.authors && paper.authors.length > 0
      ? paper.authors.length > 6
        ? paper.authors.slice(0, 6).join(", ") + ", et al."
        : paper.authors.join(", ")
      : "[Author(s) unknown]";
    const year = paper.year ? `(${paper.year})` : "(n.d.)";
    const journal = paper.journal ?? "[Journal unknown]";
    return `${authorStr} ${year}. ${paper.title}. ${journal}. PMID: ${paper.pmid}. ${paper.citationUrl}`;
  }, [paper]);

  const buildVancouver = useCallback(() => {
    const authorStr = paper.authors && paper.authors.length > 0
      ? paper.authors.length > 6
        ? paper.authors.slice(0, 6).join(", ") + ", et al"
        : paper.authors.join(", ")
      : "[Author(s) unknown]";
    const year = paper.year ?? "n.d.";
    const journal = paper.journal ?? "[Journal unknown]";
    return `${authorStr}. ${paper.title}. ${journal}. ${year}. PMID: ${paper.pmid}. Available from: ${paper.citationUrl}`;
  }, [paper]);

  const handleCopy = useCallback((format: "apa" | "vancouver") => {
    const text = format === "apa" ? buildApa() : buildVancouver();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success(`${format.toUpperCase()} citation copied to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast.error("Failed to copy — please copy manually");
    });
  }, [buildApa, buildVancouver]);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={() => handleCopy("apa")}
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors"
        title="Copy APA citation"
      >
        {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
        APA
      </button>
      <button
        onClick={() => handleCopy("vancouver")}
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors"
        title="Copy Vancouver citation"
      >
        {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
        Vancouver
      </button>
    </div>
  );
}

// ─── 9. searchPubMed ─────────────────────────────────────────────────────────

function PubMedCardRenderer({ args, result, status }: {
  args: { query: string; limit?: number };
  result?: {
    results?: Array<{
      pmid: string;
      title: string;
      abstractSnippet: string;
      citationUrl: string;
      authors?: string[];
      journal?: string | null;
      year?: number | null;
    }>;
    total?: number;
    query?: string;
    note?: string;
    error?: string;
  };
  status: string;
}) {
  if (status === "inProgress") {
    return (
      <Card className="my-2 border-blue-200 bg-blue-50/50">
        <CardContent className="pt-4 pb-3 flex items-center gap-2 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching PubMed for <strong>{args.query}</strong>…
        </CardContent>
      </Card>
    );
  }
  if (!result) return null;
  const papers = result.results ?? [];
  return (
    <Card className="my-2">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FileText className="h-4 w-4 text-green-600" />
          PubMed: {args.query}
          <span className="text-muted-foreground font-normal">({papers.length} results)</span>
        </CardTitle>
        {result.note && (
          <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 mt-1">
            ✓ {result.note}
          </p>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {papers.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No papers found for this query.</p>
        ) : (
          <div className="space-y-3">
            {papers.map((p) => (
              <div key={p.pmid} className="rounded-lg border bg-card p-3 space-y-2 hover:border-green-300 transition-colors">
                {/* Title + PMID badge */}
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={p.citationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-foreground hover:text-green-700 leading-snug flex-1"
                  >
                    {p.title}
                  </a>
                  <Badge variant="outline" className="shrink-0 text-xs font-mono text-green-700 border-green-300">
                    PMID:{p.pmid}
                  </Badge>
                </div>
                {/* Meta row: journal, year, authors */}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {p.journal && (
                    <span className="flex items-center gap-1">
                      <BookOpen className="h-3 w-3" />
                      {p.journal}
                    </span>
                  )}
                  {p.year && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {p.year}
                    </span>
                  )}
                  {p.authors && p.authors.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {p.authors.slice(0, 3).join(", ")}{p.authors.length > 3 ? " et al." : ""}
                    </span>
                  )}
                </div>
                {/* Abstract snippet */}
                {p.abstractSnippet && (
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                    {p.abstractSnippet}
                    {p.abstractSnippet.length >= 399 && "…"}
                  </p>
                )}
                {/* Actions row: link + cite buttons */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <a
                    href={p.citationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-green-600 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View on PubMed
                  </a>
                  <CiteButton paper={p} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Hook: register all renderers ────────────────────────────────────────────

export function useCopilotRenderers() {
  useCopilotAction({
    name: "verifyClaim",
    description: "Verify a scientific claim against PDB, PubMed, and UniProt",
    parameters: [
      { name: "claimText", type: "string", description: "The claim to verify", required: true },
      { name: "pdbId", type: "string", description: "Optional PDB ID", required: false },
    ],
    render: (props) => <VerifyClaimRenderer {...(props as Parameters<typeof VerifyClaimRenderer>[0])} />,
  });

  useCopilotAction({
    name: "getRecentClaims",
    description: "Get recent claims from the platform",
    parameters: [
      { name: "limit", type: "number", description: "Max results", required: false },
      { name: "verdict", type: "string", description: "Filter by verdict", required: false },
    ],
    render: (props) => <RecentClaimsRenderer {...(props as Parameters<typeof RecentClaimsRenderer>[0])} />,
  });

  useCopilotAction({
    name: "getEntityClaims",
    description: "Get claims for a specific entity",
    parameters: [
      { name: "entityName", type: "string", description: "Entity name", required: true },
      { name: "entityType", type: "string", description: "Entity type", required: false },
    ],
    render: (props) => <EntityClaimsRenderer {...(props as Parameters<typeof EntityClaimsRenderer>[0])} />,
  });

  useCopilotAction({
    name: "getDocumentAudit",
    description: "Get full audit for a document",
    parameters: [
      { name: "documentId", type: "number", description: "Document ID", required: true },
    ],
    render: (props) => <DocumentAuditRenderer {...(props as Parameters<typeof DocumentAuditRenderer>[0])} />,
  });

  useCopilotAction({
    name: "getPlatformStats",
    description: "Get live platform statistics",
    parameters: [],
    render: (props) => <PlatformStatsRenderer {...(props as Parameters<typeof PlatformStatsRenderer>[0])} />,
  });

  useCopilotAction({
    name: "compareClaims",
    description: "Compare two claims side-by-side",
    parameters: [
      { name: "claimIdA", type: "number", description: "First claim ID", required: true },
      { name: "claimIdB", type: "number", description: "Second claim ID", required: true },
    ],
    render: (props) => <CompareClaimsRenderer {...(props as Parameters<typeof CompareClaimsRenderer>[0])} />,
  });

  useCopilotAction({
    name: "searchUniProt",
    description: "Search UniProt for protein data",
    parameters: [
      { name: "query", type: "string", description: "Protein query", required: true },
      { name: "limit", type: "number", description: "Max results", required: false },
    ],
    render: (props) => <UniProtRenderer {...(props as Parameters<typeof UniProtRenderer>[0])} />,
  });

  useCopilotAction({
    name: "getGraphSummary",
    description: "Get knowledge graph summary",
    parameters: [],
    render: (props) => <GraphSummaryRenderer {...(props as Parameters<typeof GraphSummaryRenderer>[0])} />,
  });

  useCopilotAction({
    name: "searchPubMed",
    description: "Search PubMed / EuropePMC for peer-reviewed literature",
    parameters: [
      { name: "query", type: "string", description: "Scientific search query", required: true },
      { name: "limit", type: "number", description: "Max results (1-5)", required: false },
    ],
    render: (props) => <PubMedCardRenderer {...(props as Parameters<typeof PubMedCardRenderer>[0])} />,
  });
}

// ─── Component wrapper for use in layout ─────────────────────────────────────

export default function CopilotRenderers() {
  useCopilotRenderers();
  return null;
}
