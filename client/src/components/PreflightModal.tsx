/**
 * PreflightModal.tsx — FrictionEngine Pre-Submission Interrogation Layer
 *
 * Implements the full Friction Decision Policy from the FrictionEngine paper:
 *
 *   execute   → show summary, proceed button enabled immediately
 *   ask_user  → show friction_question, block Submit until user answers
 *   reject    → hard-block Submit, show rejection reason with no override
 *   reframe   → show optimized_prompt, let user confirm before proceeding
 *
 * Also surfaces:
 *   - inferred_intent (what the system thinks you're actually trying to do)
 *   - assumptions[] with type, risk level, and falsification test
 *   - validation_criteria (what the audit will check)
 *   - remaining_uncertainty
 *   - claim-level detail (category, assumptionExposed, falsificationTest)
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
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  ArrowRight,
  RefreshCw,
  Brain,
  HelpCircle,
  Lightbulb,
  ShieldAlert,
} from "lucide-react";

// ─── Types mirroring frictionEngine.ts ───────────────────────────────────────

type ClaimCategory =
  | "database_verifiable"
  | "assumption_smuggled"
  | "likely_contradicted"
  | "out_of_scope"
  | "opinion_or_narrative";

type AssumptionRisk = "low" | "medium" | "high";

interface FrictionAssumption {
  statement: string;
  type: string;
  risk: AssumptionRisk;
  test: string;
}

interface PreflightClaim {
  text: string;
  category: ClaimCategory;
  assumptionExposed?: string | null;
  falsificationTest?: string | null;
}

type RecommendedAction = "execute" | "ask_user" | "reject" | "reframe";

interface FrictionEngineResult {
  surface_request: string;
  inferred_intent: string;
  assumptions: FrictionAssumption[];
  friction_question: string;
  optimized_prompt: string;
  validation_criteria: string[];
  remaining_uncertainty: string;
  recommended_action: RecommendedAction;
  claims: PreflightClaim[];
  totalClaims: number;
  databaseVerifiable: number;
  assumptionSmuggled: number;
  likelyContradicted: number;
  outOfScope: number;
  opinionOrNarrative: number;
  durationMs: number;
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

const RISK_META: Record<AssumptionRisk, { color: string; label: string }> = {
  low: { color: "text-green-400", label: "Low risk" },
  medium: { color: "text-yellow-400", label: "Medium risk" },
  high: { color: "text-red-400", label: "High risk" },
};

// ─── Action banner config ─────────────────────────────────────────────────────

const ACTION_META: Record<
  RecommendedAction,
  { icon: React.ReactNode; label: string; color: string; bg: string }
> = {
  execute: {
    icon: <CheckCircle2 className="w-5 h-5 text-green-400" />,
    label: "Ready to audit",
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
  },
  ask_user: {
    icon: <HelpCircle className="w-5 h-5 text-yellow-400" />,
    label: "Clarification needed before submitting",
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/20",
  },
  reject: {
    icon: <ShieldAlert className="w-5 h-5 text-red-400" />,
    label: "Submission blocked — no verifiable content",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
  reframe: {
    icon: <Lightbulb className="w-5 h-5 text-blue-400" />,
    label: "A stronger framing is available",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface PreflightModalProps {
  open: boolean;
  text: string;
  onClose: () => void;
  /** Called when the user confirms proceed; receives the scan result so the parent can persist it */
  onProceed: (result: FrictionEngineResult | null) => void;
}

