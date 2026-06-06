/**
 * PreflightModal.tsx — FrictionEngine Pre-Submission Interrogation Layer
 *
 * Shown before a document is submitted for full audit. Runs a fast (~5s)
 * preflight scan and surfaces:
 *   - Claim counts by category (database_verifiable, assumption_smuggled, etc.)
 *   - A recommendation (proceed / review / rethink)
 *   - Individual claim previews with category badges
 *
 * The user can proceed to full audit or go back and revise.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { AlertTriangle, CheckCircle2, XCircle, Info, ArrowRight, RefreshCw } from "lucide-react";

// ─── Types mirroring frictionEngine.ts ───────────────────────────────────────

type ClaimCategory =
  | "database_verifiable"
  | "assumption_smuggled"
  | "likely_contradicted"
  | "out_of_scope"
  | "opinion_or_narrative";

interface PreflightClaim {
  text: string;
  category: ClaimCategory;
  assumptionExposed?: string;
  falsificationTest?: string;
}

interface PreflightResult {
  totalClaims: number;
  verifiable: number;
  smuggled: number;
  contradicted: number;
  outOfScope: number;
  opinion: number;
  recommendation: "proceed" | "review" | "rethink";
  recommendationReason: string;
  claims: PreflightClaim[];
}

// ─── Category styling ─────────────────────────────────────────────────────────

const CATEGORY_META: Record<
  ClaimCategory,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
> = {
  database_verifiable: {
    label: "Verifiable",
    variant: "default",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  assumption_smuggled: {
    label: "Smuggled Assumption",
    variant: "destructive",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  likely_contradicted: {
    label: "Likely Contradicted",
    variant: "destructive",
    icon: <XCircle className="w-3 h-3" />,
  },
  out_of_scope: {
    label: "Out of Scope",
    variant: "secondary",
    icon: <Info className="w-3 h-3" />,
  },
  opinion_or_narrative: {
    label: "Opinion / Narrative",
    variant: "outline",
    icon: <Info className="w-3 h-3" />,
  },
};

const RECOMMENDATION_META = {
  proceed: {
    icon: <CheckCircle2 className="w-5 h-5 text-green-400" />,
    label: "Ready to audit",
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
  },
  review: {
    icon: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
    label: "Review before submitting",
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/20",
  },
  rethink: {
    icon: <XCircle className="w-5 h-5 text-red-400" />,
    label: "Significant issues detected",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface PreflightModalProps {
  open: boolean;
  text: string;
  onClose: () => void;
  onProceed: () => void;
}

export function PreflightModal({ open, text, onClose, onProceed }: PreflightModalProps) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const scan = trpc.documents.preflightScan.useMutation({
    onSuccess: (data) => setResult(data as unknown as PreflightResult),
  });

  // Trigger scan when modal opens and text is available
  const handleOpen = (isOpen: boolean) => {
    if (isOpen && !result && !scan.isPending) {
      scan.mutate({ text });
    }
    if (!isOpen) {
      setResult(null);
      setExpandedIdx(null);
    }
  };

  const recMeta = result ? RECOMMENDATION_META[result.recommendation] : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        handleOpen(o);
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-purple-400">⚡</span> FrictionEngine Preflight Scan
          </DialogTitle>
          <DialogDescription>
            Before submitting for full audit, the FrictionEngine interrogates your document to surface
            hidden assumptions and unfalsifiable claims.
          </DialogDescription>
        </DialogHeader>

        {/* Loading state */}
        {scan.isPending && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Spinner className="w-8 h-8 text-purple-400" />
            <p className="text-sm text-muted-foreground">Scanning for hidden assumptions…</p>
          </div>
        )}

        {/* Error state */}
        {scan.isError && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <XCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm text-muted-foreground">Preflight scan failed. You can still proceed to full audit.</p>
            <Button variant="outline" size="sm" onClick={() => scan.mutate({ text })}>
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </div>
        )}

        {/* Results */}
        {result && recMeta && (
          <div className="space-y-4">
            {/* Recommendation banner */}
            <div className={`flex items-start gap-3 p-4 rounded-lg border ${recMeta.bg}`}>
              {recMeta.icon}
              <div>
                <p className={`font-semibold text-sm ${recMeta.color}`}>{recMeta.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{result.recommendationReason}</p>
              </div>
            </div>

            {/* Claim counts */}
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: "Verifiable", count: result.verifiable, color: "text-green-400" },
                { label: "Smuggled", count: result.smuggled, color: "text-red-400" },
                { label: "Contradicted", count: result.contradicted, color: "text-orange-400" },
                { label: "Out of Scope", count: result.outOfScope, color: "text-yellow-400" },
                { label: "Opinion", count: result.opinion, color: "text-muted-foreground" },
              ].map(({ label, count, color }) => (
                <div key={label} className="flex flex-col items-center p-3 rounded-lg bg-muted/30 border border-border/50">
                  <span className={`text-2xl font-bold ${color}`}>{count}</span>
                  <span className="text-xs text-muted-foreground text-center mt-1">{label}</span>
                </div>
              ))}
            </div>

            {/* Claim list */}
            {result.claims.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Detected Claims ({result.claims.length})
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {result.claims.map((claim, idx) => {
                    const meta = CATEGORY_META[claim.category] ?? CATEGORY_META.opinion_or_narrative;
                    const isExpanded = expandedIdx === idx;
                    const hasDetail = claim.assumptionExposed || claim.falsificationTest;
                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg border border-border/50 bg-muted/20 transition-all ${hasDetail ? "cursor-pointer hover:bg-muted/40" : ""}`}
                        onClick={() => hasDetail && setExpandedIdx(isExpanded ? null : idx)}
                      >
                        <div className="flex items-start gap-2">
                          <Badge variant={meta.variant} className="flex items-center gap-1 shrink-0 text-xs mt-0.5">
                            {meta.icon}
                            {meta.label}
                          </Badge>
                          <p className="text-sm text-foreground/90 leading-snug">{claim.text}</p>
                        </div>
                        {isExpanded && hasDetail && (
                          <div className="mt-3 pl-2 border-l-2 border-purple-500/40 space-y-2">
                            {claim.assumptionExposed && (
                              <div>
                                <p className="text-xs font-semibold text-purple-400">Assumption exposed</p>
                                <p className="text-xs text-muted-foreground">{claim.assumptionExposed}</p>
                              </div>
                            )}
                            {claim.falsificationTest && (
                              <div>
                                <p className="text-xs font-semibold text-yellow-400">Falsification test</p>
                                <p className="text-xs text-muted-foreground">{claim.falsificationTest}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Go Back &amp; Revise
          </Button>
          <Button
            onClick={onProceed}
            disabled={scan.isPending}
            className="gap-2"
          >
            Submit for Full Audit <ArrowRight className="w-4 h-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
