import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Code2, Copy, CheckCircle, Loader2, Eye, Monitor, Smartphone } from "lucide-react";

const VERTICALS = [
  { key: "structural_biology", label: "Structural Biology" },
  { key: "protein_supplement", label: "Protein Supplements" },
  { key: "biosimilar",         label: "Biosimilar" },
  { key: "clinical_trial",     label: "Clinical Trials" },
  { key: "genomics",           label: "Genomics" },
  { key: "nutrition",          label: "Nutrition" },
];

export default function EmbedGenerator() {
  const [config, setConfig] = useState({
    vertical: "structural_biology",
    theme: "auto" as "auto" | "light" | "dark",
    position: "bottom-right" as "bottom-right" | "bottom-left" | "top-right" | "top-left",
    apiBase: "",
  });
  const [result, setResult] = useState<{ iframeCode: string; sdkCode: string; previewUrl: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const genMut = trpc.embed.generateCode.useMutation({
    onSuccess: (data) => setResult(data),
    onError: (e) => toast.error(e.message),
  });

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Code2 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Embed Code Generator</h1>
          <p className="text-muted-foreground text-sm">Generate iFrame and floating widget SDK code for any vertical</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Config panel ─────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Widget Configuration</CardTitle>
            <CardDescription>Customise the embed for your target site</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Vertical</Label>
              <Select
                value={config.vertical}
                onValueChange={(v) => setConfig((p) => ({ ...p, vertical: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VERTICALS.map((v) => (
                    <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>
                  ))}
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {config.vertical === "custom" && (
              <div className="space-y-2">
                <Label>Custom Vertical Key</Label>
                <Input
                  placeholder="my_vertical_key"
                  onChange={(e) => setConfig((p) => ({ ...p, vertical: e.target.value }))}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Theme</Label>
                <Select
                  value={config.theme}
                  onValueChange={(v) => setConfig((p) => ({ ...p, theme: v as typeof p.theme }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (system)</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Position (SDK only)</Label>
                <Select
                  value={config.position}
                  onValueChange={(v) => setConfig((p) => ({ ...p, position: v as typeof p.position }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottom-right">Bottom Right</SelectItem>
                    <SelectItem value="bottom-left">Bottom Left</SelectItem>
                    <SelectItem value="top-right">Top Right</SelectItem>
                    <SelectItem value="top-left">Top Left</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>API Base URL (leave blank for default)</Label>
              <Input
                value={config.apiBase}
                onChange={(e) => setConfig((p) => ({ ...p, apiBase: e.target.value }))}
                placeholder="https://protein-desk-5r5rzpyg.manus.space"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => genMut.mutate(config)}
              disabled={genMut.isPending}
            >
              {genMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Code2 className="h-4 w-4 mr-2" />}
              Generate Embed Code
            </Button>
          </CardContent>
        </Card>

        {/* ── Preview panel ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />Live Preview
            </CardTitle>
            <CardDescription>How the widget will appear on your site</CardDescription>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-3">
                <div className="flex gap-2 text-sm text-muted-foreground">
                  <Monitor className="h-4 w-4" />
                  <span>iFrame embed — 400×440px</span>
                </div>
                <div className="border rounded-xl overflow-hidden bg-muted/30">
                  <iframe
                    src={result.previewUrl}
                    width="100%"
                    height="440"
                    frameBorder="0"
                    title="Truth Desk Widget Preview"
                    sandbox="allow-scripts allow-same-origin allow-popups"
                    className="block"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Smartphone className="h-3 w-3" />
                  <span>The floating SDK widget appears as a button in the corner of your page</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-60 text-muted-foreground gap-3">
                <Code2 className="h-10 w-10 opacity-30" />
                <p className="text-sm">Generate code to see a live preview</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Generated code ───────────────────────────────────────────────────── */}
      {result && (
        <Tabs defaultValue="iframe">
          <TabsList>
            <TabsTrigger value="iframe">iFrame Embed</TabsTrigger>
            <TabsTrigger value="sdk">Floating Widget SDK</TabsTrigger>
          </TabsList>

          <TabsContent value="iframe" className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="font-medium">iFrame Snippet</p>
                <p className="text-sm text-muted-foreground">Paste inside any HTML page to embed the claim verifier inline</p>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline">HTML</Badge>
                <Button size="sm" variant="outline" onClick={() => handleCopy(result.iframeCode, "iframe")}>
                  {copied === "iframe" ? <CheckCircle className="h-4 w-4 mr-1 text-green-500" /> : <Copy className="h-4 w-4 mr-1" />}
                  Copy
                </Button>
              </div>
            </div>
            <Textarea readOnly value={result.iframeCode} className="font-mono text-xs h-36 resize-none" />
            <div className="bg-muted/40 rounded-lg p-4 text-sm space-y-1">
              <p className="font-medium">Usage notes</p>
              <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                <li>The widget is fully self-contained — no additional scripts required.</li>
                <li>Resize by changing <code className="font-mono text-xs bg-muted px-1 rounded">width</code> and <code className="font-mono text-xs bg-muted px-1 rounded">height</code> attributes.</li>
                <li>The <code className="font-mono text-xs bg-muted px-1 rounded">sandbox</code> attribute is required for security.</li>
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="sdk" className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="font-medium">Floating Widget SDK</p>
                <p className="text-sm text-muted-foreground">Adds a floating button that opens the claim verifier in a drawer</p>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline">HTML + JS</Badge>
                <Button size="sm" variant="outline" onClick={() => handleCopy(result.sdkCode, "sdk")}>
                  {copied === "sdk" ? <CheckCircle className="h-4 w-4 mr-1 text-green-500" /> : <Copy className="h-4 w-4 mr-1" />}
                  Copy
                </Button>
              </div>
            </div>
            <Textarea readOnly value={result.sdkCode} className="font-mono text-xs h-36 resize-none" />
            <div className="bg-muted/40 rounded-lg p-4 text-sm space-y-1">
              <p className="font-medium">Usage notes</p>
              <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                <li>Paste before the closing <code className="font-mono text-xs bg-muted px-1 rounded">&lt;/body&gt;</code> tag.</li>
                <li>The widget position is controlled by the <code className="font-mono text-xs bg-muted px-1 rounded">position</code> config key.</li>
                <li>Theme auto-detects the host page's <code className="font-mono text-xs bg-muted px-1 rounded">prefers-color-scheme</code> when set to <code className="font-mono text-xs bg-muted px-1 rounded">auto</code>.</li>
                <li>Post <code className="font-mono text-xs bg-muted px-1 rounded">{ "{ type: 'td:open' }" }</code> to <code className="font-mono text-xs bg-muted px-1 rounded">window</code> to open programmatically.</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
