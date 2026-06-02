/**
 * PublicReport.tsx
 *
 * Public-facing audit report page at /reports/:id
 * - No authentication required
 * - Renders full JSON-LD structured data (schema.org ScholarlyArticle + Claim)
 *   so AI search engines (ChatGPT, Perplexity, Google AI) can discover and cite
 * - Links to the machine-readable claims.json endpoint
 */

import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, FileJson, ArrowLeft, AlertTriangle, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { TopNav } from "@/components/TopNav";

const DOMAIN = window.location.origin;

// ── Types ────────────────────────────────────────────────────────────────────

interface ClaimRecord {
  "@id": string;
  claimText: string;
  claimType: string;
  verdict: string | null;
  verdictRationale: string | null;
  pdbId: string | null;
  pdbEvidenceUrl: string | null;
  verifiedAt: string | null;
}

interface ClaimsJsonResponse {
  "@context": string;
  "@type": string;
  "@id": string;
  name: string;
  description: string;
  dateCreated: string;
  claims: ClaimRecord[];
  verdictSummary: Record<string, number>;
  totalClaims: number;
  highRiskCount: number;
}

// ── Verdict helpers ──────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  Supported: {
    label: "Supported",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  Contradicted: {
    label: "Contradicted",
    color: "bg-red-100 text-red-800 border-red-200",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  "Partially Supported": {
    label: "Partial",
    color: "bg-amber-100 text-amber-800 border-amber-200",
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
  Ambiguous: {
    label: "Ambiguous",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    icon: <HelpCircle className="w-3.5 h-3.5" />,
  },
  "Insufficient Evidence": {
    label: "Insufficient Evidence",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    icon: <HelpCircle className="w-3.5 h-3.5" />,
  },
  "Out of Scope": {
    label: "Out of Scope",
    color: "bg-slate-100 text-slate-600 border-slate-200",
    icon: <HelpCircle className="w-3.5 h-3.5" />,
  },
  "Needs Expert Review": {
    label: "Expert Review",
    color: "bg-purple-100 text-purple-800 border-purple-200",
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
  },
};

function VerdictBadge({ verdict }: { verdict: string | null }) {
  const cfg = verdict ? VERDICT_CONFIG[verdict] : null;
  if (!cfg) return <Badge variant="outline" className="text-xs">Pending</Badge>;
  return (
    <Badge
      variant="outline"
      className={`text-xs flex items-center gap-1 ${cfg.color}`}
    >
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

// ── JSON-LD injection ─────────────────────────────────────────────────────────

function injectJsonLd(data: ClaimsJsonResponse, docId: string) {
  // Remove any existing PTD JSON-LD
  const existing = document.getElementById("ptd-jsonld");
  if (existing) existing.remove();

  const claimObjects = data.claims
    .filter((c) => c.verdict)
    .map((c) => ({
      "@type": "Claim",
      "@id": `${DOMAIN}/reports/${docId}#${c["@id"]}`,
      text: c.claimText,
      description: c.verdictRationale ?? undefined,
      appearance: c.pdbEvidenceUrl
        ? { "@type": "CreativeWork", url: c.pdbEvidenceUrl }
        : undefined,
    }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ScholarlyArticle",
        "@id": `${DOMAIN}/reports/${docId}`,
        name: data.name,
        description: data.description,
        datePublished: data.dateCreated,
        url: `${DOMAIN}/reports/${docId}`,
        publisher: {
          "@type": "Organization",
          name: "Protein Truth Desk",
          url: DOMAIN,
        },
        about: claimObjects,
        isBasedOn: {
          "@type": "Dataset",
          name: "RCSB Protein Data Bank",
          url: "https://www.rcsb.org",
        },
      },
      {
        "@type": "Dataset",
        "@id": `${DOMAIN}/api/public/documents/${docId}/claims.json`,
        name: `Verified Claims Registry — ${data.name}`,
        description: `Machine-readable claims registry for: ${data.name}. ${data.totalClaims} claims verified against the RCSB Protein Data Bank.`,
        url: `${DOMAIN}/api/public/documents/${docId}/claims.json`,
        license: "https://creativecommons.org/licenses/by/4.0/",
        creator: {
          "@type": "Organization",
          name: "Protein Truth Desk",
          url: DOMAIN,
        },
      },
    ],
  };

  const script = document.createElement("script");
  script.id = "ptd-jsonld";
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(jsonLd, null, 2);
  document.head.appendChild(script);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PublicReport() {
  const params = useParams<{ id: string }>();
  const docId = params.id;

  const [data, setData] = useState<ClaimsJsonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const claimsJsonUrl = `${DOMAIN}/api/public/documents/${docId}/claims.json`;

  useEffect(() => {
    if (!docId) return;
    setLoading(true);
    fetch(claimsJsonUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ClaimsJsonResponse>;
      })
      .then((d) => {
        setData(d);
        injectJsonLd(d, docId);
        // Update page title for SEO
        document.title = `${d.name} — Protein Truth Desk`;
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

    return () => {
      const el = document.getElementById("ptd-jsonld");
      if (el) el.remove();
      document.title = "Protein Truth Desk";
    };
  }, [docId, claimsJsonUrl]);

  const handleCopy = () => {
    navigator.clipboard.writeText(claimsJsonUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Back link */}
        <Link href="/registry" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Registry
        </Link>

        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {error && (
          <Card className="border-destructive/30">
            <CardContent className="pt-6">
              <p className="text-destructive text-sm">
                Report not found or not yet publicly available. The audit may still be in progress.
              </p>
              <p className="text-xs text-muted-foreground mt-1">Error: {error}</p>
            </CardContent>
          </Card>
        )}

        {data && !loading && (
          <>
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl font-bold leading-tight mb-2">{data.name}</h1>
                  <p className="text-muted-foreground text-sm">{data.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Audited {new Date(data.dateCreated).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="text-xs gap-1.5"
                  >
                    <FileJson className="w-3.5 h-3.5" />
                    {copied ? "Copied!" : "Copy claims.json URL"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="text-xs gap-1.5"
                  >
                    <a href={claimsJsonUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" />
                      Raw JSON
                    </a>
                  </Button>
                </div>
              </div>
            </div>

            {/* Verdict summary */}
            <Card className="mb-8">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Verdict Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{data.totalClaims}</p>
                    <p className="text-xs text-muted-foreground">Total Claims</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-emerald-600">
                      {data.verdictSummary["Supported"] ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Supported</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-red-600">
                      {data.verdictSummary["Contradicted"] ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Contradicted</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-amber-600">
                      {data.highRiskCount}
                    </p>
                    <p className="text-xs text-muted-foreground">High Risk</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Claims table */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Verified Claims ({data.claims.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {data.claims.map((claim, i) => (
                    <div key={claim["@id"] ?? i} className="px-6 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 pt-0.5">
                          <VerdictBadge verdict={claim.verdict} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground leading-relaxed">
                            {claim.claimText}
                          </p>
                          {claim.verdictRationale && (
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                              {claim.verdictRationale}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            {claim.pdbId && (
                              <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                PDB: {claim.pdbId}
                              </span>
                            )}
                            {claim.pdbEvidenceUrl && (
                              <a
                                href={claim.pdbEvidenceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                              >
                                View evidence <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            <span className="text-xs text-muted-foreground capitalize">
                              {claim.claimType?.replace(/_/g, " ")}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Separator className="my-8" />

            {/* Machine-readable footer */}
            <div className="text-center space-y-2">
              <p className="text-xs text-muted-foreground">
                This report is machine-readable. Access the structured claims registry at:
              </p>
              <code className="text-xs bg-muted px-3 py-1.5 rounded block max-w-xl mx-auto break-all">
                {claimsJsonUrl}
              </code>
              <p className="text-xs text-muted-foreground">
                Data licensed under{" "}
                <a
                  href="https://creativecommons.org/licenses/by/4.0/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  CC BY 4.0
                </a>
                . Evidence sourced from{" "}
                <a
                  href="https://www.rcsb.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  RCSB Protein Data Bank
                </a>
                .
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
