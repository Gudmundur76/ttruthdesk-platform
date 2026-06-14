/**
 * generate-micron.ts
 * Static site generator for Truth Desk micron sites.
 *
 * Produces 8 files per vertical:
 *   index.html, css/micron.css, js/micron.js, js/micron-client.js,
 *   llms.txt, sitemap.xml, feed.xml, robots.txt
 *
 * Usage:
 *   npx tsx scripts/generate-micron.ts \
 *     --vertical=structural_biology \
 *     --domain=salmonbio.wiki \
 *     --out=./dist/salmonbio.wiki
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Vertical definitions ──────────────────────────────────────────────────
interface VerticalConfig {
  id: string;
  label: string;
  tagline: string;
  description: string;
  accentColor: string;
  bgColor: string;
  textColor: string;
  exampleClaim: string;
  keywords: string[];
  ogImage: string;
}

const VERTICALS: Record<string, VerticalConfig> = {
  structural_biology: {
    id: "structural_biology",
    label: "Structural Biology",
    tagline: "Verify protein structure claims against PDB & UniProt",
    description:
      "Instantly validate claims about protein structures, PDB entries, resolution values, and molecular biology findings against authoritative databases.",
    accentColor: "#a855f7",
    bgColor: "#0f0f1a",
    textColor: "#e5e7eb",
    exampleClaim: "The crystal structure of lysozyme was solved at 1.8 Å resolution (PDB: 1LYZ).",
    keywords: ["protein structure", "PDB", "UniProt", "crystallography", "structural biology", "claim verification"],
    ogImage: "https://truthdesk.claims/og/structural_biology.png",
  },
  salmon_biotech: {
    id: "salmon_biotech",
    label: "Salmon Biotechnology",
    tagline: "Verify salmon biology and aquaculture claims",
    description:
      "Validate scientific claims about salmon genetics, aquaculture practices, and marine biotechnology against peer-reviewed sources.",
    accentColor: "#f97316",
    bgColor: "#0a0f0a",
    textColor: "#e5e7eb",
    exampleClaim: "Atlantic salmon (Salmo salar) has a genome size of approximately 2.97 Gb.",
    keywords: ["salmon", "aquaculture", "marine biology", "genetics", "biotechnology", "claim verification"],
    ogImage: "https://truthdesk.claims/og/salmon_biotech.png",
  },
  biosimilar: {
    id: "biosimilar",
    label: "Biosimilar Intelligence",
    tagline: "Verify biosimilar and biologic drug claims",
    description:
      "Validate claims about biosimilar drugs, biologic therapies, and regulatory approvals against FDA, EMA, and clinical databases.",
    accentColor: "#06b6d4",
    bgColor: "#030712",
    textColor: "#e5e7eb",
    exampleClaim: "Adalimumab biosimilars have demonstrated analytical similarity to the reference product Humira.",
    keywords: ["biosimilar", "biologic", "FDA", "EMA", "drug approval", "claim verification"],
    ogImage: "https://truthdesk.claims/og/biosimilar.png",
  },
  genomics: {
    id: "genomics",
    label: "Genomics & Genetics",
    tagline: "Verify genomics and genetic research claims",
    description:
      "Validate claims about gene sequences, CRISPR findings, genome assemblies, and genetic associations against Ensembl, NCBI, and related databases.",
    accentColor: "#22c55e",
    bgColor: "#030f03",
    textColor: "#e5e7eb",
    exampleClaim: "The human genome contains approximately 20,000-25,000 protein-coding genes.",
    keywords: ["genomics", "genetics", "CRISPR", "genome", "gene expression", "claim verification"],
    ogImage: "https://truthdesk.claims/og/genomics.png",
  },
};

// ─── CLI argument parser ───────────────────────────────────────────────────
function parseArgs(): { vertical: string; domain: string; out: string } {
  const args = process.argv.slice(2);
  const get = (key: string, fallback: string) => {
    const match = args.find((a) => a.startsWith(`--${key}=`));
    return match ? match.split("=").slice(1).join("=") : fallback;
  };
  return {
    vertical: get("vertical", "structural_biology"),
    domain: get("domain", "example.com"),
    out: get("out", `./dist/${get("domain", "example.com")}`),
  };
}

// ─── HTML escaping ─────────────────────────────────────────────────────────
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── File generators ───────────────────────────────────────────────────────

function generateIndexHtml(v: VerticalConfig, domain: string): string {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(v.label)} Claim Verifier — Truth Desk</title>
  <meta name="description" content="${esc(v.description)}" />
  <meta name="keywords" content="${esc(v.keywords.join(", "))}" />
  <meta property="og:title" content="${esc(v.label)} Claim Verifier" />
  <meta property="og:description" content="${esc(v.description)}" />
  <meta property="og:image" content="${esc(v.ogImage)}" />
  <meta property="og:url" content="https://${esc(domain)}/" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="canonical" href="https://${esc(domain)}/" />
  <link rel="alternate" type="application/rss+xml" title="${esc(v.label)} Feed" href="/feed.xml" />
  <link rel="stylesheet" href="/css/micron.css" />
  <style>
    :root {
      --accent: ${esc(v.accentColor)};
      --bg: ${esc(v.bgColor)};
      --text: ${esc(v.textColor)};
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="container">
      <a href="/" class="logo">⬡ ${esc(v.label)}</a>
      <nav>
        <a href="https://truthdesk.claims" target="_blank" rel="noopener">Truth Desk Core</a>
        <a href="/feed.xml">RSS</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="container">
        <h1>${esc(v.tagline)}</h1>
        <p class="lead">${esc(v.description)}</p>
      </div>
    </section>

    <section class="verifier">
      <div class="container">
        <h2>Verify a Claim</h2>
        <div id="truth-desk-widget"
             data-truth-desk
             data-vertical="${esc(v.id)}"
             data-theme="dark">
        </div>
        <p class="example-hint">
          Example: <em>"${esc(v.exampleClaim)}"</em>
        </p>
      </div>
    </section>

    <section class="about">
      <div class="container">
        <h2>How It Works</h2>
        <div class="steps">
          <div class="step">
            <span class="step-num">1</span>
            <h3>Enter a claim</h3>
            <p>Paste any scientific statement from a paper, pitch deck, or report.</p>
          </div>
          <div class="step">
            <span class="step-num">2</span>
            <h3>AI extracts entities</h3>
            <p>The Truth Desk engine identifies proteins, PDB IDs, and key claims.</p>
          </div>
          <div class="step">
            <span class="step-num">3</span>
            <h3>Database lookup</h3>
            <p>Cross-references PDB, UniProt, and domain-specific registries in real time.</p>
          </div>
          <div class="step">
            <span class="step-num">4</span>
            <h3>Verdict returned</h3>
            <p>Supported, Contradicted, Ambiguous, or Insufficient Evidence — with rationale.</p>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">
      <p>© ${year} ${esc(domain)} · Powered by <a href="https://truthdesk.claims" target="_blank" rel="noopener">Truth Desk</a></p>
      <p class="fine-print">This site is a micron node of the Truth Desk verification network. Claims are validated against authoritative scientific databases. Not a substitute for expert review.</p>
    </div>
  </footer>

  <script src="/js/micron-client.js"></script>
  <script src="/js/micron.js"></script>
</body>
</html>
`;
}

function generateMicronCss(v: VerticalConfig): string {
  return `/* micron.css — Truth Desk Micron Site Styles */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --accent: ${v.accentColor};
  --bg: ${v.bgColor};
  --text: ${v.textColor};
  --muted: rgba(255,255,255,0.45);
  --border: rgba(255,255,255,0.08);
  --radius: 12px;
  --max-w: 860px;
}

