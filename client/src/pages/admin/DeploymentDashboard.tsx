import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Rocket,
  Server,
  Globe,
  Package,
  RefreshCw,
  Download,
  Copy,
  CheckCircle,
  Clock,
  XCircle,
  Loader2,
} from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TARGET_ICONS: Record<string, React.ReactNode> = {
  vercel: <Globe className="h-4 w-4" />,
  netlify: <Globe className="h-4 w-4" />,
  docker: <Package className="h-4 w-4" />,
  ipfs: <Server className="h-4 w-4" />,
};

const STATUS_BADGE: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  pending: { label: "Pending", variant: "secondary" },
  building: { label: "Building", variant: "outline" },
  deployed: { label: "Deployed", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
};

function StatusIcon({ status }: { status: string }) {
  if (status === "deployed")
    return <CheckCircle className="h-4 w-4 text-green-500" />;
  if (status === "building")
    return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

export default function DeploymentDashboard() {
  const [newDeploy, setNewDeploy] = useState({
    verticalKey: "structural_biology",
    displayName: "",
    deployTarget: "docker" as "vercel" | "netlify" | "docker" | "ipfs",
    domain: "",
    apiBase: "",
  });
  const [dockerOpts, setDockerOpts] = useState({
    includeLocalDb: true,
    includeNginx: false,
    includeSaml: false,
  });
  const [generatedCompose, setGeneratedCompose] = useState<string | null>(null);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const deploymentsQ = trpc.deployment.list.useQuery();
  const deployMut = trpc.deployment.deploy.useMutation({
    onSuccess: data => {
      toast.success(`Deployment #${data.deploymentId} started`);
      deploymentsQ.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const dockerMut = trpc.deployment.generateDockerCompose.useMutation({
    onSuccess: data => setGeneratedCompose(data.composeYml),
    onError: e => toast.error(e.message),
  });
  const htmlMut = trpc.deployment.generateSiteHtml.useMutation({
    onSuccess: data => setGeneratedHtml(data.html),
    onError: e => toast.error(e.message),
  });

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Rocket className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Deployment Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Deploy Micron sites and generate private deployment configs
          </p>
        </div>
      </div>

      <Tabs defaultValue="deployments">
        <TabsList>
          <TabsTrigger value="deployments">Micron Deployments</TabsTrigger>
          <TabsTrigger value="new">New Deployment</TabsTrigger>
          <TabsTrigger value="private">Private / Docker</TabsTrigger>
          <TabsTrigger value="site-html">Site HTML</TabsTrigger>
        </TabsList>

        {/* ── Deployments list ─────────────────────────────────────────────── */}
        <TabsContent value="deployments" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {deploymentsQ.data?.length ?? 0} deployments
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => deploymentsQ.refetch()}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
          {deploymentsQ.isLoading && (
            <p className="text-muted-foreground text-sm">Loading…</p>
          )}
          {deploymentsQ.data?.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No deployments yet. Create one in the "New Deployment" tab.
              </CardContent>
            </Card>
          )}
          <div className="grid gap-4">
            {deploymentsQ.data?.map(d => {
              const sb = STATUS_BADGE[d.status] ?? STATUS_BADGE.pending;
              return (
                <Card key={d.id}>
                  <CardContent className="py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <StatusIcon status={d.status} />
                      <div>
                        <p className="font-medium">{d.displayName}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.verticalKey} · {d.deployTarget}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={sb.variant}>{sb.label}</Badge>
                      {d.siteUrl && (
                        <a
                          href={d.siteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="outline" size="sm">
                            <Globe className="h-4 w-4 mr-1" />
                            Visit
                          </Button>
                        </a>
                      )}
                      {d.errorMessage && (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                            >
                              Error
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Deployment Error</DialogTitle>
                            </DialogHeader>
                            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-60">
                              {d.errorMessage}
                            </pre>
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ── New deployment ───────────────────────────────────────────────── */}
        <TabsContent value="new">
          <Card>
            <CardHeader>
              <CardTitle>Deploy a Micron Site</CardTitle>
              <CardDescription>
                Spin up a standalone Truth Desk site for a specific vertical
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vertical Key</Label>
                  <Input
                    value={newDeploy.verticalKey}
                    onChange={e =>
                      setNewDeploy(p => ({ ...p, verticalKey: e.target.value }))
                    }
                    placeholder="structural_biology"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input
                    value={newDeploy.displayName}
                    onChange={e =>
                      setNewDeploy(p => ({ ...p, displayName: e.target.value }))
                    }
                    placeholder="Structural Biology Desk"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Deploy Target</Label>
                  <Select
                    value={newDeploy.deployTarget}
                    onValueChange={v =>
                      setNewDeploy(p => ({
                        ...p,
                        deployTarget: v as typeof p.deployTarget,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vercel">Vercel</SelectItem>
                      <SelectItem value="netlify">Netlify</SelectItem>
                      <SelectItem value="docker">Docker</SelectItem>
                      <SelectItem value="ipfs">IPFS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Custom Domain (optional)</Label>
                  <Input
                    value={newDeploy.domain}
                    onChange={e =>
                      setNewDeploy(p => ({ ...p, domain: e.target.value }))
                    }
                    placeholder="mydesk.example.com"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>API Base URL (optional)</Label>
                  <Input
                    value={newDeploy.apiBase}
                    onChange={e =>
                      setNewDeploy(p => ({ ...p, apiBase: e.target.value }))
                    }
                    placeholder="https://protein-desk-5r5rzpyg.manus.space"
                  />
                </div>
              </div>
              <Button
                onClick={() =>
                  deployMut.mutate({
                    verticalKey: newDeploy.verticalKey,
                    displayName: newDeploy.displayName || newDeploy.verticalKey,
                    deployTarget: newDeploy.deployTarget,
                    domain: newDeploy.domain || undefined,
                    apiBase: newDeploy.apiBase || undefined,
                  })
                }
                disabled={deployMut.isPending}
              >
                {deployMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4 mr-2" />
                )}
                Deploy
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Private / Docker ─────────────────────────────────────────────── */}
        <TabsContent value="private" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Generate Docker Compose</CardTitle>
              <CardDescription>
                Self-hosted / on-premises deployment configuration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vertical Key</Label>
                  <Input
                    value={newDeploy.verticalKey}
                    onChange={e =>
                      setNewDeploy(p => ({ ...p, verticalKey: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Domain</Label>
                  <Input
                    value={newDeploy.domain}
                    onChange={e =>
                      setNewDeploy(p => ({ ...p, domain: e.target.value }))
                    }
                    placeholder="truthdesk.internal.corp.com"
                  />
                </div>
              </div>
              <div className="flex gap-6">
                {[
                  { key: "includeLocalDb", label: "Include MySQL" },
                  { key: "includeNginx", label: "Include Nginx" },
                  { key: "includeSaml", label: "Include Keycloak (SAML)" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Switch
                      checked={dockerOpts[key as keyof typeof dockerOpts]}
                      onCheckedChange={v =>
                        setDockerOpts(p => ({ ...p, [key]: v }))
                      }
                    />
                    <Label>{label}</Label>
                  </div>
                ))}
              </div>
              <Button
                onClick={() =>
                  dockerMut.mutate({
                    verticalKey: newDeploy.verticalKey,
                    domain: newDeploy.domain || undefined,
                    ...dockerOpts,
                  })
                }
                disabled={dockerMut.isPending}
              >
                {dockerMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Package className="h-4 w-4 mr-2" />
                )}
                Generate
              </Button>
              {generatedCompose && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopy(generatedCompose, "compose")}
                    >
                      {copied === "compose" ? (
                        <CheckCircle className="h-4 w-4 mr-1 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4 mr-1" />
                      )}
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleDownload(generatedCompose, "docker-compose.yml")
                      }
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  </div>
                  <Textarea
                    readOnly
                    value={generatedCompose}
                    className="font-mono text-xs h-80"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Site HTML ────────────────────────────────────────────────────── */}
        <TabsContent value="site-html">
          <Card>
            <CardHeader>
              <CardTitle>Generate Standalone Site HTML</CardTitle>
              <CardDescription>
                Single-file HTML site for a Micron vertical — host anywhere
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vertical Key</Label>
                  <Input
                    value={newDeploy.verticalKey}
                    onChange={e =>
                      setNewDeploy(p => ({ ...p, verticalKey: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input
                    value={newDeploy.displayName}
                    onChange={e =>
                      setNewDeploy(p => ({ ...p, displayName: e.target.value }))
                    }
                    placeholder="Structural Biology Desk"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Domain (optional)</Label>
                  <Input
                    value={newDeploy.domain}
                    onChange={e =>
                      setNewDeploy(p => ({ ...p, domain: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>API Base URL</Label>
                  <Input
                    value={newDeploy.apiBase}
                    onChange={e =>
                      setNewDeploy(p => ({ ...p, apiBase: e.target.value }))
                    }
                    placeholder="https://protein-desk-5r5rzpyg.manus.space"
                  />
                </div>
              </div>
              <Button
                onClick={() =>
                  htmlMut.mutate({
                    verticalKey: newDeploy.verticalKey,
                    displayName: newDeploy.displayName || newDeploy.verticalKey,
                    domain: newDeploy.domain || undefined,
                    apiBase: newDeploy.apiBase || undefined,
                  })
                }
                disabled={htmlMut.isPending}
              >
                {htmlMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4 mr-2" />
                )}
                Generate HTML
              </Button>
              {generatedHtml && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopy(generatedHtml, "html")}
                    >
                      {copied === "html" ? (
                        <CheckCircle className="h-4 w-4 mr-1 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4 mr-1" />
                      )}
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleDownload(
                          generatedHtml,
                          `${newDeploy.verticalKey}-site.html`
                        )
                      }
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  </div>
                  <Textarea
                    readOnly
                    value={generatedHtml}
                    className="font-mono text-xs h-80"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
