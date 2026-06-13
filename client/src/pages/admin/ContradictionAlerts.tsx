/**
 * ContradictionAlerts.tsx — Phase 107
 *
 * Admin page for reviewing and resolving contradiction alerts detected by the
 * Contradiction Detection Engine (contradictionDetector.ts).
 *
 * Shows a summary card with counts by severity, a filterable table of open
 * alerts, and inline status management (reviewed / resolved / dismissed).
 */

import { useState } from "react";
import React from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, XCircle, Eye, RefreshCw } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AlertStatus = "open" | "reviewed" | "resolved" | "dismissed";

interface ContradictionAlert {
  id: number;
  claimAId: number;
  claimBId: number;
  claimAVerdict: string | null;
  claimBVerdict: string | null;
  claimALabel: string | null;
  claimBLabel: string | null;
  claimAScore: number | null;
  claimBScore: number | null;
  edgeWeight: number;
  severity: "high" | "medium" | "low";
  status: AlertStatus;
  resolutionNotes: string | null;
  detectedAt: Date;
  updatedAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function severityBadge(severity: "high" | "medium" | "low") {
  if (severity === "high")
    return <Badge variant="destructive" className="text-xs">High</Badge>;
  if (severity === "medium")
    return <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">Medium</Badge>;
  return <Badge variant="secondary" className="text-xs">Low</Badge>;
}

function statusBadge(status: AlertStatus): React.ReactElement {
  const map: Record<AlertStatus, React.ReactElement> = {
    open: <Badge variant="destructive" className="text-xs">Open</Badge>,
    reviewed: <Badge variant="outline" className="text-xs border-blue-500 text-blue-600">Reviewed</Badge>,
    resolved: <Badge variant="outline" className="text-xs border-green-500 text-green-600">Resolved</Badge>,
    dismissed: <Badge variant="secondary" className="text-xs">Dismissed</Badge>,
  };
  return map[status];
}

function labelPill(label: string | null): React.ReactNode {
  if (!label) return <span className="text-muted-foreground text-xs">—</span>;
  const colorMap: Record<string, string> = {
    verified_faithful: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    partially_supported: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    contradicted: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    contradicted_amplified: "bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100",
    contested: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    insufficient_evidence: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    out_of_scope: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  };
  const cls = colorMap[label] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export default function ContradictionAlerts() {
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("open_reviewed");
  const [resolveDialogAlert, setResolveDialogAlert] = useState<ContradictionAlert | null>(null);
  const [resolveStatus, setResolveStatus] = useState<AlertStatus>("resolved");
  const [resolveNotes, setResolveNotes] = useState("");

  const utils = trpc.useUtils();

  const { data: counts, isLoading: countsLoading } = trpc.contradictions.counts.useQuery();
  const { data: alerts, isLoading: alertsLoading } = trpc.contradictions.list.useQuery();

  const updateStatus = trpc.contradictions.updateStatus.useMutation({
    onSuccess: () => {
      utils.contradictions.list.invalidate();
      utils.contradictions.counts.invalidate();
      toast.success("Alert status updated");
      setResolveDialogAlert(null);
      setResolveNotes("");
    },
    onError: (err: { message: string }) => toast.error(`Failed: ${err.message}`),
  });

  const runScan = trpc.contradictions.runScan.useMutation({
    onSuccess: (result: { newAlerts: number; updatedAlerts: number; pairsScanned: number }) => {
      utils.contradictions.list.invalidate();
      utils.contradictions.counts.invalidate();
      toast.success(
        `Scan complete: ${result.newAlerts} new, ${result.updatedAlerts} updated, ${result.pairsScanned} pairs scanned`
      );
    },
    onError: (err: { message: string }) => toast.error(`Scan failed: ${err.message}`),
  });

  // ── Filter alerts ──────────────────────────────────────────────────────────
  const filtered = (alerts ?? []).filter((a: ContradictionAlert) => {
    const sevOk = filterSeverity === "all" || a.severity === filterSeverity;
    const stOk =
      filterStatus === "all" ||
      (filterStatus === "open_reviewed" && (a.status === "open" || a.status === "reviewed")) ||
      a.status === filterStatus;
    return sevOk && stOk;
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contradiction Alerts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Claim pairs with opposing composite truth labels detected via graph traversal
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => runScan.mutate({})}
          disabled={runScan.isPending}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${runScan.isPending ? "animate-spin" : ""}`} />
          {runScan.isPending ? "Scanning…" : "Run Scan Now"}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {countsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))
        ) : (
          <>
            <Card className="border-red-200 dark:border-red-800">
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">High</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  <span className="text-2xl font-bold text-red-600">{counts?.high ?? 0}</span>
                </div>
              </CardContent>
            </Card>
            <Card className="border-amber-200 dark:border-amber-800">
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Medium</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <span className="text-2xl font-bold text-amber-600">{counts?.medium ?? 0}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Low</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                  <span className="text-2xl font-bold">{counts?.low ?? 0}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Total Open</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5 text-blue-500" />
                  <span className="text-2xl font-bold">{counts?.total ?? 0}</span>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open_reviewed">Open / Reviewed</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground self-center">
          {filtered.length} alert{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Alerts table */}
      {alertsLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
            <p className="text-lg font-medium">No contradiction alerts</p>
            <p className="text-muted-foreground text-sm mt-1">
              {counts?.total === 0
                ? "Run a scan to detect contradictions in the knowledge graph."
                : "All alerts have been resolved or dismissed."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((alert: ContradictionAlert) => (
            <Card key={alert.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Severity + status */}
                  <div className="flex flex-col gap-1 min-w-[90px]">
                    {severityBadge(alert.severity)}
                    {statusBadge(alert.status)}
                  </div>

                  {/* Claim pair */}
                  <div className="flex-1 min-w-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground font-medium">Claim A (#{alert.claimAId})</div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {labelPill(alert.claimALabel)}
                          {alert.claimAVerdict && (
                            <span className="text-xs text-muted-foreground">{alert.claimAVerdict}</span>
                          )}
                          {alert.claimAScore !== null && (
                            <span className="text-xs text-muted-foreground">
                              score: {alert.claimAScore.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground font-medium">Claim B (#{alert.claimBId})</div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {labelPill(alert.claimBLabel)}
                          {alert.claimBVerdict && (
                            <span className="text-xs text-muted-foreground">{alert.claimBVerdict}</span>
                          )}
                          {alert.claimBScore !== null && (
                            <span className="text-xs text-muted-foreground">
                              score: {alert.claimBScore.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Edge weight: {alert.edgeWeight.toFixed(2)}</span>
                      <span>·</span>
                      <span>Detected: {new Date(alert.detectedAt).toLocaleDateString()}</span>
                      {alert.resolutionNotes && (
                        <>
                          <span>·</span>
                          <span className="italic truncate max-w-[200px]">{alert.resolutionNotes}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1 shrink-0">
                    {alert.status === "open" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() =>
                          updateStatus.mutate({ alertId: alert.id, status: "reviewed" })
                        }
                        disabled={updateStatus.isPending}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Mark Reviewed
                      </Button>
                    )}
                    {(alert.status === "open" || alert.status === "reviewed") && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 border-green-500 text-green-600 hover:bg-green-50"
                          onClick={() => {
                            setResolveDialogAlert(alert);
                            setResolveStatus("resolved");
                            setResolveNotes("");
                          }}
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Resolve
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 border-gray-400 text-gray-500 hover:bg-gray-50"
                          onClick={() => {
                            setResolveDialogAlert(alert);
                            setResolveStatus("dismissed");
                            setResolveNotes("");
                          }}
                        >
                          <XCircle className="h-3 w-3 mr-1" />
                          Dismiss
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Resolve / Dismiss dialog */}
      <Dialog
        open={!!resolveDialogAlert}
        onOpenChange={(open) => !open && setResolveDialogAlert(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resolveStatus === "resolved" ? "Resolve" : "Dismiss"} Contradiction Alert
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {resolveStatus === "resolved"
                ? "Mark this contradiction as resolved. Add notes explaining how it was addressed."
                : "Dismiss this alert as a false positive. Add notes explaining why."}
            </p>
            <Textarea
              placeholder="Optional resolution notes…"
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialogAlert(null)}>
              Cancel
            </Button>
            <Button
              variant={resolveStatus === "resolved" ? "default" : "secondary"}
              onClick={() => {
                if (!resolveDialogAlert) return;
                updateStatus.mutate({
                  alertId: resolveDialogAlert.id,
                  status: resolveStatus,
                  resolutionNotes: resolveNotes || undefined,
                });
              }}
              disabled={updateStatus.isPending}
            >
              {updateStatus.isPending ? "Saving…" : resolveStatus === "resolved" ? "Mark Resolved" : "Dismiss Alert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