html { font-size: 16px; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  min-height: 100vh;
}

.container { max-width: var(--max-w); margin: 0 auto; padding: 0 20px; }

/* Header */
.site-header {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0;
  background: var(--bg);
  z-index: 10;
}
.site-header .container { display: flex; align-items: center; justify-content: space-between; }
.logo { font-size: 18px; font-weight: 800; color: var(--accent); text-decoration: none; }
nav { display: flex; gap: 20px; }
nav a { color: var(--muted); text-decoration: none; font-size: 14px; transition: color .2s; }
nav a:hover { color: var(--text); }

/* Hero */
.hero { padding: 64px 0 40px; text-align: center; }
.hero h1 {
  font-size: clamp(1.75rem, 4vw, 2.75rem);
  font-weight: 800;
  line-height: 1.2;
  margin-bottom: 16px;
  background: linear-gradient(135deg, var(--text) 0%, var(--accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.lead { font-size: 1.05rem; color: var(--muted); max-width: 600px; margin: 0 auto; }

/* Verifier section */
.verifier { padding: 40px 0; }
.verifier h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 20px; }
.example-hint { margin-top: 12px; font-size: 13px; color: var(--muted); }
.example-hint em { color: var(--accent); font-style: normal; }

/* About / Steps */
.about { padding: 48px 0; border-top: 1px solid var(--border); }
.about h2 { font-size: 1.4rem; font-weight: 700; margin-bottom: 28px; }
.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 24px; }
.step { padding: 20px; border: 1px solid var(--border); border-radius: var(--radius); }
.step-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--accent); color: #fff;
  font-size: 14px; font-weight: 800; margin-bottom: 12px;
}
.step h3 { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
.step p { font-size: 13px; color: var(--muted); }

/* Footer */
.site-footer {
  padding: 32px 0;
  border-top: 1px solid var(--border);
  text-align: center;
  margin-top: 48px;
}
.site-footer p { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.site-footer a { color: var(--accent); text-decoration: none; }
.fine-print { font-size: 11px; opacity: 0.5; max-width: 560px; margin: 8px auto 0; }

@media (max-width: 600px) {
  .hero { padding: 40px 0 24px; }
  .steps { grid-template-columns: 1fr; }
}
`;
}

function generateMicronJs(v: VerticalConfig, domain: string): string {
  return `/* micron.js — site-level enhancements */
(function () {
  "use strict";
  // Pre-fill example claim on hint click
  var hint = document.querySelector(".example-hint em");
  var input = document.querySelector(".td-input");
  if (hint && input) {
    hint.style.cursor = "pointer";
    hint.title = "Click to try this example";
    hint.addEventListener("click", function () {
      input.value = hint.textContent;
      input.focus();
    });
  }

  // Announce vertical in console for devs
  console.log(
    "[TruthDesk Micron] vertical=${v.id} domain=${domain} sdk=" +
      (window.TruthDesk ? window.TruthDesk.version : "not loaded")
  );
})();
`;
}

function generateLlmsTxt(v: VerticalConfig, domain: string): string {
  return `# ${v.label} — Truth Desk Micron Node
# https://${domain}/llms.txt

## Site Purpose
This site is a micron node of the Truth Desk scientific claim verification network.
It provides real-time validation of ${v.label.toLowerCase()} claims against authoritative databases.

## API
Base URL: https://truthdesk.claims/api/public/
- POST /verify-claim — verify a single claim (body: { "claim": "..." })
- GET  /claims.json  — browse recent verified claims

## Vertical
ID: ${v.id}
Label: ${v.label}
Description: ${v.description}

## Example claim
${v.exampleClaim}

## Verdict types
- Supported: claim confirmed by database evidence
- Partially Supported: partial match found
- Contradicted: claim conflicts with database records
- Ambiguous: multiple interpretations possible
- Insufficient Evidence: no matching records found
- Out of Scope: claim type not verifiable by current databases

## Contact
Core platform: https://truthdesk.claims
`;
}

function generateSitemapXml(domain: string): string {
  const now = new Date().toISOString().split("T")[0];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${esc(domain)}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

function generateFeedXml(v: VerticalConfig, domain: string): string {
  const now = new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(v.label)} — Truth Desk Verdicts</title>
    <link>https://${esc(domain)}/</link>
    <description>${esc(v.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="https://${esc(domain)}/feed.xml" rel="self" type="application/rss+xml" />
    <item>
      <title>Live verdicts available via API</title>
      <link>https://citation.is/api/public/claims.json?vertical=${esc(v.id)}</link>
      <description>Real-time claim verdicts for ${esc(v.label)} are available via the Truth Desk public API.</description>
      <pubDate>${now}</pubDate>
      <guid>https://citation.is/api/public/claims.json?vertical=${esc(v.id)}</guid>
    </item>
  </channel>
</rss>
`;
}

function generateRobotsTxt(domain: string): string {
  return `User-agent: *
Allow: /

Sitemap: https://${domain}/sitemap.xml

# Truth Desk Micron Node
# Core API: https://truthdesk.claims
`;
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
  const { vertical, domain, out } = parseArgs();

  const v = VERTICALS[vertical];
  if (!v) {
    console.error(`Unknown vertical: ${vertical}`);
    console.error(`Available: ${Object.keys(VERTICALS).join(", ")}`);
    process.exit(1);
  }

  // Read micron-client.js from embed-sdk directory
  const sdkSrc = path.resolve(__dirname, "../embed-sdk/micron-client.js");
  const sdkContent = fs.existsSync(sdkSrc)
    ? fs.readFileSync(sdkSrc, "utf8")
    : "// micron-client.js not found — run from project root\n";

  // Create output directories
  const dirs = [out, `${out}/css`, `${out}/js`];
  dirs.forEach((d) => fs.mkdirSync(d, { recursive: true }));

  // Write all 8 files
  const files: Array<[string, string]> = [
    [`${out}/index.html`, generateIndexHtml(v, domain)],
    [`${out}/css/micron.css`, generateMicronCss(v)],
    [`${out}/js/micron.js`, generateMicronJs(v, domain)],
    [`${out}/js/micron-client.js`, sdkContent],
    [`${out}/llms.txt`, generateLlmsTxt(v, domain)],
    [`${out}/sitemap.xml`, generateSitemapXml(domain)],
    [`${out}/feed.xml`, generateFeedXml(v, domain)],
    [`${out}/robots.txt`, generateRobotsTxt(domain)],
  ];

  let totalBytes = 0;
  files.forEach(([filePath, content]) => {
    fs.writeFileSync(filePath, content, "utf8");
    const size = Buffer.byteLength(content, "utf8");
    totalBytes += size;
    console.log(`  ✓ ${path.relative(out, filePath).padEnd(30)} ${(size / 1024).toFixed(1)} KB`);
  });

  console.log(`\n✅ Micron generated: ${out}`);
  console.log(`   Vertical : ${v.label}`);
  console.log(`   Domain   : ${domain}`);
  console.log(`   Files    : ${files.length}`);
  console.log(`   Total    : ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`\nNext step:`);
  console.log(`  ./scripts/deploy-to-hostinger.sh \\`);
  console.log(`    --vertical=${vertical} \\`);
  console.log(`    --domain=${domain} \\`);
  console.log(`    --hostinger-user=u123456789 \\`);
  console.log(`    --hostinger-host=89.116.123.45`);
}

main();
