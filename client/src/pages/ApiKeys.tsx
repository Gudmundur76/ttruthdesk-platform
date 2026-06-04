/**
 * ApiKeys.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * API Key management page at /settings/api-keys.
 *
 * Features:
 *   - List all active API keys with prefix, scopes, last used, created dates
 *   - Create a new key (label + scope selection) — raw key shown ONCE
 *   - Revoke a key with confirmation dialog
 */

import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Key, Plus, Trash2, Copy, Eye, EyeOff, ShieldCheck, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Scope = "read" | "write" | "admin";

const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  read: "Read-only access to claims, reports, and registry",
  write: "Submit documents and trigger analysis pipelines",
  admin: "Full access including user management and bulk operations",
};

const SCOPE_COLORS: Record<Scope, string> = {
  read: "bg-blue-500/10 text-blue-400 border-blue-400/30",
  write: "bg-yellow-500/10 text-yellow-400 border-yellow-400/30",
  admin: "bg-red-500/10 text-red-400 border-red-400/30",
};

// ─── Create Key Dialog ────────────────────────────────────────────────────────

function CreateKeyDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<Set<Scope>>(new Set<Scope>(["read"]));
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (result) => {
      setNewKey(result.rawKey);
      setRevealed(false);
      onCreated();
    },
    onError: (err) => {
      toast.error(`Failed to create key: ${err.message}`);
    },
  });

  const handleCreate = () => {
    if (!label.trim()) {
      toast.error("Please enter a label for the key");
      return;
    }
    if (scopes.size === 0) {
      toast.error("Please select at least one scope");
      return;
    }
    createMutation.mutate({ label: label.trim(), scopes: Array.from(scopes) });
  };

  const handleClose = () => {
    setOpen(false);
    setLabel("");
    setScopes(new Set<Scope>(["read"]));
    setNewKey(null);
    setRevealed(false);
  };

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey).then(() => toast.success("API key copied!"));
    }
  };

  const toggleScope = (scope: Scope) => {
    setScopes((prev) => {
      const next = new Set<Scope>(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-violet-600 hover:bg-violet-500">
          <Plus className="w-4 h-4" />
          New API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        {!newKey ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="w-5 h-5 text-violet-400" />
                Create API Key
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                The raw key will be shown once. Store it securely.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-slate-300">Label</Label>
                <Input
                  placeholder="e.g. CI/CD pipeline, laxey.is integration"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
                  maxLength={128}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Scopes</Label>
                <div className="space-y-2">
                  {(["read", "write", "admin"] as Scope[]).map((scope) => (
                    <div key={scope} className="flex items-start gap-3">
                      <Checkbox
                        id={`scope-${scope}`}
                        checked={scopes.has(scope)}
                        onCheckedChange={() => toggleScope(scope)}
                        className="mt-0.5 border-slate-600 data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600"
                      />
                      <div>
                        <Label
                          htmlFor={`scope-${scope}`}
                          className="text-sm font-medium text-white capitalize cursor-pointer"
                        >
                          {scope}
                        </Label>
                        <p className="text-xs text-slate-500">{SCOPE_DESCRIPTIONS[scope]}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={handleClose} className="text-slate-400">
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="bg-violet-600 hover:bg-violet-500"
              >
                {createMutation.isPending ? "Creating…" : "Create Key"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
                Key Created Successfully
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Copy your API key now. It will not be shown again.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="rounded-lg bg-slate-800 border border-slate-600 p-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono text-emerald-400 break-all">
                    {revealed ? newKey : `${newKey.slice(0, 8)}${"•".repeat(56)}`}
                  </code>
                  <button
                    onClick={() => setRevealed((v) => !v)}
                    className="text-slate-400 hover:text-white transition-colors flex-shrink-0"
                    title={revealed ? "Hide key" : "Reveal key"}
                  >
                    {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>Store this key securely. You will not be able to view it again after closing this dialog.</span>
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={copyKey}
                variant="outline"
                className="gap-2 border-slate-600 text-slate-300 hover:text-white"
              >
                <Copy className="w-4 h-4" />
                Copy Key
              </Button>
              <Button onClick={handleClose} className="bg-violet-600 hover:bg-violet-500">
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ApiKeys() {
  const utils = trpc.useUtils();
  const { data: keys, isLoading } = trpc.apiKeys.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => {
      toast.success("API key revoked");
      utils.apiKeys.list.invalidate();
    },
    onError: (err) => {
      toast.error(`Failed to revoke key: ${err.message}`);
    },
  });

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Key className="w-6 h-6 text-violet-400" />
              API Keys
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Manage programmatic access to the Truth Desk API.
            </p>
          </div>
          <CreateKeyDialog onCreated={() => utils.apiKeys.list.invalidate()} />
        </div>

        <Separator className="bg-slate-800" />

        {/* Usage note */}
        <Card className="bg-slate-900/60 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">Using API Keys</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-400 space-y-1">
            <p>Pass your key in the <code className="text-violet-400">Authorization</code> header:</p>
            <pre className="bg-slate-950 rounded p-2 text-slate-300 overflow-x-auto">
              {`Authorization: Bearer <your-api-key>`}
            </pre>
            <p className="pt-1">
              Base URL: <code className="text-violet-400">/api/v2/</code> — see{" "}
              <a href="/llms.txt" className="text-violet-400 hover:underline" target="_blank">
                /llms.txt
              </a>{" "}
              for available endpoints.
            </p>
          </CardContent>
        </Card>

        {/* Key list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full bg-slate-800 rounded-lg" />
            ))}
          </div>
        ) : !keys || keys.length === 0 ? (
          <Card className="bg-slate-900/40 border-slate-700 border-dashed">
            <CardContent className="py-12 text-center">
              <Key className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No API keys yet.</p>
              <p className="text-slate-500 text-xs mt-1">
                Create your first key to start using the API programmatically.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <Card key={key.id} className="bg-slate-900/60 border-slate-700">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-white truncate">{key.label}</span>
                        <code className="text-xs font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                          {key.keyPrefix}••••••••
                        </code>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {key.scopes.map((scope) => (
                          <Badge
                            key={scope}
                            variant="outline"
                            className={`text-xs capitalize ${SCOPE_COLORS[scope as Scope] ?? ""}`}
                          >
                            {scope}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-4 text-xs text-slate-500 pt-0.5">
                        <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                        {key.lastUsedAt && (
                          <span>Last used {new Date(key.lastUsedAt).toLocaleDateString()}</span>
                        )}
                        {key.expiresAt && (
                          <span className={new Date(key.expiresAt) < new Date() ? "text-red-400" : ""}>
                            Expires {new Date(key.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-slate-500 hover:text-red-400 hover:bg-red-400/10 flex-shrink-0"
                          title="Revoke key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-slate-900 border-slate-700 text-white">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
                          <AlertDialogDescription className="text-slate-400">
                            Revoking <strong className="text-white">{key.label}</strong> will immediately
                            invalidate all requests using this key. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-slate-600 text-slate-300 hover:text-white bg-transparent">
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => revokeMutation.mutate({ keyId: key.id })}
                            className="bg-red-600 hover:bg-red-500 text-white"
                          >
                            Revoke Key
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
