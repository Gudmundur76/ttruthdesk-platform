import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";

type Spec = {
  id: number;
  specId: string;
  adapterId: string;
  title: string;
  summary: string;
  beforeF1: number | null;
  afterF1Predicted: number | null;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
};

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending_review: "default",
    approved: "secondary",
    rejected: "destructive",
    applied: "outline",
  };
  const labels: Record<string, string> = {
    pending_review: "Pending Review",
    approved: "Approved",
    rejected: "Rejected",
    applied: "Applied",
  };
  return (
    <Badge variant={variants[status] ?? "outline"}>
      {labels[status] ?? status}
    </Badge>
  );
}

function SpecCard({ spec, onDecide }: { spec: Spec; onDecide: (specId: string, decision: "approve" | "reject") => void }) {
  const isPending = spec.status === "pending_review";
  const f1Text =
    spec.beforeF1 != null && spec.afterF1Predicted != null
      ? `F1: ${(spec.beforeF1 * 100).toFixed(1)}% → ${(spec.afterF1Predicted * 100).toFixed(1)}% predicted`
      : null;

  return (
    <Card className={`border ${isPending ? "border-yellow-500/40 bg-yellow-500/5" : "border-border"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold truncate">{spec.title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Adapter: <code className="text-xs bg-muted px-1 rounded">{spec.adapterId}</code>
              {f1Text && <span className="ml-2 text-emerald-600 dark:text-emerald-400">{f1Text}</span>}
            </p>
          </div>
          <StatusBadge status={spec.status} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">{spec.summary}</p>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Spec ID: <code className="bg-muted px-1 rounded">{spec.specId}</code>
            <span className="ml-2">{new Date(spec.createdAt).toLocaleString()}</span>
          </p>
          {isPending && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => onDecide(spec.specId, "reject")}
              >
                ✕ No
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => onDecide(spec.specId, "approve")}
              >
                ✓ Yes
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SelfDirectAdmin() {
  const [filter, setFilter] = useState<"all" | "pending">("pending");
  const utils = trpc.useUtils();

  const pendingQuery = trpc.selfDirect.listPending.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const allQuery = trpc.selfDirect.listSpecs.useQuery(undefined, {
    enabled: filter === "all",
  });

  const decideMutation = trpc.selfDirect.decide.useMutation({
    onSuccess: (data) => {
      const verb = data.status === "approved" ? "approved ✅" : "rejected ❌";
      toast.success(`Spec ${verb}`, {
        description: data.cliOutput ? `CLI: ${data.cliOutput.slice(0, 100)}` : undefined,
      });
      void utils.selfDirect.listPending.invalidate();
      void utils.selfDirect.listSpecs.invalidate();
    },
    onError: (err) => {
      toast.error("Decision failed", { description: err.message });
    },
  });

  const handleDecide = (specId: string, decision: "approve" | "reject") => {
    decideMutation.mutate({ specId, decision });
  };

  const specs = filter === "pending"
    ? (pendingQuery.data ?? [])
    : (allQuery.data ?? []);

  const isLoading = filter === "pending" ? pendingQuery.isLoading : allQuery.isLoading;
  const pendingCount = pendingQuery.data?.length ?? 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Self-Direct</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Autonomous adapter improvement proposals. Review and approve or reject each fix.
          </p>
        </div>
        {pendingCount > 0 && (
          <Badge className="bg-yellow-500 text-black text-sm px-3 py-1">
            {pendingCount} pending
          </Badge>
        )}
      </div>

      <Separator />

      {/* Filter tabs */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={filter === "pending" ? "default" : "outline"}
          onClick={() => setFilter("pending")}
        >
          Pending Review {pendingCount > 0 && `(${pendingCount})`}
        </Button>
        <Button
          size="sm"
          variant={filter === "all" ? "default" : "outline"}
          onClick={() => setFilter("all")}
        >
          All Specs
        </Button>
      </div>

      {/* Spec list */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : specs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-4xl mb-3">✅</p>
          <p className="font-medium">
            {filter === "pending" ? "No pending specs — all adapters are healthy." : "No specs recorded yet."}
          </p>
          <p className="text-sm mt-1">
            self-direct polls every 5 minutes and will notify you when a fix is ready.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(specs as Spec[]).map(spec => (
            <SpecCard
              key={spec.specId}
              spec={spec}
              onDecide={handleDecide}
            />
          ))}
        </div>
      )}
    </div>
  );
}
