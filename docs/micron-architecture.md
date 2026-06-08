# Truth Desk Micron Architecture

## Overview

A **micron** is a lightweight static site (8 files, ~40 KB total) that acts as a domain-specific node of the Truth Desk verification network. Each micron:

- Serves a single scientific vertical (structural biology, salmon biotech, biosimilar, genomics)
- Calls the `truthdesk.claims` public API for all verification logic
- Requires zero server infrastructure on the host — deploys to any static host (Hostinger Pro, GitHub Pages, Cloudflare Pages, IPFS)
- Generates SEO-optimised HTML, RSS feed, sitemap, and `llms.txt` for AI discovery

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Truth Desk Core                          │
│                  truthdesk.claims                          │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ tRPC API    │  │ CopilotKit   │  │ Public REST API   │  │
│  │ (auth)      │  │ AI Sidebar   │  │ /api/public/*     │  │
│  └─────────────┘  └──────────────┘  └─────────┬─────────┘  │
│                                               │             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Database: claims, documents, entities, verticals    │    │
│  └─────────────────────────────────────────────────────┘    │
└───────────────────────────────┬─────────────────────────────┘
                                │ HTTPS API calls
              ┌─────────────────┼─────────────────┐
              │                 │                 │
    ┌─────────▼──────┐ ┌────────▼───────┐ ┌──────▼──────────┐
    │ salmonbio.wiki │ │ biosimilar.wiki│ │ structbio.claims│
    │ (Hostinger Pro)│ │ (Hostinger Pro)│ │ (Cloudflare)    │
    │                │ │                │ │                 │
    │ index.html     │ │ index.html     │ │ index.html      │
    │ css/micron.css │ │ css/micron.css │ │ css/micron.css  │
    │ js/micron.js   │ │ js/micron.js   │ │ js/micron.js    │
    │ js/micron-     │ │ js/micron-     │ │ js/micron-      │
    │   client.js    │ │   client.js    │ │   client.js     │
    │ llms.txt       │ │ llms.txt       │ │ llms.txt        │
    │ sitemap.xml    │ │ sitemap.xml    │ │ sitemap.xml     │
    │ feed.xml       │ │ feed.xml       │ │ feed.xml        │
    │ robots.txt     │ │ robots.txt     │ │ robots.txt      │
    └────────────────┘ └────────────────┘ └─────────────────┘
```

---

## Files Per Micron

| File | Purpose | Size |
|------|---------|------|
| `index.html` | Main page with widget, hero, about section | ~6 KB |
| `css/micron.css` | Vertical-themed styles | ~3 KB |
| `js/micron.js` | Site-level enhancements (example hint click) | ~0.5 KB |
| `js/micron-client.js` | Truth Desk SDK — calls truthdesk.claims API | ~7 KB |
| `llms.txt` | AI discovery file (ChatGPT, Perplexity, Claude) | ~0.5 KB |
| `sitemap.xml` | SEO sitemap | ~0.3 KB |
| `feed.xml` | RSS feed linking to live API | ~0.5 KB |
| `robots.txt` | Crawler instructions | ~0.1 KB |

**Total: ~18 KB** per micron site.

---

## Generating a Micron

```bash
# Generate structural_biology micron for salmonbio.wiki
npx tsx scripts/generate-micron.ts \
  --vertical=structural_biology \
  --domain=salmonbio.wiki \
  --out=./dist/salmonbio.wiki

# Available verticals:
#   structural_biology  — PDB, UniProt, crystallography
#   salmon_biotech      — salmon genetics, aquaculture
#   biosimilar          — FDA/EMA biosimilar approvals
#   genomics            — Ensembl, NCBI, CRISPR
```

---

## Deploying to Hostinger Pro

### Prerequisites

1. **Hostinger Pro Agency** plan ($29/mo, supports 100 websites)
2. Domain added in hPanel → Websites → Add Website
3. SFTP credentials from hPanel → Advanced → SSH Access
4. `lftp` installed: `brew install lftp` or `sudo apt install lftp`

### One-command deploy

```bash
chmod +x scripts/deploy-to-hostinger.sh

./scripts/deploy-to-hostinger.sh \
  --vertical=structural_biology \
  --domain=salmonbio.wiki \
  --hostinger-user=u123456789 \
  --hostinger-host=89.116.123.45
```

The script will:
1. Generate the 8-file static site into `dist/salmonbio.wiki/`
2. Prompt for SFTP password (or use `HOSTINGER_PASS` env var)
3. Mirror the dist folder to `/public_html/` via `lftp`
4. Print the live URL and a test command

### Deploying multiple microns

```bash
# Structural biology
./scripts/deploy-to-hostinger.sh \
  --vertical=structural_biology \
  --domain=structbio.claims \
  --hostinger-user=u123456789 \
  --hostinger-host=89.116.123.45

# Salmon biotech
./scripts/deploy-to-hostinger.sh \
  --vertical=salmon_biotech \
  --domain=salmonbio.wiki \
  --hostinger-user=u123456789 \
  --hostinger-host=89.116.123.45

# Biosimilar
./scripts/deploy-to-hostinger.sh \
  --vertical=biosimilar \
  --domain=biosimilar.wiki \
  --hostinger-user=u123456789 \
  --hostinger-host=89.116.123.45
```

---

## Embedding the Widget on Any Site

### Option A — iFrame (no JS required)

```html
<iframe
  src="https://truthdesk.claims/api/embed/frame?vertical=structural_biology&theme=dark"
  width="100%"
  height="480"
  style="border:none; border-radius:12px;"
  title="Truth Desk Claim Verifier"
></iframe>
```

### Option B — JS SDK floating button

```html
<script>
  window.TruthDesk = {
    config: {
      vertical: "structural_biology",
      theme: "dark",
      position: "bottom-right",
      apiBase: "https://truthdesk.claims"
    }
  };
</script>
<script src="https://truthdesk.claims/embed/sdk.js" async></script>
```

### Option C — Inline widget (micron-client.js)

```html
<div data-truth-desk data-vertical="structural_biology" data-theme="dark"></div>
<script src="https://truthdesk.claims/embed/micron-client.js"></script>
```

---

## Public API Reference

Base URL: `https://truthdesk.claims/api/public/`

### POST /verify-claim

Verify a single scientific claim.

```bash
curl -X POST https://truthdesk.claims/api/public/verify-claim \
  -H "Content-Type: application/json" \
  -d '{"claim": "Lysozyme was first crystallised in 1965 at 2.0 Å resolution."}'
```

Response:
```json
{
  "ok": true,
  "verdict": "Supported",
  "rationale": "PDB entry 1LYZ confirms lysozyme structure at 2.0 Å resolution.",
  "evidenceUrl": "https://www.rcsb.org/structure/1LYZ",
  "processedAt": "2026-06-07T12:00:00.000Z",
  "apiVersion": "1.0"
}
```

### GET /claims.json

Browse recent verified claims.

```bash
curl "https://truthdesk.claims/api/public/claims.json?limit=10&vertical=structural_biology"
```

---

## Adding a New Vertical

1. Add the vertical config to `VERTICALS` in `scripts/generate-micron.ts`
2. Add it to `ALLOWED_VERTICALS` in `server/embedRoutes.ts`
3. Register per-vertical CopilotKit actions in `server/verticalCopilotActions.ts`
4. Generate and deploy: `npx tsx scripts/generate-micron.ts --vertical=new_vertical --domain=newdomain.com`

---

## Cost Model

| Component | Cost |
|-----------|------|
| Hostinger Pro Agency | $29/mo (100 sites) |
| truthdesk.claims hosting | Included in Manus plan |
| Per micron domain (.wiki, .claims) | ~$5–15/yr |
| Per micron deployment | ~2 minutes |
| API calls (verify-claim) | Included in Manus plan |

**Cost per micron: ~$0.29/mo hosting + domain registration.**
