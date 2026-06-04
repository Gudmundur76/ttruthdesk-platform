import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Bell,
  BellOff,
  Plus,
  Trash2,
  Zap,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  History,
} from "lucide-react";

// ─── Vertical display names ───────────────────────────────────────────────────
const VERTICAL_LABELS: Record<string, string> = {
  structural_biology: "Structural Biology",
  protein_supplement: "Protein Supplements",
  creatine_ergogenics: "Creatine & Ergogenics",
  gut_microbiome: "Gut Microbiome & Protein",
  collagen_peptides: "Collagen & Peptides",
  plant_based_protein: "Plant-Based Protein",
  sports_nutrition_rct: "Sports Nutrition RCTs",
};

const FREQUENCY_ICONS: Record<string, React.ReactNode> = {
  instant: <Zap className="h-3.5 w-3.5" />,
  daily: <Calendar className="h-3.5 w-3.5" />,
  weekly: <Clock className="h-3.5 w-3.5" />,
};

const FREQUENCY_LABELS: Record<string, string> = {
  instant: "Instant",
  daily: "Daily digest",
  weekly: "Weekly digest",
};

// ─── Add subscription form ────────────────────────────────────────────────────
function AddSubscriptionCard({ onAdded }: { onAdded: () => void }) {
  const [verticalDomain, setVerticalDomain] = useState("");
  const [frequency, setFrequency] = useState<"instant" | "daily" | "weekly">("daily");
  const [minConfidence, setMinConfidence] = useState(0.7);
  const [notifySupported, setNotifySupported] = useState(true);
  const [notifyContradictions, setNotifyContradictions] = useState(true);

  const upsert = trpc.verticalAlerts.upsert.useMutation({
    onSuccess: (data) => {
      toast.success(data.action === "created" ? "Subscription added" : "Subscription updated");
      onAdded();
      setVerticalDomain("");
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!verticalDomain) return;
    upsert.mutate({ verticalDomain, frequency, minConfidence, notifySupported, notifyContradictions });
  }

  return (
    <Card className="border-dashed border-2 border-muted">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          Add Vertical Subscription
        </CardTitle>
        <CardDescription>
          Get notified when new evidence is published in a research vertical.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Research Vertical</Label>
            <Select value={verticalDomain} onValueChange={setVerticalDomain}>
              <SelectTrigger>
                <SelectValue placeholder="Select a vertical…" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VERTICAL_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Notification Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instant">Instant — notify on every new claim</SelectItem>
                <SelectItem value="daily">Daily digest — once per day</SelectItem>
                <SelectItem value="weekly">Weekly digest — once per week</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Minimum Confidence</Label>
              <span className="text-sm text-muted-foreground font-mono">
                {Math.round(minConfidence * 100)}%
              </span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[minConfidence]}
              onValueChange={([v]) => setMinConfidence(v)}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Only notify for claims scored above this confidence threshold.
            </p>
          </div>

          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="notify-supported"
                checked={notifySupported}
                onCheckedChange={setNotifySupported}
              />
              <Label htmlFor="notify-supported" className="flex items-center gap-1.5 cursor-pointer">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                Supported claims
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="notify-contradictions"
                checked={notifyContradictions}
                onCheckedChange={setNotifyContradictions}
              />
              <Label htmlFor="notify-contradictions" className="flex items-center gap-1.5 cursor-pointer">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                Contradictions
              </Label>
            </div>
          </div>

          <Button
            type="submit"
            disabled={!verticalDomain || upsert.isPending}
            className="w-full"
          >
            {upsert.isPending ? "Saving…" : "Add Subscription"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Subscription row ─────────────────────────────────────────────────────────
function SubscriptionRow({
  sub,
  onDelete,
  onToggle,
}: {
  sub: {
    id: number;
    verticalDomain: string;
    frequency: "instant" | "daily" | "weekly";
    minConfidence: number;
    notifyContradictions: boolean;
    notifySupported: boolean;
    active: boolean;
    lastSentAt: Date | null;
  };
  onDelete: (id: number) => void;
  onToggle: (id: number, active: boolean) => void;
}) {
  const label = VERTICAL_LABELS[sub.verticalDomain] ?? sub.verticalDomain;
  const lastSent = sub.lastSentAt
    ? new Date(sub.lastSentAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Never";

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{label}</span>
          <Badge variant="outline" className="text-xs flex items-center gap-1 py-0">
            {FREQUENCY_ICONS[sub.frequency]}
            {FREQUENCY_LABELS[sub.frequency]}
          </Badge>
          {!sub.active && (
            <Badge variant="secondary" className="text-xs py-0">Paused</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span>Min confidence: {Math.round(sub.minConfidence * 100)}%</span>
          {sub.notifySupported && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Supported
            </span>
          )}
          {sub.notifyContradictions && (
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-amber-500" /> Contradictions
            </span>
          )}
          <span>Last sent: {lastSent}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch
          checked={sub.active}
          onCheckedChange={(v) => onToggle(sub.id, v)}
          aria-label={sub.active ? "Pause subscription" : "Resume subscription"}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(sub.id)}
          aria-label="Delete subscription"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Notification history ─────────────────────────────────────────────────────
function NotificationHistory() {
  const { data: history = [], isLoading } = trpc.verticalAlerts.history.useQuery({ limit: 20 });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground py-4 text-center">Loading history…</div>;
  }

  if (history.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        No notifications sent yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {history.map((entry) => {
        const payload = entry.payload as { verticalDomain?: string; claimsSent?: number; contradictionsSent?: number } | null;
        const verticalLabel = payload?.verticalDomain
          ? (VERTICAL_LABELS[payload.verticalDomain] ?? payload.verticalDomain)
          : "Unknown vertical";
        return (
          <div key={entry.id} className="flex items-center justify-between text-sm py-2 border-b border-border/50 last:border-0">
            <div>
              <span className="font-medium">{verticalLabel}</span>
              {payload && (
                <span className="text-muted-foreground ml-2">
                  {payload.claimsSent ?? 0} claims, {payload.contradictionsSent ?? 0} contradictions
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant={entry.status === "sent" ? "default" : entry.status === "skipped" ? "secondary" : "destructive"}
                className="text-xs py-0"
              >
                {entry.status}
              </Badge>
              {new Date(entry.sentAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function NotificationSettings() {
  const utils = trpc.useUtils();

  const { data: subscriptions = [], isLoading } = trpc.verticalAlerts.list.useQuery();

  const deleteMutation = trpc.verticalAlerts.delete.useMutation({
    onSuccess: () => {
      toast.success("Subscription removed");
      utils.verticalAlerts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const upsertMutation = trpc.verticalAlerts.upsert.useMutation({
    onSuccess: () => utils.verticalAlerts.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  function handleToggle(id: number, active: boolean) {
    const sub = subscriptions.find((s) => s.id === id);
    if (!sub) return;
    upsertMutation.mutate({
      verticalDomain: sub.verticalDomain,
      frequency: sub.frequency,
      minConfidence: sub.minConfidence,
      notifyContradictions: sub.notifyContradictions,
      notifySupported: sub.notifySupported,
      active,
    });
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6 py-6 px-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" />
            Notification Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Subscribe to research verticals and receive digests when new evidence is published.
          </p>
        </div>

        {/* Active subscriptions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Active Subscriptions</CardTitle>
            <CardDescription>
              {subscriptions.length === 0
                ? "No subscriptions yet — add one below."
                : `${subscriptions.filter((s) => s.active).length} active, ${subscriptions.filter((s) => !s.active).length} paused`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
            ) : subscriptions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                <BellOff className="h-8 w-8 opacity-40" />
                <p className="text-sm">No subscriptions yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {subscriptions.map((sub) => (
                  <SubscriptionRow
                    key={sub.id}
                    sub={{
                      ...sub,
                      frequency: sub.frequency as "instant" | "daily" | "weekly",
                      lastSentAt: sub.lastSentAt ? new Date(sub.lastSentAt) : null,
                    }}
                    onDelete={(id) => deleteMutation.mutate({ id })}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add new subscription */}
        <AddSubscriptionCard onAdded={() => utils.verticalAlerts.list.invalidate()} />

        <Separator />

        {/* Notification history */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" />
              Notification History
            </CardTitle>
            <CardDescription>Recent notifications sent to your account.</CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationHistory />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
