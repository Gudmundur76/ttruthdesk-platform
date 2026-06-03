import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Bell, Trash2, Copy, CheckCircle2, Plus, ExternalLink, ShieldCheck } from "lucide-react";

interface WebhookRow {
  id: number;
  url: string;
  label: string | null;
  eventTypes: unknown;
  active: boolean;
  lastFiredAt: Date | null;
  createdAt: Date;
  secret?: string; // only present right after creation
}

export default function AlertSettings() {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [newSecret, setNewSecret] = useState<{ id: number; secret: string } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: webhooks = [], isLoading } = trpc.alerts.list.useQuery();

  const createMutation = trpc.alerts.create.useMutation({
    onSuccess: (data) => {
      toast.success("Webhook registered");
      setNewSecret({ id: Date.now(), secret: data.secret });
      setUrl("");
      setLabel("");
      utils.alerts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.alerts.delete.useMutation({
    onSuccess: () => {
      toast.success("Webhook removed");
      utils.alerts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    createMutation.mutate({ url: url.trim(), label: label.trim() || undefined });
  }

  function copyToClipboard(text: string, id: number) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Alert Webhooks</h1>
            <p className="text-sm text-muted-foreground">
              Receive instant notifications when a claim is flagged as high-risk
              (contradiction probability ≥ 70%).
            </p>
          </div>
        </div>

        {/* How it works */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex gap-3">
              <ShieldCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-medium">HMAC-signed payloads</p>
                <p className="text-muted-foreground">
                  Every POST includes an <code className="font-mono text-xs bg-muted px-1 rounded">X-TruthDesk-Signature</code> header
                  with a SHA-256 HMAC of the body, signed with your secret. Verify it in your endpoint to
                  ensure authenticity.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* New secret banner */}
        {newSecret && (
          <Card className="border-green-500/40 bg-green-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Webhook registered — save your secret now
              </CardTitle>
              <CardDescription>
                This secret is shown only once. Store it securely to verify incoming webhook signatures.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-muted px-3 py-2 rounded break-all">
                  {newSecret.secret}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(newSecret.secret, newSecret.id)}
                >
                  {copiedId === newSecret.id ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 text-muted-foreground"
                onClick={() => setNewSecret(null)}
              >
                I've saved it — dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Register form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Register a new webhook</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="webhook-url">Endpoint URL</Label>
                <Input
                  id="webhook-url"
                  type="url"
                  placeholder="https://your-server.com/webhooks/truthdesk"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="webhook-label">Label (optional)</Label>
                <Input
                  id="webhook-label"
                  placeholder="e.g. Slack #alerts"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={128}
                />
              </div>
              <Button
                type="submit"
                disabled={createMutation.isPending || !url.trim()}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                {createMutation.isPending ? "Registering…" : "Register Webhook"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Existing webhooks */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Active webhooks ({webhooks.length})
          </h2>

          {isLoading && (
            <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
          )}

          {!isLoading && webhooks.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                No webhooks registered yet. Add one above to start receiving alerts.
              </CardContent>
            </Card>
          )}

          {(webhooks as WebhookRow[]).map((wh) => (
            <Card key={wh.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    {wh.label && (
                      <p className="font-medium text-sm">{wh.label}</p>
                    )}
                    <div className="flex items-center gap-1.5">
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                      <p className="text-xs text-muted-foreground font-mono truncate">{wh.url}</p>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Badge variant={wh.active ? "default" : "secondary"} className="text-xs">
                        {wh.active ? "Active" : "Inactive"}
                      </Badge>
                      {Array.isArray(wh.eventTypes) && (wh.eventTypes as string[]).map((et) => (
                        <Badge key={et} variant="outline" className="text-xs">{et}</Badge>
                      ))}
                    </div>
                    {wh.lastFiredAt && (
                      <p className="text-xs text-muted-foreground">
                        Last fired: {new Date(wh.lastFiredAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => deleteMutation.mutate({ id: wh.id })}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Separator />

        {/* Payload schema */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Payload schema</h2>
          <pre className="text-xs bg-muted rounded-lg p-4 overflow-auto">
{`{
  "event": "high_risk_claim",
  "timestamp": "2026-06-03T12:00:00.000Z",
  "data": {
    "claimId": 42,
    "claimText": "The crystal structure was solved at 1.8 Å resolution",
    "documentId": 7,
    "documentTitle": "Structural analysis of EGFR",
    "verdict": "Contradicted",
    "contradictionProbability": 0.82,
    "confidenceScore": 0.71,
    "reportUrl": "https://truthdesk.is/reports/7"
  }
}`}
          </pre>
        </div>
      </div>
    </DashboardLayout>
  );
}
