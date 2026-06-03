import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      // Replace title template variable with VITE_APP_TITLE env var
      template = template.replace(
        `{{project_title}}`,
        process.env.VITE_APP_TITLE ?? "Truth Desk"
      );

      // ── Inject crawlable semantic HTML for agent/crawler readability ──────
      // Injected before </body> so crawlers see real content without JS.
      const crawlableHtml = `
<noscript>
  <main id="crawlable-content" aria-label="Truth Desk platform overview">
    <header>
      <h1>Truth Desk — Scientific Claims Verification Platform</h1>
      <p>Autonomous multi-vertical platform that verifies scientific claims against authoritative databases including the Protein Data Bank, PubChem, and PMC Open Access.</p>
    </header>
    <section aria-labelledby="features-heading">
      <h2 id="features-heading">Platform Features</h2>
      <ul>
        <li>Document ingestion: upload pitch decks, abstracts, whitepapers, and patents</li>
        <li>Claim extraction: LLM-powered extraction of molecular claims, PDB IDs, protein names, and methods</li>
        <li>PDB evidence validation: every claim checked against the RCSB Protein Data Bank</li>
        <li>Seven-verdict engine: Supported, Contradicted, Partially Supported, Ambiguous, Insufficient Evidence, Out of Scope, Needs Expert Review</li>
        <li>Knowledge graph: force-directed graph of all verified claims and cross-vertical relationships</li>
        <li>Continuous monitoring: nightly PubMed and PMC Open Access feed for new evidence</li>
      </ul>
    </section>
    <section aria-labelledby="verticals-heading">
      <h2 id="verticals-heading">Research Verticals</h2>
      <ul>
        <li>Structural Biology (live) — verified against RCSB PDB</li>
        <li>Salmon Biotech (beta) — verified against PubChem and PMC OA</li>
        <li>Drug Discovery (coming soon)</li>
        <li>Clinical Genomics (coming soon)</li>
      </ul>
    </section>
    <section aria-labelledby="api-heading">
      <h2 id="api-heading">Machine-Readable Endpoints</h2>
      <ul>
        <li><a href="/api/public/claims.json">GET /api/public/claims.json — full verified claims registry</a></li>
        <li><a href="/.well-known/mcp.json">GET /.well-known/mcp.json — MCP tool card</a></li>
        <li><a href="/llms.txt">GET /llms.txt — AI agent instructions</a></li>
        <li><a href="/sitemap.xml">GET /sitemap.xml — all public audit report URLs</a></li>
      </ul>
    </section>
    <nav aria-label="Main navigation">
      <a href="/">Home</a>
      <a href="/verticals">Verticals</a>
      <a href="/registry">Registry</a>
      <a href="/graph">Knowledge Graph</a>
      <a href="/pricing">Pricing</a>
    </nav>
  </main>
  <footer role="contentinfo" aria-label="Site footer">
    <p>Truth Desk is operated by Arctic Media LLC. Evidence verification powered by RCSB PDB, PubChem, and PMC Open Access. Not a substitute for expert scientific judgment.</p>
    <p>Contact: <a href="/pricing">Request an audit</a> | <a href="/llms.txt">AI agent instructions</a> | <a href="/.well-known/mcp.json">MCP tool card</a></p>
  </footer>
</noscript>
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "name": "Truth Desk",
      "url": "https://protein-desk-5r5rzpyg.manus.space",
      "description": "Autonomous multi-vertical scientific claims verification platform. Verifies claims against PDB, PubChem, and PMC Open Access.",
      "potentialAction": {
        "@type": "SearchAction",
        "target": "https://protein-desk-5r5rzpyg.manus.space/registry?q={search_term_string}",
        "query-input": "required name=search_term_string"
      }
    },
    {
      "@type": "SoftwareApplication",
      "name": "Truth Desk",
      "applicationCategory": "Scientific Research Tool",
      "operatingSystem": "Web",
      "description": "Verifies scientific claims in biotech documents against authoritative databases. Supports structural biology, salmon biotech, and multiple research verticals.",
      "offers": [
        { "@type": "Offer", "name": "Starter Audit", "price": "1500", "priceCurrency": "USD" },
        { "@type": "Offer", "name": "Diligence Audit", "price": "5000", "priceCurrency": "USD" },
        { "@type": "Offer", "name": "Platform Pilot", "price": "0", "priceCurrency": "USD", "description": "Custom pricing" }
      ],
      "featureList": [
        "Claim extraction from scientific documents",
        "PDB evidence validation",
        "Seven-verdict classification engine",
        "Knowledge graph visualisation",
        "Nightly PMC Open Access feed",
        "Machine-readable claims registry"
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is Truth Desk?",
          "acceptedAnswer": { "@type": "Answer", "text": "Truth Desk is an autonomous scientific claims verification platform that checks claims in biotech documents against authoritative databases including the RCSB Protein Data Bank, PubChem, and PMC Open Access." }
        },
        {
          "@type": "Question",
          "name": "What verdicts does Truth Desk assign?",
          "acceptedAnswer": { "@type": "Answer", "text": "Truth Desk assigns one of seven verdicts: Supported, Partially Supported, Contradicted, Ambiguous, Insufficient Evidence, Out of Scope, or Needs Expert Review." }
        },
        {
          "@type": "Question",
          "name": "What research verticals does Truth Desk cover?",
          "acceptedAnswer": { "@type": "Answer", "text": "Truth Desk currently covers Structural Biology (verified against RCSB PDB) and Salmon Biotech (verified against PubChem and PMC Open Access), with Drug Discovery and Clinical Genomics coming soon." }
        }
      ]
    }
  ]
}, null, 2)}
</script>`;
      template = template.replace("</body>", crawlableHtml + "\n</body>");

      // ── Add content-signal and discovery meta tags ─────────────────────────
      const discoveryMeta = [
        '<meta name="content-signal" content="scientific-claims-verification,biotech,structural-biology,salmon-biotech,evidence-auditing" />',
        '<link rel="alternate" type="text/markdown" href="/api/md" title="Truth Desk — Markdown" />',
        '<link rel="alternate" type="application/json" href="/api/public/claims.json" title="Verified Claims Registry" />',
      ].join("\n    ");
      template = template.replace("</head>", `  ${discoveryMeta}\n  </head>`);

      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

