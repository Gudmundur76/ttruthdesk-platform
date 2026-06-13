import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Layers, Plus, X, CheckCircle2, AlertCircle, ChevronRight, ChevronLeft } from "lucide-react";

// ── Step types ─────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4;

const STEPS: { id: Step; label: string; description: string }[] = [
  { id: 1, label: "Identity", description: "Domain key and display name" },
  { id: 2, label: "Discovery", description: "PubMed MeSH search terms" },
  { id: 3, label: "Quality", description: "Tier and source whitelist" },
  { id: 4, label: "Review", description: "Confirm and create" },
];

// ── Tag input helper ────────────────────────────────────────────────────────────
function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!draft.trim()}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1">
              {tag}
              <button
                type="button"
                onClick={() => onChange(value.filter((t) => t !== tag))}
                className="ml-0.5 rounded-sm hover:bg-destructive/20 p-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────
  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export default function AdminVerticals() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // Form state
  const [step, setStep] = useState<Step>(1);
  const [domainKey, setDomainKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [meshTerms, setMeshTerms] = useState<string[]>([]);
  const [sourceWhitelist, setSourceWhitelist] = useState<string[]>([]);
  const [qualityTier, setQualityTier] = useState<"draft" | "verified">("draft");
  const [enabled, setEnabled] = useState(true);

  const domainKeyError = domainKey && !/^[a-z0-9_]+$/.test(domainKey)
    ? "Only lowercase letters, digits, and underscores allowed."
    : "";

  // Existing configs list
  const { data: configs, isLoading: configsLoading } = trpc.verticalConfigs.list.useQuery();

  // Toggle enable/disable
  const updateConfig = trpc.verticalConfigs.update.useMutation({
    onSuccess: () => { utils.verticalConfigs.list.invalidate(); toast.success("Updated."); },
    onError: (e) => toast.error(e.message),
  });

  // Create new
  const createConfig = trpc.verticalConfigs.create.useMutation({
    onSuccess: () => {
      utils.verticalConfigs.list.invalidate();
      toast.success(`Vertical "${displayName}" created. It will be picked up by the next PMC feed run.`);
      // Reset form
      setStep(1);
      setDomainKey(""); setDisplayName(""); setDescription("");
      setMeshTerms([]); setSourceWhitelist([]);
      setQualityTier("draft"); setEnabled(true);
    },
    onError: (e) => toast.error(e.message),
  });

  if (user?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  const canAdvance = (): boolean => {
    if (step === 1) return domainKey.length >= 2 && !domainKeyError && displayName.length >= 2;
    if (step === 2) return meshTerms.length > 0;
    return true;
  };

  return (
    <div className="space-y-8 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="w-6 h-6 text-primary" />
          Vertical Expansion Wizard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Add a new research vertical — no code changes required.
        </p>
      </div>

      {/* Existing configs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Verticals</CardTitle>
          <CardDescription>Toggle verticals on/off without deleting them.</CardDescription>
        </CardHeader>
        <CardContent>
          {configsLoading && <Skeleton className="h-20 rounded-lg" />}
          {configs && configs.length === 0 && (
            <p className="text-sm text-muted-foreground">No custom verticals yet. Create one below.</p>
          )}
          {configs && configs.length > 0 && (
            <div className="space-y-3">
              {configs.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{c.displayName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{c.domainKey}</p>
                    {c.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{c.description}</p>}
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">{c.qualityTier}</Badge>
                      <Badge variant="outline" className="text-xs">{(c.meshTerms as string[])?.length ?? 0} MeSH terms</Badge>
                    </div>
                  </div>
                  <Switch
                    checked={c.enabled}
                    onCheckedChange={(v) => updateConfig.mutate({ id: c.id, enabled: v })}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Wizard */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Create New Vertical</h2>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          {STEPS.map((s, idx) => (
            <div key={s.id} className="flex items-center gap-2 shrink-0">
              <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                step === s.id
                  ? "bg-primary text-primary-foreground"
                  : step > s.id
                  ? "bg-green-500/20 text-green-700 dark:text-green-400"
                  : "bg-muted text-muted-foreground"
              }`}>
                {step > s.id ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span>{s.id}</span>}
                {s.label}
              </div>
              {idx < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
            </div>
          ))}
        </div>

        <Card>
          <CardContent className="pt-6 space-y-5">
            {/* Step 1: Identity */}
            {step === 1 && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="domainKey">Domain Key <span className="text-destructive">*</span></Label>
                  <Input
                    id="domainKey"
                    value={domainKey}
                    onChange={(e) => setDomainKey(e.target.value.toLowerCase())}
                    placeholder="e.g. clinical_nutrition"
                    className={domainKeyError ? "border-destructive" : ""}
                  />
                  {domainKeyError && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />{domainKeyError}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Unique identifier used in the database and feed config. Cannot be changed later.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Clinical Nutrition"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of what this vertical covers…"
                    rows={3}
                  />
                </div>
              </>
            )}

            {/* Step 2: Discovery */}
            {step === 2 && (
              <div className="space-y-2">
                <Label>PubMed MeSH Search Terms <span className="text-destructive">*</span></Label>
                <p className="text-xs text-muted-foreground">
                  These terms are used by the nightly PMC feed to discover relevant papers.
                  Enter each term and press Enter or click +.
                </p>
                <TagInput
                  value={meshTerms}
                  onChange={setMeshTerms}
                  placeholder="e.g. Dietary Proteins[MeSH] or protein intake"
                />
                {meshTerms.length === 0 && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />At least one MeSH term is required.
                  </p>
                )}
              </div>
            )}

            {/* Step 3: Quality */}
            {step === 3 && (
              <>
                <div className="space-y-2">
                  <Label>Quality Tier</Label>
                  <Select value={qualityTier} onValueChange={(v) => setQualityTier(v as "draft" | "verified")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft — uses free LLM for initial extraction</SelectItem>
                      <SelectItem value="verified">Verified — uses Kimi K2 for highest accuracy</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Draft tier documents are upgraded to verified by the nightly quality-pass job.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Source Whitelist</Label>
                  <p className="text-xs text-muted-foreground">
                    Optional: restrict evidence lookups to specific source IDs. Leave empty to allow all registered sources.
                  </p>
                  <TagInput
                    value={sourceWhitelist}
                    onChange={setSourceWhitelist}
                    placeholder="e.g. pubmed, examine_com"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
                  <Label htmlFor="enabled">Enable immediately</Label>
                </div>
              </>
            )}

            {/* Step 4: Review */}
            {step === 4 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Review your new vertical before creating it.</p>
                <div className="rounded-lg border divide-y text-sm">
                  {[
                    ["Domain Key", domainKey],
                    ["Display Name", displayName],
                    ["Description", description || "—"],
                    ["MeSH Terms", meshTerms.join(", ") || "—"],
                    ["Source Whitelist", sourceWhitelist.join(", ") || "All sources"],
                    ["Quality Tier", qualityTier],
                    ["Enabled", enabled ? "Yes" : "No"],
                  ].map(([label, val]) => (
                    <div key={label} className="flex gap-4 px-4 py-2.5">
                      <span className="text-muted-foreground w-36 shrink-0">{label}</span>
                      <span className="font-medium break-all">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
                disabled={step === 1}
                className="gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" />Back
              </Button>
              {step < 4 ? (
                <Button
                  onClick={() => setStep((s) => Math.min(4, s + 1) as Step)}
                  disabled={!canAdvance()}
                  className="gap-1.5"
                >
                  Next<ChevronRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => createConfig.mutate({ domainKey, displayName, description: description || undefined, meshTerms, sourceWhitelist, qualityTier, enabled })}
                  disabled={createConfig.isPending}
                  className="gap-1.5"
                >
                  {createConfig.isPending ? "Creating…" : "Create Vertical"}
                  <CheckCircle2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
