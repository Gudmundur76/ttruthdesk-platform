import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Search, Zap, Database, RefreshCw, Play, CheckCircle, XCircle, Clock, Loader2, Eye } from "lucide-react";

const CATEGORY_COLORS: Record<string, string> = {
  structural:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  sequence:     "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  literature:   "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  clinical:     "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  biosimilar:   "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  supplement:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  ontology:     "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  expression:   "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  interaction:  "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

export default function DiscoveryPanel() {
  const [verticalKey, setVerticalKey] = useState("structural_biology");
  const [skipProbe, setSkipProbe] = useState(false);
  const [skipCodegen, setSkipCodegen] = useState(false);
  const [runId, setRunId] = useState<number | null>(null);
  const [probeSourceId, setProbeSourceId] = useState<string | null>(null);

  const builtInQ = trpc.discovery.builtInSources.useQuery({ verticalKey });
  const allSourcesQ = trpc.discovery.allSources.useQuery();

  const runMut = trpc.discovery.run.useMutation({
    onSuccess: (data) => {
      setRunId(data.runId);
      toast.success(`Discovery run #${data.runId} started`);
    },
    onError: (e) => toast.error(e.message),
  });

  const runQ = trpc.discovery.get.useQuery(
    { runId: runId! },
    { enabled: !!runId, refetchInterval: (q) => (q.state.data?.status === "running" ? 3000 : false) }
  );

  const probeMut = trpc.discovery.probe.useMutation({
    onSuccess: (data) => toast.success(`Probe: ${data.isHealthy ? "✓ Healthy" : "✗ Unhealthy"} (${data.latencyMs ?? 0}ms)`),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Search className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Auto-Discovery Engine</h1>
          <p className="text-muted-foreground text-sm">Discover, probe, and register data sources for any vertical</p>
        </div>
      </div>

      <Tabs defaultValue="sources">
        <TabsList>
          <TabsTrigger value="sources">Built-in Sources</TabsTrigger>
          <TabsTrigger value="run">Run Discovery</TabsTrigger>
          <TabsTrigger value="registry">Source Registry</TabsTrigger>
        </TabsList>

        {/* ── Built-in sources ─────────────────────────────────────────────── */}
        <TabsContent value="sources" className="space-y-4">
          <div className="flex gap-3 items-end">
            <div className="space-y-1 flex-1">
              <Label>Filter by Vertical</Label>
              <Input
                value={verticalKey}
                onChange={(e) => setVerticalKey(e.target.value)}
                placeholder="structural_biology"
              />
            </div>
            <Button variant="outline" onClick={() => builtInQ.refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />Refresh
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{builtInQ.data?.length ?? 0} sources in registry</p>
          <div className="grid gap-3">
            {builtInQ.data?.map((src) => (
              <Card key={src.sourceId}>
                <CardContent className="py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Database className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{src.displayName}</p>
                      <p className="text-xs text-muted-foreground truncate">{src.baseUrl}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[src.category] ?? "bg-muted text-muted-foreground"}`}>
                      {src.category}
                    </span>
                    <Badge variant="secondary">
                      {src.rateLimitRpm ? `${src.rateLimitRpm} rpm` : "Public"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setProbeSourceId(src.sourceId); probeMut.mutate({ sourceId: src.sourceId }); }}
                      disabled={probeMut.isPending && probeSourceId === src.sourceId}
                    >
                      {probeMut.isPending && probeSourceId === src.sourceId
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Zap className="h-3 w-3" />}
                    </Button>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="ghost"><Eye className="h-3 w-3" /></Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>{src.displayName}</DialogTitle></DialogHeader>
                        <div className="space-y-2 text-sm">
                          <p><span className="font-medium">Source ID:</span> {src.sourceId}</p>
                          <p><span className="font-medium">Base URL:</span> {src.baseUrl}</p>
                          <p><span className="font-medium">Category:</span> {src.category}</p>
                          <p><span className="font-medium">Verticals:</span> {src.verticals.join(", ")}</p>
                          <p><span className="font-medium">Schema:</span> {src.schemaDescription}</p>
                          <p><span className="font-medium">Probe Endpoint:</span> <span className="font-mono text-xs">{src.probeEndpoint}</span></p>
                          {src.rateLimitRpm && <p><span className="font-medium">Rate Limit:</span> {src.rateLimitRpm} req/min</p>}
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Run discovery ────────────────────────────────────────────────── */}
        <TabsContent value="run" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Start Discovery Run</CardTitle>
              <CardDescription>Probe all built-in sources for a vertical and generate adapter code</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Vertical Key</Label>
                <Input
                  value={verticalKey}
                  onChange={(e) => setVerticalKey(e.target.value)}
                  placeholder="structural_biology"
                />
              </div>
              <div className="flex gap-6">
                <div className="flex items-center gap-2">
                  <Switch checked={skipProbe} onCheckedChange={setSkipProbe} />
                  <Label>Skip Probe</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={skipCodegen} onCheckedChange={setSkipCodegen} />
                  <Label>Skip Codegen</Label>
                </div>
              </div>
              <Button
                onClick={() => runMut.mutate({ verticalKey, skipProbe, skipCodegen })}
                disabled={runMut.isPending}
              >
                {runMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Run Discovery
              </Button>
            </CardContent>
          </Card>

          {runId && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Run #{runId}
                  {runQ.data?.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                  {runQ.data?.status === "complete" && <CheckCircle className="h-4 w-4 text-green-500" />}
                  {runQ.data?.status === "failed" && <XCircle className="h-4 w-4 text-red-500" />}
                  {!runQ.data && <Clock className="h-4 w-4 text-muted-foreground" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {runQ.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
                {runQ.data && (
                  <>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Status</p>
                        <p className="font-medium capitalize">{runQ.data.status}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Sources Matched</p>
                        <p className="font-medium">{runQ.data.sourcesMatched}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Sources Probed</p>
                        <p className="font-medium">{runQ.data.sourcesProbed}</p>
                      </div>
                    </div>
                    {runQ.data.adapterFiles && runQ.data.adapterFiles.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Generated Adapter Files</p>
                        <div className="space-y-1">
                          {runQ.data.adapterFiles.map((f, i) => (
                            <Badge key={i} variant="outline" className="font-mono text-xs mr-1">{f}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {runQ.data.errorMessage && (
                      <div>
                        <p className="text-sm font-medium text-destructive mb-1">Error</p>
                        <Textarea readOnly value={runQ.data.errorMessage} className="font-mono text-xs h-32" />
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Registry ─────────────────────────────────────────────────────── */}
        <TabsContent value="registry" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{allSourcesQ.data?.length ?? 0} registered sources</p>
            <Button variant="outline" size="sm" onClick={() => allSourcesQ.refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />Refresh
            </Button>
          </div>
          {allSourcesQ.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
          {allSourcesQ.data?.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No sources registered yet. Run a discovery to populate the registry.
              </CardContent>
            </Card>
          )}
          <div className="grid gap-3">
            {allSourcesQ.data?.map((s) => (
              <Card key={s.id}>
                <CardContent className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{s.sourceId}</p>
                    <p className="text-xs text-muted-foreground">{s.verticals?.join(", ")} · {s.category}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.approvalStatus === "approved" ? "default" : s.approvalStatus === "rejected" ? "destructive" : "secondary"}>
                      {s.approvalStatus}
                    </Badge>
                    <Badge variant={s.isHealthy ? "outline" : "destructive"}>
                      {s.isHealthy ? "Healthy" : "Unhealthy"}
                    </Badge>
                    {s.lastHealthStatus != null && (
                      <span className="text-xs text-muted-foreground">HTTP {s.lastHealthStatus}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
