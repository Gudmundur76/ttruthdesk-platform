import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const MODEL_TYPES = [
  { value: "all", label: "All Models" },
  { value: "claim_trajectory", label: "Claim Trajectory" },
  { value: "author_reliability", label: "Author Reliability" },
  { value: "consensus_velocity", label: "Consensus Velocity" },
];

function AccuracyOverTimeChart({
  byDay,
}: {
  byDay: Array<{ date: string; total: number; correct: number; accuracy: number }>;
}) {
  if (byDay.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-slate-400">
        No validated predictions yet — validate some predictions below to see accuracy trends.
      </div>
    );
  }
  const data = {
    labels: byDay.map((d) => d.date),
    datasets: [
      {
        label: "Accuracy",
        data: byDay.map((d) => Math.round(d.accuracy * 100)),
        borderColor: "#6366f1",
        backgroundColor: "rgba(99, 102, 241, 0.08)",
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { parsed: { y: number } }) => `${ctx.parsed.y}% accuracy`,
        },
      },
    },
    scales: {
      y: {
        min: 0,
        max: 100,
        ticks: { callback: (v: number | string) => `${v}%` },
        grid: { color: "rgba(0,0,0,0.05)" },
      },
      x: {
        grid: { display: false },
        ticks: { maxRotation: 45 },
      },
    },
  };
  return (
    <div style={{ height: 200 }}>
      <Line data={data} options={options as never} />
    </div>
  );
}

function CalibrationChart({
  buckets,
}: {
  buckets: Array<{
    bucket: string;
    midpoint: number;
    total: number;
    actualRate: number;
  }>;
}) {
  const activeBuckets = buckets.filter((b) => b.total > 0);
  if (activeBuckets.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-slate-400">
        No validated predictions yet.
      </div>
    );
  }
  const data = {
    labels: activeBuckets.map((b) => b.bucket),
    datasets: [
      {
        label: "Predicted (midpoint)",
        data: activeBuckets.map((b) => Math.round(b.midpoint * 100)),
        backgroundColor: "rgba(99,102,241,0.3)",
        borderColor: "#6366f1",
        borderWidth: 1,
      },
      {
        label: "Actual rate",
        data: activeBuckets.map((b) => Math.round(b.actualRate * 100)),
        backgroundColor: "rgba(16,185,129,0.4)",
        borderColor: "#10b981",
        borderWidth: 1,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" as const },
      tooltip: {
        callbacks: {
          label: (ctx: { dataset: { label: string }; parsed: { y: number } }) =>
            `${ctx.dataset.label}: ${ctx.parsed.y}%`,
        },
      },
    },
    scales: {
      y: {
        min: 0,
        max: 100,
        ticks: { callback: (v: number | string) => `${v}%` },
        grid: { color: "rgba(0,0,0,0.05)" },
      },
      x: { grid: { display: false } },
    },
  };
  return (
    <div style={{ height: 200 }}>
      <Bar data={data} options={options as never} />
    </div>
  );
}

