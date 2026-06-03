import { useState } from "react";
import { Link } from "wouter";
import { Copy, Check, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1.5 rounded hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  return (
    <div className="relative rounded-lg bg-slate-900 border border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
        <span className="text-xs text-slate-400 font-mono">{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-4 text-sm text-slate-200 font-mono overflow-x-auto whitespace-pre leading-relaxed">{code}</pre>
    </div>
  );
}

function EndpointSection({
  method,
  path,
  title,
  description,
  children,
}: {
  method: "GET" | "POST";
  path: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const methodColors = { GET: "bg-green-500/20 text-green-400 border-green-500/30", POST: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  return (
    <div className="border border-border rounded-xl overflow-hidden mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-4 p-5 text-left hover:bg-muted/30 transition-colors"
      >
        <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded border font-mono mt-0.5 ${methodColors[method]}`}>{method}</span>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm text-foreground mb-1">{path}</p>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-border pt-5 space-y-4">{children}</div>}
    </div>
  );
}

function ParamTable({ params }: { params: { name: string; type: string; required: boolean; desc: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-3 text-muted-foreground font-medium text-xs">Parameter</th>
            <th className="text-left py-2 px-3 text-muted-foreground font-medium text-xs">Type</th>
            <th className="text-left py-2 px-3 text-muted-foreground font-medium text-xs">Required</th>
            <th className="text-left py-2 px-3 text-muted-foreground font-medium text-xs">Description</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <tr key={p.name} className="border-b border-border hover:bg-muted/20">
              <td className="py-2 px-3 font-mono text-xs text-primary">{p.name}</td>
              <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{p.type}</td>
              <td className="py-2 px-3 text-xs">{p.required ? <span className="text-red-400">required</span> : <span className="text-muted-foreground">optional</span>}</td>
              <td className="py-2 px-3 text-xs text-muted-foreground">{p.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BASE = typeof window !== "undefined" ? window.location.origin : "https://your-domain.manus.space";

export default function ApiDocs() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <Link href="/" className="hover:text-foreground transition-colors">Truth Desk</Link>
            <span>/</span>
            <span>API Documentation</span>
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-4">Public API</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Truth Desk exposes a public REST API for machine-readable claim verification results. No authentication required for public endpoints. All responses are JSON.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <div className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              No API key required for public endpoints
            </div>
            <div className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
              Base URL: <span className="font-mono">{BASE}/api/public</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Quick nav */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          {[
            { label: "Verify Claim", href: "#verify-claim" },
            { label: "Claims Registry", href: "#claims-registry" },
            { label: "Document Claims", href: "#document-claims" },
            { label: "Claim Detail", href: "#claim-detail" },
          ].map((item) => (
            <a key={item.href} href={item.href} className="border border-border rounded-lg p-3 text-sm text-center hover:border-primary/50 hover:text-primary transition-colors">
              {item.label}
            </a>
          ))}
        </div>

        {/* Rate limits */}
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-8 text-sm text-amber-400">
          <strong className="text-amber-300">Rate limits:</strong> Public endpoints are rate-limited to 60 requests per minute per IP. If you need higher limits, contact us at <a href="mailto:api@truthdesk.io" className="underline">api@truthdesk.io</a>.
        </div>

        {/* ── Verify Claim ─────────────────────────────────────────────────── */}
        <h2 id="verify-claim" className="text-xl font-bold text-foreground mb-4 pt-4">Claim Verification</h2>

        <EndpointSection
          method="POST"
          path="/api/public/verify-claim"
          title="Verify a Scientific Claim"
          description="Submit a scientific claim for instant verification against PDB, PubMed, and PubChem. Returns a verdict and confidence score within seconds."
        >
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Request Body</h4>
            <ParamTable params={[
              { name: "claim", type: "string", required: true, desc: "The scientific claim to verify (max 1000 characters)" },
              { name: "context", type: "string", required: false, desc: "Optional surrounding context to improve accuracy" },
              { name: "claimType", type: "string", required: false, desc: "One of: structural, quantitative, methodological, organism" },
            ]} />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Example — cURL</h4>
            <CodeBlock lang="bash" code={`curl -X POST ${BASE}/api/public/verify-claim \\
  -H "Content-Type: application/json" \\
  -d '{
    "claim": "The crystal structure of PCNA was solved at 2.35 Å resolution by X-ray crystallography",
    "claimType": "structural"
  }'`} />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Example — Python</h4>
            <CodeBlock lang="python" code={`import requests

response = requests.post(
    "${BASE}/api/public/verify-claim",
    json={
        "claim": "The crystal structure of PCNA was solved at 2.35 Å resolution by X-ray crystallography",
        "claimType": "structural"
    }
)
result = response.json()
print(result["verdict"])          # "Supported"
print(result["confidenceScore"])  # 0.87
print(result["evidenceUrl"])      # "https://www.rcsb.org/structure/1AXC"`} />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Example — JavaScript</h4>
            <CodeBlock lang="javascript" code={`const response = await fetch("${BASE}/api/public/verify-claim", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    claim: "The crystal structure of PCNA was solved at 2.35 Å resolution by X-ray crystallography",
    claimType: "structural"
  })
});
const { verdict, confidenceScore, evidenceUrl } = await response.json();`} />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Response Schema</h4>
            <CodeBlock lang="json" code={`{
  "verdict": "Supported",
  "confidenceScore": 0.87,
  "confidenceFlags": ["STRONG_PDB_MATCH", "METHOD_VERIFIED"],
  "evidenceUrl": "https://www.rcsb.org/structure/1AXC",
  "rationale": "PDB entry 1AXC confirms PCNA structure at 2.35 Å resolution by X-ray crystallography.",
  "pdbId": "1AXC",
  "processedAt": "2026-06-03T10:22:00Z"
}`} />
          </div>

          <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Verdict values:</strong> <code className="text-primary">Supported</code>, <code className="text-primary">Contradicted</code>, <code className="text-primary">Partially Supported</code>, <code className="text-primary">Ambiguous</code>, <code className="text-primary">Insufficient Evidence</code>, <code className="text-primary">Out of Scope</code>, <code className="text-primary">Needs Expert Review</code>
          </div>
        </EndpointSection>

        {/* ── Claims Registry ───────────────────────────────────────────────── */}
        <h2 id="claims-registry" className="text-xl font-bold text-foreground mb-4 pt-4">Claims Registry</h2>

        <EndpointSection
          method="GET"
          path="/api/public/claims.json"
          title="Public Claims Registry"
          description="Returns all publicly verified claims in machine-readable JSON format. Suitable for bulk download, research, and integration."
        >
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Query Parameters</h4>
            <ParamTable params={[
              { name: "verdict", type: "string", required: false, desc: "Filter by verdict: Supported, Contradicted, etc." },
              { name: "claimType", type: "string", required: false, desc: "Filter by type: structural, quantitative, methodological, organism" },
              { name: "limit", type: "integer", required: false, desc: "Max results (default 100, max 1000)" },
              { name: "offset", type: "integer", required: false, desc: "Pagination offset (default 0)" },
            ]} />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Example — cURL</h4>
            <CodeBlock lang="bash" code={`# All public claims
curl "${BASE}/api/public/claims.json"

# Only contradicted claims
curl "${BASE}/api/public/claims.json?verdict=Contradicted"

# Paginated
curl "${BASE}/api/public/claims.json?limit=50&offset=100"`} />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Response Schema</h4>
            <CodeBlock lang="json" code={`{
  "total": 1247,
  "limit": 100,
  "offset": 0,
  "claims": [
    {
      "id": 42,
      "claimText": "The resolution of the PCNA crystal structure is 2.35 Å",
      "claimType": "structural",
      "verdict": "Supported",
      "confidenceScore": 0.87,
      "pdbId": "1AXC",
      "proteinName": "Proliferating cell nuclear antigen",
      "evidenceUrl": "https://www.rcsb.org/structure/1AXC",
      "documentId": 7,
      "verifiedAt": "2026-05-14T09:15:00Z"
    }
  ]
}`} />
          </div>
        </EndpointSection>

        {/* ── Document Claims ───────────────────────────────────────────────── */}
        <h2 id="document-claims" className="text-xl font-bold text-foreground mb-4 pt-4">Document-Level Access</h2>

        <EndpointSection
          method="GET"
          path="/api/public/documents/:id/claims.json"
          title="Claims for a Specific Document"
          description="Returns all verified claims for a single document. The document must be publicly visible."
        >
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Path Parameters</h4>
            <ParamTable params={[
              { name: "id", type: "integer", required: true, desc: "Document ID (visible in the audit report URL)" },
            ]} />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Example</h4>
            <CodeBlock lang="bash" code={`curl "${BASE}/api/public/documents/7/claims.json"`} />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Response Schema</h4>
            <CodeBlock lang="json" code={`{
  "documentId": 7,
  "title": "Structural basis of PCNA clamp loader mechanism",
  "claimCount": 14,
  "verdictSummary": {
    "Supported": 9,
    "Partially Supported": 3,
    "Insufficient Evidence": 2
  },
  "claims": [ /* same schema as /claims.json */ ]
}`} />
          </div>
        </EndpointSection>

        {/* ── Claim Detail ─────────────────────────────────────────────────── */}
        <h2 id="claim-detail" className="text-xl font-bold text-foreground mb-4 pt-4">Claim Detail</h2>

        <EndpointSection
          method="GET"
          path="/claim/:id"
          title="Claim Detail Page (HTML + JSON-LD)"
          description="Each claim has a canonical URL that returns an HTML page with embedded ClaimReview and FAQPage JSON-LD schema. Suitable for citation and AI engine indexing."
        >
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Example</h4>
            <CodeBlock lang="bash" code={`# HTML page with JSON-LD
curl "${BASE}/claim/42"

# Check the embedded schema
curl -s "${BASE}/claim/42" | grep -A 50 'application/ld+json'`} />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Embedded JSON-LD (ClaimReview)</h4>
            <CodeBlock lang="json" code={`{
  "@context": "https://schema.org",
  "@type": "ClaimReview",
  "url": "${BASE}/claim/42",
  "claimReviewed": "The resolution of the PCNA crystal structure is 2.35 Å",
  "reviewRating": {
    "@type": "Rating",
    "ratingValue": "5",
    "bestRating": "5",
    "worstRating": "1",
    "alternateName": "Supported"
  },
  "author": {
    "@type": "Organization",
    "name": "Truth Desk",
    "url": "${BASE}"
  },
  "datePublished": "2026-05-14",
  "dateModified": "2026-05-14"
}`} />
          </div>
        </EndpointSection>

        {/* ── Errors ───────────────────────────────────────────────────────── */}
        <h2 className="text-xl font-bold text-foreground mb-4 pt-4">Error Responses</h2>
        <div className="border border-border rounded-xl overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Status</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Code</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium text-xs">Description</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["400", "INVALID_INPUT", "Request body failed validation (missing required field, invalid type)"],
                ["404", "NOT_FOUND", "Document or claim does not exist, or is not publicly visible"],
                ["429", "RATE_LIMITED", "Too many requests — back off and retry after 60 seconds"],
                ["500", "INTERNAL_ERROR", "Unexpected server error — please report to api@truthdesk.io"],
              ].map(([status, code, desc]) => (
                <tr key={status} className="border-b border-border hover:bg-muted/20">
                  <td className="py-3 px-4 font-mono text-xs text-red-400">{status}</td>
                  <td className="py-3 px-4 font-mono text-xs text-amber-400">{code}</td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <CodeBlock lang="json" code={`{
  "error": {
    "code": "INVALID_INPUT",
    "message": "claim is required and must be a non-empty string"
  }
}`} />

        {/* Footer */}
        <div className="py-10 flex flex-wrap gap-4 text-sm text-muted-foreground border-t border-border mt-8">
          <Link href="/" className="hover:text-foreground transition-colors">← Back to Truth Desk</Link>
          <Link href="/trust" className="hover:text-foreground transition-colors">Trust & Transparency →</Link>
          <a href="mailto:api@truthdesk.io" className="hover:text-foreground transition-colors flex items-center gap-1">
            API Support <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