export function PreflightModal({ open, text, onClose, onProceed }: PreflightModalProps) {
  const [result, setResult] = useState<FrictionEngineResult | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [frictionAnswer, setFrictionAnswer] = useState("");
  const [reframeAccepted, setReframeAccepted] = useState(false);
  const [showAllAssumptions, setShowAllAssumptions] = useState(false);

  const scan = trpc.documents.preflightScan.useMutation({
    onSuccess: (data) => {
      setResult(data as unknown as FrictionEngineResult);
      setFrictionAnswer("");
      setReframeAccepted(false);
    },
  });

  const handleOpen = (isOpen: boolean) => {
    if (isOpen && !result && !scan.isPending) {
      scan.mutate({ text });
    }
    if (!isOpen) {
      setResult(null);
      setExpandedIdx(null);
      setFrictionAnswer("");
      setReframeAccepted(false);
    }
  };

  // ── Friction Decision Policy: can the user proceed? ──────────────────────
  const canProceed = (): boolean => {
    if (!result) return false;
    switch (result.recommended_action) {
      case "execute":
        return true;
      case "ask_user":
        // Must answer the friction question (min 15 chars)
        return frictionAnswer.trim().length >= 15;
      case "reject":
        // Hard block — no override
        return false;
      case "reframe":
        // Must explicitly accept the reframe
        return reframeAccepted;
    }
  };

  const actionMeta = result ? ACTION_META[result.recommended_action] : null;
  const highRiskAssumptions = result?.assumptions.filter((a) => a.risk === "high") ?? [];
  const visibleAssumptions = showAllAssumptions
    ? result?.assumptions ?? []
    : (result?.assumptions ?? []).slice(0, 3);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        handleOpen(o);
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-purple-400">⚡</span> FrictionEngine Preflight Scan
          </DialogTitle>
          <DialogDescription>
            The FrictionEngine interrogates your document before submission — surfacing hidden
            assumptions, inferring your deeper intent, and deciding whether to proceed, clarify, or
            block.
          </DialogDescription>
        </DialogHeader>

        {/* Loading state */}
        {scan.isPending && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Spinner className="w-8 h-8 text-purple-400" />
            <p className="text-sm text-muted-foreground">Running 7-stage interrogation…</p>
            <p className="text-xs text-muted-foreground/60">
              Inferring intent · Mapping assumptions · Selecting friction
            </p>
          </div>
        )}

        {/* Error state */}
        {scan.isError && (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <XCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm text-muted-foreground">
              Preflight scan failed. You can still proceed to full audit.
            </p>
            <Button variant="outline" size="sm" onClick={() => scan.mutate({ text })}>
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </div>
        )}

        {/* Results */}
        {result && actionMeta && (
          <div className="space-y-5">
            {/* ── Decision banner ── */}
            <div className={`flex items-start gap-3 p-4 rounded-lg border ${actionMeta.bg}`}>
              {actionMeta.icon}
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm ${actionMeta.color}`}>{actionMeta.label}</p>
                {result.recommended_action === "reject" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No verifiable claims were detected. The full audit pipeline would return empty
                    results. Revise the document to include specific, falsifiable scientific claims.
                  </p>
                )}
              </div>
            </div>

            {/* ── Inferred intent ── */}
            {result.inferred_intent && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 border border-border/40">
                <Brain className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-purple-400 mb-0.5">Inferred intent</p>
                  <p className="text-sm text-foreground/80">{result.inferred_intent}</p>
                </div>
              </div>
            )}

            {/* ── Claim counts ── */}
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: "Verifiable", count: result.databaseVerifiable, color: "text-green-400" },
                { label: "Smuggled", count: result.assumptionSmuggled, color: "text-red-400" },
                { label: "Contradicted", count: result.likelyContradicted, color: "text-orange-400" },
                { label: "Out of Scope", count: result.outOfScope, color: "text-yellow-400" },
                { label: "Opinion", count: result.opinionOrNarrative, color: "text-muted-foreground" },
              ].map(({ label, count, color }) => (
                <div
                  key={label}
                  className="flex flex-col items-center p-3 rounded-lg bg-muted/30 border border-border/50"
                >
                  <span className={`text-2xl font-bold ${color}`}>{count}</span>
                  <span className="text-xs text-muted-foreground text-center mt-1">{label}</span>
                </div>
              ))}
            </div>

            {/* ── Assumptions ── */}
            {result.assumptions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Hidden Assumptions ({result.assumptions.length})
                  {highRiskAssumptions.length > 0 && (
                    <span className="ml-2 text-red-400">
                      · {highRiskAssumptions.length} high-risk
                    </span>
                  )}
                </p>
                <div className="space-y-2">
                  {visibleAssumptions.map((assumption, idx) => {
                    const riskMeta = RISK_META[assumption.risk] ?? RISK_META.low;
                    return (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border border-border/50 bg-muted/20 space-y-1"
                      >
                        <div className="flex items-start gap-2">
                          <Badge
                            variant={assumption.risk === "high" ? "destructive" : "secondary"}
                            className="text-xs shrink-0 mt-0.5"
                          >
                            {riskMeta.label}
                          </Badge>
                          <p className="text-sm text-foreground/90 leading-snug">
                            {assumption.statement}
                          </p>
                        </div>
                        {assumption.test && (
                          <p className="text-xs text-muted-foreground pl-1">
                            <span className="text-yellow-400 font-medium">Test: </span>
                            {assumption.test}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {result.assumptions.length > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={() => setShowAllAssumptions((v) => !v)}
                    >
                      {showAllAssumptions
                        ? "Show fewer"
                        : `Show ${result.assumptions.length - 3} more assumptions`}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* ── Friction Question (ask_user) ── */}
            {result.recommended_action === "ask_user" && result.friction_question && (
              <div className="space-y-3 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
                <div className="flex items-start gap-2">
                  <HelpCircle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-yellow-400 mb-1">
                      Answer this before submitting
                    </p>
                    <p className="text-sm text-foreground/90 font-medium">
                      {result.friction_question}
                    </p>
                  </div>
                </div>
                <Textarea
                  placeholder="Your answer (minimum 15 characters)…"
                  value={frictionAnswer}
                  onChange={(e) => setFrictionAnswer(e.target.value)}
                  rows={3}
                  className="resize-none text-sm"
                />
                {frictionAnswer.trim().length > 0 && frictionAnswer.trim().length < 15 && (
                  <p className="text-xs text-muted-foreground">
                    {15 - frictionAnswer.trim().length} more characters needed
                  </p>
                )}
              </div>
            )}

            {/* ── Reframe suggestion (reframe) ── */}
            {result.recommended_action === "reframe" && result.optimized_prompt && (
              <div className="space-y-3 p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
                <div className="flex items-start gap-2">
                  <Lightbulb className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-blue-400 mb-1">
                      Optimized audit prompt
                    </p>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                      {result.optimized_prompt}
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reframeAccepted}
                    onChange={(e) => setReframeAccepted(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-foreground/80">
                    Use this reframed prompt for the audit
                  </span>
                </label>
              </div>
            )}

            {/* ── Validation criteria ── */}
            {result.validation_criteria.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Audit Validation Criteria
                </p>
                <ul className="space-y-1">
                  {result.validation_criteria.map((criterion, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />
                      {criterion}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Remaining uncertainty ── */}
            {result.remaining_uncertainty && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/10 border border-border/30">
                <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Remaining uncertainty: </span>
                  {result.remaining_uncertainty}
                </p>
              </div>
            )}

            {/* ── Claim list ── */}
            {result.claims.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Detected Claims ({result.claims.length})
                </p>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {result.claims.map((claim, idx) => {
                    const meta = CATEGORY_META[claim.category] ?? CATEGORY_META.opinion_or_narrative;
                    const isExpanded = expandedIdx === idx;
                    const hasDetail = claim.assumptionExposed || claim.falsificationTest;
                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg border border-border/50 bg-muted/20 transition-all ${
                          hasDetail ? "cursor-pointer hover:bg-muted/40" : ""
                        }`}
                        onClick={() => hasDetail && setExpandedIdx(isExpanded ? null : idx)}
                      >
                        <div className="flex items-start gap-2">
                          <Badge
                            variant={meta.variant}
                            className="flex items-center gap-1 shrink-0 text-xs mt-0.5"
                          >
                            {meta.icon}
                            {meta.label}
                          </Badge>
                          <p className="text-sm text-foreground/90 leading-snug">{claim.text}</p>
                        </div>
                        {isExpanded && hasDetail && (
                          <div className="mt-3 pl-2 border-l-2 border-purple-500/40 space-y-2">
                            {claim.assumptionExposed && (
                              <div>
                                <p className="text-xs font-semibold text-purple-400">
                                  Assumption exposed
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {claim.assumptionExposed}
                                </p>
                              </div>
                            )}
                            {claim.falsificationTest && (
                              <div>
                                <p className="text-xs font-semibold text-yellow-400">
                                  Falsification test
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {claim.falsificationTest}
                                </p>
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
          {result?.recommended_action !== "reject" && (
            <Button
              onClick={() => onProceed(result)}
              disabled={scan.isPending || !canProceed()}
              className="gap-2"
            >
              {result?.recommended_action === "ask_user" && frictionAnswer.trim().length < 15
                ? "Answer the question to proceed"
                : result?.recommended_action === "reframe" && !reframeAccepted
                ? "Accept reframe to proceed"
                : "Submit for Full Audit"}
              {canProceed() && <ArrowRight className="w-4 h-4" />}
            </Button>
          )}
          {result?.recommended_action === "reject" && (
            <Button variant="destructive" disabled>
              <ShieldAlert className="w-4 h-4 mr-2" /> Submission Blocked
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
