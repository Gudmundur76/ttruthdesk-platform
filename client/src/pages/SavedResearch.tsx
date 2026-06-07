import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
  BookOpen,
  FileText,
  ExternalLink,
  Calendar,
  ChevronDown,
  ChevronRight,
  Trash2,
  Dna,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

// ─── Verdict helpers ──────────────────────────────────────────────────────────

function verdictColor(v: string): string {
  const lv = (v ?? "").toLowerCase();
  if (lv.includes("support")) return "bg-green-100 text-green-800 border-green-200";
  if (lv.includes("contradict")) return "bg-red-100 text-red-800 border-red-200";
  if (lv.includes("partial")) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (lv.includes("ambiguous")) return "bg-purple-100 text-purple-800 border-purple-200";
  if (lv.includes("insufficient")) return "bg-gray-100 text-gray-600 border-gray-200";
  return "bg-muted text-muted-foreground";
}

function VerdictIcon({ verdict }: { verdict: string }) {
  const lv = (verdict ?? "").toLowerCase();
  if (lv.includes("support")) return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
  if (lv.includes("contradict")) return <XCircle className="h-3.5 w-3.5 text-red-600" />;
  if (lv.includes("partial")) return <AlertCircle className="h-3.5 w-3.5 text-yellow-600" />;
  return <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ClaimRecord = {
  claimText: string;
  searchQuery?: string;
  proteinName?: string | null;
  organism?: string | null;
  verdict: { verdict: string; rationale?: string } | null;
  pubmedEvidence: Array<{
    pmid: string;
    title: string;
    abstractSnippet?: string;
    citationUrl: string;
    journal?: string | null;
    year?: number | null;
  }>;
};

// ─── Single saved research card ───────────────────────────────────────────────

function SavedResearchCard({
  item,
  onDelete,
}: {
  item: {
    id: number;
    question: string;
    claimsJson: unknown[];
    totalPapers: number;
    supportedClaims: number;
    claimsAnalysed: number;
    createdAt: Date;
  };
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openClaims, setOpenClaims] = useState<Record<number, boolean>>({});
  const claims = (item.claimsJson ?? []) as ClaimRecord[];

  return (
    <Card className="border-violet-100 hover:border-violet-200 transition-colors">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold text-foreground leading-snug line-clamp-2">
              "{item.question}"
            </CardTitle>
            <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {format(new Date(item.createdAt), "dd MMM yyyy, HH:mm")}
              </span>
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {item.claimsAnalysed} claims
              </span>
              <span className="flex items-center gap-1">
                <BookOpen className="h-3 w-3" />
                {item.totalPapers} papers
              </span>
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-3 w-3" />
                {item.supportedClaims} supported
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onDelete(item.id)}
              className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
              title="Delete saved research"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {/* Summary verdict badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {claims.slice(0, 4).map((c, i) =>
            c.verdict ? (
              <span
                key={i}
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${verdictColor(c.verdict.verdict)}`}
              >
                <VerdictIcon verdict={c.verdict.verdict} />
                {c.verdict.verdict}
              </span>
            ) : null
          )}
          {claims.length > 4 && (
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5">
              +{claims.length - 4} more
            </span>
          )}
        </div>

        {/* Expandable claim detail */}
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 transition-colors">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {open ? "Hide" : "Show"} {claims.length} detailed claim{claims.length !== 1 ? "s" : ""}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-2">
            {claims.map((claim, i) => (
              <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground leading-snug">
                      {claim.claimText}
                    </p>
                    {(claim.proteinName || claim.organism) && (
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {claim.proteinName && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
                            <Dna className="h-2.5 w-2.5" />
                            {claim.proteinName}
                          </span>
                        )}
                        {claim.organism && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-100">
                            {claim.organism}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {claim.verdict && (
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${verdictColor(claim.verdict.verdict)}`}
                    >
                      <VerdictIcon verdict={claim.verdict.verdict} />
                      {claim.verdict.verdict}
                    </span>
                  )}
                </div>
                {claim.verdict?.rationale && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed border-l-2 border-violet-200 pl-2">
                    {claim.verdict.rationale}
                  </p>
                )}
                {claim.pubmedEvidence && claim.pubmedEvidence.length > 0 && (
                  <Collapsible
                    open={openClaims[i] ?? false}
                    onOpenChange={(v) => setOpenClaims((p) => ({ ...p, [i]: v }))}
                  >
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-1 text-[11px] text-violet-600 hover:text-violet-800 transition-colors">
                        {openClaims[i] ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        {claim.pubmedEvidence.length} source
                        {claim.pubmedEvidence.length > 1 ? "s" : ""}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-1.5">
                      {claim.pubmedEvidence.map((p, pi) => (
                        <div key={pi} className="rounded border bg-muted/30 p-2 space-y-1">
                          <div className="flex items-start gap-2">
                            <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-green-100 text-green-800 border border-green-200 shrink-0">
                              PMID {p.pmid}
                            </span>
                            <a
                              href={p.citationUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-medium text-foreground hover:underline leading-snug"
                            >
                              {p.title}
                            </a>
                          </div>
                          {(p.journal || p.year) && (
                            <div className="flex gap-2 text-[10px] text-muted-foreground">
                              {p.journal && (
                                <span className="flex items-center gap-1">
                                  <BookOpen className="h-2.5 w-2.5" />
                                  {p.journal}
                                </span>
                              )}
                              {p.year && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-2.5 w-2.5" />
                                  {p.year}
                                </span>
                              )}
                            </div>
                          )}
                          <a
                            href={p.citationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-green-600 hover:underline"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                            View on PubMed
                          </a>
                        </div>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SavedResearchPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.savedResearch.list.useQuery({});

  const deleteMutation = trpc.savedResearch.delete.useMutation({
    onSuccess: () => {
      toast.success("Research deleted");
      utils.savedResearch.list.invalidate();
    },
    onError: (e) => toast.error("Delete failed: " + e.message),
  });

  const handleDelete = (id: number) => {
    if (!confirm("Delete this saved research?")) return;
    deleteMutation.mutate({ id });
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Saved Research</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your library of cited evidence from Truth Desk queries. Each entry contains decomposed
          claims, verdicts, and PubMed sources.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && (!data || data.length === 0) && (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">No saved research yet</p>
          <p className="text-sm mt-1">Ask the Truth Desk assistant a question and click &lsquo;Save Research&rsquo; to build your library.</p>
        </div>
      )}

      {!isLoading && data && data.length > 0 && (
        <div className="space-y-3">
          {data.map((item) => (
            <SavedResearchCard
              key={item.id}
              item={item}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
