import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { GitMerge, AlertTriangle } from "lucide-react";

// ─── Verdict badge colours ────────────────────────────────────────────────────

const VERDICT_COLORS: Record<string, string> = {
  Supported: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Contradicted: "bg-red-500/15 text-red-400 border-red-500/30",
  "Needs Expert Review": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "Insufficient Evidence": "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** Show similar claims for an existing claim by ID */
  claimId?: number;
  /** Show similar claims for a raw text query */
  queryText?: string;
  threshold?: number;
  topK?: number;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SimilarClaimsPanel({ claimId, queryText, threshold = 0.35, topK = 6, className }: Props) {
  const byId = trpc.similarity.findSimilarToId.useQuery(
    { claimId: claimId!, threshold, topK },
    { enabled: !!claimId }
  );

  const byText = trpc.similarity.findSimilar.useQuery(
    { queryText: queryText!, threshold, topK },
    { enabled: !!queryText && !claimId }
  );

  const { data, isLoading, error } = claimId ? byId : byText;

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-violet-400" />
            Similar Claims
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-violet-400" />
            Similar Claims
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {error ? "Failed to load similar claims." : "No similar claims found above the similarity threshold."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitMerge className="w-4 h-4 text-violet-400" />
          Similar Claims
          <span className="ml-auto text-xs text-muted-foreground font-normal">{data.length} found</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.map((item) => (
          <div key={item.claimId} className="space-y-1.5 border-b border-border/40 pb-3 last:border-0 last:pb-0">
            {/* Similarity bar */}
            <div className="flex items-center gap-2">
              <Progress value={item.similarity * 100} className="h-1.5 flex-1" />
              <span className="text-[10px] font-mono text-muted-foreground w-10 text-right">
                {Math.round(item.similarity * 100)}%
              </span>
            </div>

            {/* Claim text */}
            <p className="text-xs text-foreground/90 leading-relaxed line-clamp-2">
              {item.claimText}
            </p>

            {/* Metadata row */}
            <div className="flex items-center gap-2 flex-wrap">
              {item.verdict && (
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${VERDICT_COLORS[item.verdict] ?? ""}`}
                >
                  {item.verdict}
                </Badge>
              )}
              {item.confidenceScore != null && (
                <span className="text-[10px] text-muted-foreground">
                  {Math.round(item.confidenceScore * 100)}% confidence
                </span>
              )}
              <Link
                href={`/documents/${item.documentId}`}
                className="text-[10px] text-violet-400 hover:text-violet-300 ml-auto truncate max-w-[140px]"
              >
                {item.documentTitle}
              </Link>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Duplicate detector panel ─────────────────────────────────────────────────

interface DuplicateProps {
  documentId: number;
  className?: string;
}

export function DuplicateClaimsPanel({ documentId, className }: DuplicateProps) {
  const { data, isLoading } = trpc.similarity.detectDuplicates.useQuery(
    { documentId, threshold: 0.8 },
    { enabled: !!documentId }
  );

  if (isLoading || !data || data.length === 0) return null;

  return (
    <Card className={`border-amber-500/30 ${className ?? ""}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-400">
          <AlertTriangle className="w-4 h-4" />
          Near-Duplicate Claims Detected
          <Badge variant="outline" className="ml-auto bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">
            {data.length} pair{data.length !== 1 ? "s" : ""}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((pair, i) => (
          <div key={i} className="space-y-1.5 border-b border-border/40 pb-3 last:border-0 last:pb-0">
            <div className="flex items-center gap-2">
              <Progress value={pair.similarity * 100} className="h-1.5 flex-1" />
              <span className="text-[10px] font-mono text-amber-400 w-10 text-right">
                {Math.round(pair.similarity * 100)}%
              </span>
            </div>
            <p className="text-xs text-foreground/80 line-clamp-1">A: {pair.textA}</p>
            <p className="text-xs text-foreground/80 line-clamp-1">B: {pair.textB}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
