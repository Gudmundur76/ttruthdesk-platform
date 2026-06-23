/**
 * QuantumJobs.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin page: live view of the quantum_vqe_jobs table.
 * Shows WuKong hardware job queue with status, molecule, VQE energy, timestamps.
 *
 * Route: /admin/quantum-jobs
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Zap,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        <CheckCircle2 className="w-3 h-3" />
        done
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
        <XCircle className="w-3 h-3" />
        failed
      </span>
    );
  }
  if (status === "computing") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30">
        <Loader2 className="w-3 h-3 animate-spin" />
        computing
      </span>
    );
  }
  // pending
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
      <Clock className="w-3 h-3" />
      pending
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function QuantumJobs() {
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "computing" | "done" | "failed"
  >("all");
  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.quantumJobs.list.useQuery(
    { limit: 100 },
    { refetchInterval: 15_000 } // auto-refresh every 15s
  );

  const triggerPoll = trpc.quantumJobs.triggerPoll.useMutation({
    onSuccess: result => {
      toast.success(
        `Poll complete — ${result.polled} jobs checked, ${result.upgraded} upgraded`
      );
      void utils.quantumJobs.list.invalidate();
    },
    onError: err => toast.error(`Poll failed: ${err.message}`),
  });

  // data is a flat array; apply client-side status filter
  const allJobs = data ?? [];
  const jobs =
    statusFilter === "all"
      ? allJobs
      : allJobs.filter(j => j.status === statusFilter);

  // Summary counts
  const counts = jobs.reduce(
    (acc, j) => {
      acc[j.status] = (acc[j.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Zap className="w-6 h-6 text-violet-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Quantum VQE Jobs</h1>
              <p className="text-slate-400 text-sm">
                WuKong hardware job queue — auto-refreshes every 15s
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              className="gap-2 border-slate-700 text-slate-300 hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => triggerPoll.mutate()}
              disabled={triggerPoll.isPending}
              className="gap-2 bg-violet-600 hover:bg-violet-500 text-white"
            >
              {triggerPoll.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              Poll Now
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {(["pending", "computing", "done", "failed"] as const).map(s => (
            <Card key={s} className="bg-slate-900/60 border-slate-700">
              <CardContent className="py-3 px-4">
                <p className="text-2xl font-bold text-white">
                  {counts[s] ?? 0}
                </p>
                <StatusBadge status={s} />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter + table */}
        <Card className="bg-slate-900/60 border-slate-700">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-slate-300">
              Jobs ({jobs.length})
            </CardTitle>
            <Select
              value={statusFilter}
              onValueChange={v => setStatusFilter(v as typeof statusFilter)}
            >
              <SelectTrigger className="w-36 h-8 text-xs border-slate-700 bg-slate-800 text-slate-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="computing">Computing</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="h-10 w-full rounded bg-slate-800"
                  />
                ))}
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <Zap className="w-10 h-10 text-slate-600 mb-3" />
                <p className="text-slate-400 font-medium">No jobs found</p>
                <p className="text-slate-600 text-sm mt-1">
                  VQE jobs are submitted automatically when molecular candidates
                  are analysed.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-transparent">
                      <TableHead className="text-slate-400 text-xs">
                        Job ID
                      </TableHead>
                      <TableHead className="text-slate-400 text-xs">
                        Status
                      </TableHead>
                      <TableHead className="text-slate-400 text-xs">
                        Backend
                      </TableHead>
                      <TableHead className="text-slate-400 text-xs">
                        VQE Energy (Ha)
                      </TableHead>
                      <TableHead className="text-slate-400 text-xs">
                        Shots
                      </TableHead>
                      <TableHead className="text-slate-400 text-xs">
                        Edge ID
                      </TableHead>
                      <TableHead className="text-slate-400 text-xs">
                        Submitted
                      </TableHead>
                      <TableHead className="text-slate-400 text-xs">
                        Completed
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map(job => (
                      <TableRow
                        key={job.id}
                        className="border-slate-800 hover:bg-slate-800/40"
                      >
                        <TableCell className="font-mono text-xs text-slate-300 max-w-[140px] truncate">
                          {job.jobId}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={job.status} />
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {job.backend}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-violet-300">
                          {job.vqeEnergyHartree != null
                            ? job.vqeEnergyHartree.toFixed(6)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {job.shots.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {job.citationEdgeId ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {new Date(job.submittedAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {job.completedAt
                            ? new Date(job.completedAt).toLocaleString()
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