// ── Semantic HTML injection for production HTML responses ────────────────
function buildSemanticInjection(): { headMeta: string; noscriptBlock: string } {
  const noscriptBlock = `
<noscript>
  <header>
    <nav aria-label="Main navigation">
      <a href="/">Truth Desk</a>
      <a href="/verticals">Verticals</a>
      <a href="/registry">Registry</a>
      <a href="/graph">Knowledge Graph</a>
      <a href="/pricing">Pricing</a>
    </nav>
  </header>
  <main id="main-content">
    <section aria-labelledby="hero-heading">
      <h1 id="hero-heading">Truth Desk — Scientific Claims Verification Platform</h1>
      <p>Truth Desk is an autonomous multi-vertical platform that verifies scientific claims against authoritative databases. It ingests peer-reviewed literature from PMC Open Access, extracts molecular and biological claims, and cross-references each claim against the Protein Data Bank (PDB), PubChem, PubMed, and UniProt.</p>
      <p>Every verdict is traceable to a primary evidence source. LLMs are used only for claim extraction — never for verdict generation. The result is a machine-readable audit trail that researchers, investors, and AI agents can query directly.</p>
    </section>
    <section aria-labelledby="verticals-heading">
      <h2 id="verticals-heading">Research Verticals</h2>
      <p>Truth Desk operates across multiple scientific domains. Each vertical uses domain-specific MeSH queries, curated evidence sources, and a two-pass quality pipeline to ensure high-fidelity claim verification.</p>
      <ul>
        <li><strong>Structural Biology</strong> — Verifies protein structure claims against PDB deposited crystal structures. Covers fold topology, binding site geometry, resolution thresholds, and crystallographic evidence.</li>
        <li><strong>Salmon Biotech</strong> — Verifies aquaculture and marine biotech claims against PubChem compound data and PubMed literature. Covers feed additives, growth factors, and disease resistance compounds.</li>
        <li><strong>Drug Discovery</strong> — Coming soon. Will cover small molecule candidates, target binding affinity, and ADMET property claims.</li>
        <li><strong>Clinical Genomics</strong> — Coming soon. Will cover variant pathogenicity, gene expression, and clinical association claims.</li>
        <li><strong>Cancer Biology</strong> — Coming soon. Will cover oncogene activity, tumour suppressor function, and therapeutic target claims.</li>
      </ul>
      <p><a href="/verticals">View all verticals and live statistics</a></p>
    </section>
    <section aria-labelledby="registry-heading">
      <h2 id="registry-heading">Claims Registry and Knowledge Graph</h2>
      <p>All verified claims are published in a machine-readable registry accessible at <a href="/api/public/claims.json">/api/public/claims.json</a>. The registry includes claim text, verdict (supported, refuted, or inconclusive), confidence score, evidence source, and a link to the full audit report.</p>
      <p>The interactive knowledge graph at <a href="/graph">/graph</a> visualises relationships between scientific documents, extracted claims, and evidence nodes. Document nodes are colour-coded by vertical domain. Evidence nodes are colour-coded by verdict.</p>
      <p>AI agents can query the platform directly via the MCP tool card at <a href="/.well-known/mcp.json">/.well-known/mcp.json</a>, the markdown summary at <a href="/api/md">/api/md</a>, and the agent-callable verification endpoint at <a href="/api/public/verify-claim">/api/public/verify-claim</a>.</p>
      <p><a href="/registry">Browse the public claims registry</a></p>
    </section>
  </main>
  <footer>
    <nav aria-label="Footer navigation">
      <a href="/">Home</a>
      <a href="/verticals">Verticals</a>
      <a href="/registry">Registry</a>
      <a href="/graph">Knowledge Graph</a>
      <a href="/pricing">Pricing</a>
      <a href="/llms.txt">llms.txt</a>
      <a href="/.well-known/mcp.json">MCP</a>
      <a href="/api/public/claims.json">Claims API</a>
    </nav>
    <p>Truth Desk by Arctic Media LLC. Scientific claims verified against PDB, PubChem, PubMed, UniProt, and PMC Open Access.</p>
  </footer>
</noscript>`;

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": "https://protein-desk-5r5rzpyg.manus.space/#website",
        "url": "https://protein-desk-5r5rzpyg.manus.space/",
        "name": "Truth Desk",
        "description": "Autonomous multi-vertical scientific claims verification platform. Verifies molecular, structural, and biological claims against authoritative databases including PDB, PubChem, PubMed, UniProt, and PMC Open Access.",
        "publisher": { "@type": "Organization", "name": "Arctic Media LLC", "url": "https://protein-desk-5r5rzpyg.manus.space/" }
      },
      {
        "@type": "SoftwareApplication",
        "@id": "https://protein-desk-5r5rzpyg.manus.space/#app",
        "name": "Truth Desk",
        "applicationCategory": "ScientificApplication",
        "operatingSystem": "Web",
        "description": "Truth Desk autonomously ingests scientific literature from PMC Open Access, extracts molecular and biological claims, and verifies each claim against authoritative evidence databases including the Protein Data Bank (PDB), PubChem, PubMed, and UniProt.",
        "offers": [
          { "@type": "Offer", "name": "Starter", "price": "1500", "priceCurrency": "USD" },
          { "@type": "Offer", "name": "Diligence", "price": "5000", "priceCurrency": "USD" }
        ],
        "featureList": [
          "Automated claim extraction from PMC Open Access literature",
          "PDB structure verification for structural biology claims",
          "PubChem compound verification for chemistry and biotech claims",
          "Machine-readable claim registry at /api/public/claims.json",
          "Interactive knowledge graph at /graph",
          "Agent-callable verification endpoint at /api/public/verify-claim",
          "MCP tool card at /.well-known/mcp.json"
        ]
      },
      {
        "@type": "FAQPage",
        "@id": "https://protein-desk-5r5rzpyg.manus.space/#faq",
        "mainEntity": [
          { "@type": "Question", "name": "What is Truth Desk?", "acceptedAnswer": { "@type": "Answer", "text": "Truth Desk is an autonomous scientific claims verification platform. It ingests peer-reviewed literature from PMC Open Access, extracts molecular and biological claims, and verifies each claim against authoritative databases including the Protein Data Bank (PDB), PubChem, PubMed, and UniProt." } },
          { "@type": "Question", "name": "Which research verticals does Truth Desk cover?", "acceptedAnswer": { "@type": "Answer", "text": "Truth Desk currently covers structural biology and salmon biotech, with drug discovery, clinical genomics, cancer biology, neuroscience, and agri-biotech planned." } },
          { "@type": "Question", "name": "How does Truth Desk verify claims?", "acceptedAnswer": { "@type": "Answer", "text": "Claims are verified by cross-referencing against authoritative databases. Structural biology claims are checked against the Protein Data Bank (PDB). Chemistry and biotech claims are checked against PubChem. LLMs are used only for claim extraction, never for verdict generation." } },
          { "@type": "Question", "name": "Can AI agents query Truth Desk programmatically?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. Truth Desk exposes a machine-readable claims registry at /api/public/claims.json, an agent-callable verification endpoint at /api/public/verify-claim, a markdown summary at /api/md, and an MCP tool card at /.well-known/mcp.json." } },
          { "@type": "Question", "name": "What is the knowledge graph?", "acceptedAnswer": { "@type": "Answer", "text": "The knowledge graph at /graph visualises relationships between scientific documents, extracted claims, and verified evidence nodes. Nodes are colour-coded by vertical domain and verdict. The graph can be embedded in external sites via iframe." } }
        ]
      }
    ]
  }, null, 2);

  const headMeta = [
    '<meta name="content-signal" content="scientific-claims-verification" />',
    `<script type="application/ld+json">\n${jsonLd}\n</script>`,
  ].join("\n    ");

  return { headMeta, noscriptBlock };
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html — inject semantic HTML before sending
  app.use("*", (_req, res) => {
    const indexPath = path.resolve(distPath, "index.html");
    try {
      let html = fs.readFileSync(indexPath, "utf-8");
      const { headMeta, noscriptBlock } = buildSemanticInjection();
      // Inject meta + JSON-LD into <head>
      if (!html.includes('content-signal')) {
        html = html.replace("</head>", `    ${headMeta}\n  </head>`);
      }
      // Inject noscript block before </body>
      if (!html.includes('<noscript>')) {
        html = html.replace("</body>", `${noscriptBlock}\n  </body>`);
      }
      // Replace title placeholder if present
      html = html.replace('{{project_title}}', process.env.VITE_APP_TITLE ?? 'Truth Desk');
      res.set('Content-Type', 'text/html; charset=utf-8').send(html);
    } catch {
      res.sendFile(indexPath);
    }
  });
}
