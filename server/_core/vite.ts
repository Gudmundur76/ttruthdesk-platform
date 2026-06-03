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

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
