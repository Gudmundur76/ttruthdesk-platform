import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Layers,
  Plus,
  RefreshCw,
  Edit2,
  Loader2,
  CheckCircle,
} from "lucide-react";

export default function VerticalManagement() {
  const [newVertical, setNewVertical] = useState({
    domainKey: "",
    displayName: "",
    description: "",
    qualityTier: "draft" as "draft" | "verified",
    enabled: true,
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  const verticalsQ = trpc.verticals.list.useQuery();
  const createMut = trpc.verticals.create.useMutation({
    onSuccess: () => {
      toast.success("Vertical created");
      setDialogOpen(false);
      setNewVertical({
        domainKey: "",
        displayName: "",
        description: "",
        qualityTier: "draft",
        enabled: true,
      });
      verticalsQ.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const toggleMut = trpc.verticals.toggle.useMutation({
    onSuccess: () => verticalsQ.refetch(),
    onError: e => toast.error(e.message),
  });

  const TIER_COLORS: Record<string, string> = {
    draft:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    verified:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Vertical Management</h1>
            <p className="text-muted-foreground text-sm">
              Manage research verticals and their quality tiers
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => verticalsQ.refetch()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                New Vertical
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Vertical</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Domain Key</Label>
                    <Input
                      value={newVertical.domainKey}
                      onChange={e =>
                        setNewVertical(p => ({
                          ...p,
                          domainKey: e.target.value
                            .toLowerCase()
                            .replace(/\s+/g, "_"),
                        }))
                      }
                      placeholder="structural_biology"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Name</Label>
                    <Input
                      value={newVertical.displayName}
                      onChange={e =>
                        setNewVertical(p => ({
                          ...p,
                          displayName: e.target.value,
                        }))
                      }
                      placeholder="Structural Biology"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={newVertical.description}
                    onChange={e =>
                      setNewVertical(p => ({
                        ...p,
                        description: e.target.value,
                      }))
                    }
                    placeholder="Research vertical covering protein structure determination…"
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Quality Tier</Label>
                    <Select
                      value={newVertical.qualityTier}
                      onValueChange={v =>
                        setNewVertical(p => ({
                          ...p,
                          qualityTier: v as "draft" | "verified",
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft (free LLM)</SelectItem>
                        <SelectItem value="verified">
                          Verified (Kimi K2)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Enabled</Label>
                    <div className="flex items-center gap-2 pt-2">
                      <Switch
                        checked={newVertical.enabled}
                        onCheckedChange={v =>
                          setNewVertical(p => ({ ...p, enabled: v }))
                        }
                      />
                      <span className="text-sm">
                        {newVertical.enabled ? "Active" : "Disabled"}
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => createMut.mutate(newVertical)}
                  disabled={
                    createMut.isPending ||
                    !newVertical.domainKey ||
                    !newVertical.displayName
                  }
                >
                  {createMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Create Vertical
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Verticals", value: verticalsQ.data?.length ?? 0 },
          {
            label: "Active",
            value: verticalsQ.data?.filter(v => v.enabled).length ?? 0,
          },
          {
            label: "Verified Tier",
            value:
              verticalsQ.data?.filter(v => v.qualityTier === "verified")
                .length ?? 0,
          },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="py-4 text-center">
              <p className="text-3xl font-bold">{value}</p>
              <p className="text-sm text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Verticals list ─────────────────────────────────────────────────── */}
      {verticalsQ.isLoading && (
        <p className="text-muted-foreground text-sm">Loading…</p>
      )}
      {verticalsQ.data?.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No verticals configured. Create one to get started.
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4">
        {verticalsQ.data?.map(v => (
          <Card key={v.id} className={v.enabled ? "" : "opacity-60"}>
            <CardContent className="py-4 flex items-start justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{v.displayName}</p>
                  <Badge variant="outline" className="font-mono text-xs">
                    {v.domainKey}
                  </Badge>
                </div>
                {v.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {v.description}
                  </p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_COLORS[v.qualityTier] ?? ""}`}
                  >
                    {v.qualityTier === "verified" ? "✓ Verified" : "Draft"}
                  </span>
                  {v.enabled && (
                    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle className="h-3 w-3" />
                      Active
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Switch
                  checked={v.enabled}
                  onCheckedChange={enabled =>
                    toggleMut.mutate({ id: v.id, enabled })
                  }
                  disabled={toggleMut.isPending}
                />
                <Button variant="ghost" size="sm">
                  <Edit2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
