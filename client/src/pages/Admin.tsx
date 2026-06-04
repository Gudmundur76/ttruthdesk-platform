import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

function AdminContent() {
  const { user } = useAuth();
  const { data: status, refetch } = trpc.admin.backfillStatus.useQuery(undefined, {
    refetchInterval: 3000,
  });
  const backfill = trpc.admin.backfillWiki.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Frontend guard: only admin-role users may see this page (backend enforces it too)
  const isOwner = user?.role === "admin";

  if (!isOwner) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center">
        <h2 className="text-xl font-bold text-slate-900 mb-2">Forbidden</h2>
        <p className="text-slate-500 text-sm">Owner or admin access required.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-6">Admin</h1>

      <div className="bg-white rounded-xl border border-border p-6 shadow-sm mb-6">
        <h2 className="font-semibold text-slate-900 mb-4">Wiki Backfill</h2>
        <p className="text-sm text-slate-500 mb-4">
          Compiles all completed documents into the knowledge graph wiki. Runs 15 documents in
          parallel with retry logic. Safe to re-run — already-compiled documents are skipped.
        </p>
        <Button
          onClick={() => backfill.mutate()}
          disabled={backfill.isPending}
          className="bg-slate-900 hover:bg-slate-800"
        >
          {backfill.isPending ? "Starting…" : "Run Wiki Backfill"}
        </Button>
      </div>

      {status && (
        <div className="bg-slate-50 rounded-xl border border-border p-5">
          <h2 className="font-semibold text-slate-700 mb-3 text-sm uppercase tracking-wide">
            Backfill Status
          </h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { label: "Completed Docs", value: status.completedDocuments },
              { label: "Wiki Compiled", value: status.wikiCompiled },
              { label: "Pending", value: status.wikiPending },
              { label: "% Complete", value: `${status.percentComplete}%` },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-lg border border-border p-3">
                <p className="text-lg font-bold text-slate-900">{s.value}</p>
                <p className="text-xs text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
          {status.wikiPending > 0 && (
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className="bg-slate-900 h-2 rounded-full transition-all"
                style={{ width: `${status.percentComplete}%` }}
              />
            </div>
          )}
          <details className="mt-4">
            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
              Raw JSON
            </summary>
            <pre className="mt-2 text-xs text-slate-600 bg-white border border-border rounded p-3 overflow-auto">
              {JSON.stringify(status, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  return (
    <DashboardLayout>
      <AdminContent />
    </DashboardLayout>
  );
}
