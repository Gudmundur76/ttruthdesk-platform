import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Copy, CheckCircle2, RotateCcw, ShieldAlert, KeyRound } from "lucide-react";

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          toast.success(`${label ?? "Value"} copied`);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
      title={`Copy ${label ?? "value"}`}
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── Key Rotation Card ────────────────────────────────────────────────────────

function KeyRotationCard() {
  const utils = trpc.useUtils();
  const [result, setResult] = useState<{
    oldKid: string;
    newKid: string;
    secretPersisted: boolean;
    message: string;
  } | null>(null);

  const rotate = trpc.admin.rotateJwksKey.useMutation({
    onSuccess: (data) => {
      setResult(data);
      if (data.secretPersisted) {
        toast.success("Key rotated and persisted. Re-deploy to activate.");
      } else {
        toast.warning("Key generated but not auto-persisted. Update JWKS_PRIVATE_KEY manually.");
      }
      utils.admin.backfillStatus.invalidate();
    },
    onError: (e) => toast.error(`Rotation failed: ${e.message}`),
  });

  return (
    <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <KeyRound className="w-5 h-5 text-slate-600 mt-0.5 flex-shrink-0" />
        <div>
          <h2 className="font-semibold text-slate-900">JWKS Key Rotation</h2>
          <p className="text-sm text-slate-500 mt-1">
            Generates a new RSA-2048 key pair, stores the private key as{" "}
            <code className="text-slate-700 bg-slate-100 px-1 rounded">JWKS_PRIVATE_KEY</code>, and
            appends the old <code className="text-slate-700 bg-slate-100 px-1 rounded">kid</code> to the
            wiki audit log. Re-deploy is required to activate the new key. Existing bearer tokens remain
            valid until their <code className="text-slate-700 bg-slate-100 px-1 rounded">exp</code> claim.
          </p>
        </div>
      </div>

      {result ? (
        <div className="space-y-3">
          <div
            className={`rounded-lg border p-4 text-sm space-y-2 ${
              result.secretPersisted
                ? "bg-emerald-50 border-emerald-200"
                : "bg-amber-50 border-amber-200"
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              {result.secretPersisted ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-amber-600" />
              )}
              <span className={result.secretPersisted ? "text-emerald-800" : "text-amber-800"}>
                {result.message}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="bg-white rounded border border-slate-200 p-2">
                <p className="text-xs text-slate-500 mb-1">Old kid (retired)</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-slate-600 flex-1 truncate">{result.oldKid}</code>
                  <CopyButton value={result.oldKid} label="old kid" />
                </div>
              </div>
              <div className="bg-white rounded border border-slate-200 p-2">
                <p className="text-xs text-slate-500 mb-1">New kid (pending deploy)</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-emerald-700 flex-1 truncate">{result.newKid}</code>
                  <CopyButton value={result.newKid} label="new kid" />
                </div>
              </div>
            </div>
            {!result.secretPersisted && (
              <p className="text-xs text-amber-700 pt-1">
                Go to <strong>Settings → Secrets</strong> and update{" "}
                <code className="bg-amber-100 px-1 rounded">JWKS_PRIVATE_KEY</code> with the new private key PEM,
                then re-deploy.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResult(null)}
            className="text-slate-500 border-slate-300"
          >
            Dismiss
          </Button>
        </div>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="gap-2 border-slate-300 text-slate-700 hover:border-red-300 hover:text-red-700 hover:bg-red-50"
              disabled={rotate.isPending}
            >
              <RotateCcw className="w-4 h-4" />
              {rotate.isPending ? "Rotating…" : "Rotate JWKS Key"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-500" />
                Rotate JWKS Key?
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">
                  This will generate a new RSA-2048 key pair and retire the current key. The new key
                  will be stored as <code>JWKS_PRIVATE_KEY</code> and activated on the next deploy.
                </span>
                <span className="block">
                  All existing bearer tokens signed with the old key remain valid until their expiry.
                  The rotation event will be recorded in the wiki audit log.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => rotate.mutate()}
                className="bg-amber-600 hover:bg-amber-500 text-white"
              >
                Rotate Key
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

// ─── Main Admin Content ───────────────────────────────────────────────────────

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
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Admin</h1>

      {/* Wiki Backfill */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
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

      {/* Backfill Status */}
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

      {/* JWKS Key Rotation */}
      <KeyRotationCard />

      {/* JWKS Info */}
      <div className="bg-slate-50 rounded-xl border border-border p-5">
        <h2 className="font-semibold text-slate-700 mb-3 text-sm uppercase tracking-wide flex items-center gap-2">
          <KeyRound className="w-4 h-4" />
          Active JWKS Public Key
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Served at{" "}
          <a
            href="/.well-known/jwks.json"
            target="_blank"
            rel="noreferrer"
            className="text-violet-600 hover:underline"
          >
            /.well-known/jwks.json
          </a>
          . Used to verify RS256 bearer tokens and magic link JWTs offline.
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            RS256
          </Badge>
          <span className="text-xs text-slate-500">
            Rotate above to generate a new key pair. Re-deploy to activate.
          </span>
        </div>
      </div>
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