function PredictionRow({
  prediction,
  onValidate,
}: {
  prediction: {
    id: number;
    modelType: string;
    targetClaimId: number | null;
    targetUserId: number | null;
    prediction: unknown;
    createdAt: Date;
    validationResult: string | null;
  };
  onValidate: (id: number, result: "correct" | "incorrect") => void;
}) {
  const pred = prediction.prediction as {
    probability?: number;
    recommendedAction?: string;
    tier?: string;
  } | null;

  const prob = pred?.probability;
  const probPct = prob !== undefined ? `${Math.round(prob * 100)}%` : "—";
  const probColor =
    prob === undefined
      ? "text-slate-400"
      : prob >= 0.7
      ? "text-red-600 font-semibold"
      : prob >= 0.4
      ? "text-amber-600 font-semibold"
      : "text-emerald-600 font-semibold";

  return (
    <tr className="border-b border-border hover:bg-slate-50 transition-colors">
      <td className="px-4 py-3 text-xs text-slate-500 font-mono">#{prediction.id}</td>
      <td className="px-4 py-3">
        <Badge variant="outline" className="text-xs capitalize">
          {prediction.modelType.replace(/_/g, " ")}
        </Badge>
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {prediction.targetClaimId ? `Claim #${prediction.targetClaimId}` : ""}
        {prediction.targetUserId ? `User #${prediction.targetUserId}` : ""}
      </td>
      <td className={`px-4 py-3 text-sm ${probColor}`}>{probPct}</td>
      <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">
        {pred?.recommendedAction ?? pred?.tier ?? "—"}
      </td>
      <td className="px-4 py-3 text-xs text-slate-400">
        {new Date(prediction.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        {prediction.validationResult === "pending" ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              onClick={() => onValidate(prediction.id, "correct")}
            >
              ✓ Correct
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50"
              onClick={() => onValidate(prediction.id, "incorrect")}
            >
              ✗ Incorrect
            </Button>
          </div>
        ) : (
          <Badge
            className={
              prediction.validationResult === "correct"
                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                : "bg-red-100 text-red-800 border-red-200"
            }
          >
            {prediction.validationResult}
          </Badge>
        )}
      </td>
    </tr>
  );
}

function PredictionCalibrationContent() {
  const { user } = useAuth();
  const [modelType, setModelType] = useState<string>("all");

  const utils = trpc.useUtils();

  const { data: stats, isLoading: statsLoading } = trpc.predictions.calibrationStats.useQuery(
    { modelType: modelType === "all" ? undefined : modelType },
    { refetchInterval: 15000 }
  );

  const { data: pending, isLoading: pendingLoading } =
    trpc.predictions.predictionsForReview.useQuery({ limit: 100 });

  const validate = trpc.predictions.validatePrediction.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`Prediction #${vars.predictionId} marked as ${vars.result}`);
      utils.predictions.calibrationStats.invalidate();
      utils.predictions.predictionsForReview.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const isOwner = user?.role === "admin" || !!user;
  if (!isOwner) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center">
        <h2 className="text-xl font-bold text-slate-900 mb-2">Forbidden</h2>
        <p className="text-slate-500 text-sm">Owner or admin access required.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Prediction Calibration</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Track model accuracy and validate prediction outcomes
          </p>
        </div>
        <Select value={modelType} onValueChange={setModelType}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_TYPES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary stats */}
      {statsLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: "Overall Accuracy",
              value:
                stats.totalValidated > 0
                  ? `${Math.round(stats.overallAccuracy * 100)}%`
                  : "—",
              sub: `${stats.totalValidated} validated`,
              color: "text-indigo-600",
            },
            {
              label: "Pending Validation",
              value: stats.totalPending,
              sub: "awaiting outcome",
              color: "text-amber-600",
            },
            {
              label: "Calibration Buckets",
              value: stats.buckets.filter((b) => b.total > 0).length,
              sub: "of 10 populated",
              color: "text-slate-700",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white rounded-xl border border-border p-4 shadow-sm"
            >
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-sm font-medium text-slate-700 mt-0.5">{s.label}</p>
              <p className="text-xs text-slate-400">{s.sub}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Accuracy Over Time</h2>
          {statsLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <AccuracyOverTimeChart byDay={stats?.byDay ?? []} />
          )}
        </div>
        <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Calibration Curve</h2>
          <p className="text-xs text-slate-400 mb-3">
            Predicted probability vs. actual outcome rate per bucket
          </p>
          {statsLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <CalibrationChart buckets={stats?.buckets ?? []} />
          )}
        </div>
      </div>

      {/* Calibration table */}
      {stats && stats.buckets.some((b) => b.total > 0) && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-slate-700">Calibration Buckets</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-2 text-left">Bucket</th>
                  <th className="px-4 py-2 text-right">Predictions</th>
                  <th className="px-4 py-2 text-right">Correct</th>
                  <th className="px-4 py-2 text-right">Incorrect</th>
                  <th className="px-4 py-2 text-right">Actual Rate</th>
                  <th className="px-4 py-2 text-right">Midpoint</th>
                  <th className="px-4 py-2 text-right">Calibration Error</th>
                </tr>
              </thead>
              <tbody>
                {stats.buckets
                  .filter((b) => b.total > 0)
                  .map((b) => {
                    const error = Math.abs(b.actualRate - b.midpoint);
                    const errorColor =
                      error < 0.1
                        ? "text-emerald-600"
                        : error < 0.2
                        ? "text-amber-600"
                        : "text-red-600";
                    return (
                      <tr
                        key={b.bucket}
                        className="border-b border-border hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {b.bucket}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">{b.total}</td>
                        <td className="px-4 py-3 text-right text-emerald-600">{b.correct}</td>
                        <td className="px-4 py-3 text-right text-red-500">{b.incorrect}</td>
                        <td className="px-4 py-3 text-right font-medium">
                          {Math.round(b.actualRate * 100)}%
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500">
                          {Math.round(b.midpoint * 100)}%
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${errorColor}`}>
                          {Math.round(error * 100)}pp
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pending validations */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Pending Validations</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Mark predictions as correct or incorrect once the actual outcome is known
            </p>
          </div>
          {pending && (
            <Badge variant="outline" className="text-xs">
              {pending.length} pending
            </Badge>
          )}
        </div>
        {pendingLoading ? (
          <div className="p-5 space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !pending || pending.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No predictions awaiting validation. Predictions are generated automatically when
            documents are analysed.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-2 text-left">ID</th>
                  <th className="px-4 py-2 text-left">Model</th>
                  <th className="px-4 py-2 text-left">Target</th>
                  <th className="px-4 py-2 text-left">Probability</th>
                  <th className="px-4 py-2 text-left">Rationale</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2 text-left">Validate</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <PredictionRow
                    key={p.id}
                    prediction={p}
                    onValidate={(id, result) =>
                      validate.mutate({ predictionId: id, result })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PredictionCalibration() {
  return (
    <DashboardLayout>
      <PredictionCalibrationContent />
    </DashboardLayout>
  );
}
