/**
 * embedRoutes.ts — Embed Widget endpoints
 *
 * GET /api/embed/frame?vertical=&key=&theme=  — sandboxed iFrame HTML widget
 * GET /embed/sdk.js                           — floating button JS SDK
 */

import * as fs from "fs";
import * as path from "path";
import type { Express, Request, Response } from "express";

// ─── Allowed verticals for embed ─────────────────────────────────────────────
const ALLOWED_VERTICALS = new Set([
  "structural_biology",
  "salmon_biotech",
  "protein_supplement",
  "creatine_ergogenics",
  "gut_microbiome",
  "collagen_peptides",
  "plant_based_protein",
  "sports_nutrition_rct",
  "uniprot",
  "clinical_trials",
]);

// ─── iFrame widget HTML ───────────────────────────────────────────────────────
function buildWidgetHtml(opts: {
  vertical: string;
  theme: "auto" | "light" | "dark";
  apiBase: string;
}): string {
  const { vertical, theme, apiBase } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Truth Desk — Claim Verifier</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: ${theme === "dark" ? "#0d0b12" : theme === "light" ? "#ffffff" : "light-dark(#ffffff, #0d0b12)"};
      --fg: ${theme === "dark" ? "#e8e6f0" : theme === "light" ? "#1a1a2e" : "light-dark(#1a1a2e, #e8e6f0)"};
      --accent: #7c3aed;
      --border: ${theme === "dark" ? "#2d2a3d" : theme === "light" ? "#e5e7eb" : "light-dark(#e5e7eb, #2d2a3d)"};
      --input-bg: ${theme === "dark" ? "#1a1730" : theme === "light" ? "#f9fafb" : "light-dark(#f9fafb, #1a1730)"};
      --verdict-supported: #16a34a;
      --verdict-contradicted: #dc2626;
      --verdict-partial: #d97706;
      --verdict-ambiguous: #6b7280;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d0b12; --fg: #e8e6f0; --border: #2d2a3d; --input-bg: #1a1730;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg); color: var(--fg);
      padding: 16px; min-height: 100vh;
    }
    .header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
    .logo { width: 20px; height: 20px; background: var(--accent); border-radius: 4px; }
    .title { font-size: 13px; font-weight: 600; color: var(--fg); opacity: 0.8; }
    .vertical-badge {
      margin-left: auto; font-size: 10px; padding: 2px 8px;
      background: var(--accent); color: #fff; border-radius: 12px; opacity: 0.85;
    }
    .form { display: flex; flex-direction: column; gap: 10px; }
    textarea {
      width: 100%; min-height: 80px; resize: vertical;
      background: var(--input-bg); color: var(--fg);
      border: 1px solid var(--border); border-radius: 8px;
      padding: 10px 12px; font-size: 13px; font-family: inherit;
      outline: none; transition: border-color 0.15s;
    }
    textarea:focus { border-color: var(--accent); }
    button {
      background: var(--accent); color: #fff; border: none;
      border-radius: 8px; padding: 9px 16px; font-size: 13px;
      font-weight: 600; cursor: pointer; transition: opacity 0.15s, transform 0.1s;
    }
    button:hover { opacity: 0.9; }
    button:active { transform: scale(0.97); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .result { margin-top: 12px; }
    .verdict-card {
      border: 1px solid var(--border); border-radius: 10px;
      padding: 12px 14px; font-size: 13px;
    }
    .verdict-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .verdict-badge {
      font-size: 11px; font-weight: 700; padding: 3px 10px;
      border-radius: 12px; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .badge-Supported { background: #dcfce7; color: var(--verdict-supported); }
    .badge-Contradicted { background: #fee2e2; color: var(--verdict-contradicted); }
    .badge-Partially\\ Supported { background: #fef9c3; color: var(--verdict-partial); }
    .badge-Ambiguous, .badge-Insufficient\\ Evidence { background: #f3f4f6; color: var(--verdict-ambiguous); }
    .rationale { font-size: 12px; opacity: 0.75; line-height: 1.5; }
    .evidence-link { font-size: 11px; margin-top: 6px; }
    .evidence-link a { color: var(--accent); text-decoration: none; }
    .evidence-link a:hover { text-decoration: underline; }
    .error { color: #dc2626; font-size: 12px; margin-top: 8px; }
    .spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
      border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .powered-by {
      margin-top: 14px; text-align: right; font-size: 10px; opacity: 0.4;
    }
    .powered-by a { color: inherit; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo"></div>
    <span class="title">Truth Desk — Claim Verifier</span>
    <span class="vertical-badge">${vertical.replace(/_/g, " ")}</span>
  </div>
  <div class="form">
    <textarea id="claim" placeholder="Enter a claim to verify, e.g. 'Lysozyme has a resolution of 1.5 Å in PDB 1LYZ'"></textarea>
    <button id="btn" onclick="verifyClaim()">Verify Claim</button>
  </div>
  <div class="result" id="result"></div>
  <div class="powered-by">Powered by <a href="https://truthdesk.io" target="_blank">Truth Desk</a></div>

  <script>
    const VERTICAL = ${JSON.stringify(vertical)};
    const API_BASE = ${JSON.stringify(apiBase)};

    async function verifyClaim() {
      const claim = document.getElementById('claim').value.trim();
      if (!claim) return;
      const btn = document.getElementById('btn');
      const result = document.getElementById('result');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Verifying…';
      result.innerHTML = '';
      try {
        const res = await fetch(API_BASE + '/api/public/verify-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claim, vertical: VERTICAL }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Verification failed');
        const badgeClass = 'badge-' + (data.verdict || 'Ambiguous').replace(/ /g, '\\\\ ');
        result.innerHTML = \`
          <div class="verdict-card">
            <div class="verdict-row">
              <span class="verdict-badge \${badgeClass}">\${data.verdict || 'Unknown'}</span>
              \${data.confidence != null ? '<span style="font-size:11px;opacity:0.6">Confidence: ' + Math.round(data.confidence * 100) + '%</span>' : ''}
            </div>
            <div class="rationale">\${data.rationale || ''}</div>
            \${data.evidenceUrl ? '<div class="evidence-link"><a href="' + data.evidenceUrl + '" target="_blank">View Evidence →</a></div>' : ''}
          </div>\`;
        // Broadcast to parent — restrict to same origin or configured parent origin
        const targetOrigin = window.location.ancestorOrigins?.[0] || document.referrer
          ? (new URL(document.referrer || window.location.href)).origin
          : '*';
        window.parent.postMessage({
          type: 'truthdesk:claimVerified',
          payload: { claim, verdict: data.verdict, confidence: data.confidence, vertical: VERTICAL }
        }, targetOrigin);
      } catch (e) {
        result.innerHTML = '<div class="error">⚠ ' + e.message + '</div>';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Verify Claim';
      }
    }

    // Listen for messages from parent (e.g. pre-fill claim) — validate origin
    const ALLOWED_ORIGINS = [API_BASE, window.location.origin].filter(Boolean);
    window.addEventListener('message', (e) => {
      if (!e.data || typeof e.data !== 'object') return;
      // Only accept messages from the configured API base or same origin
      const originOk = ALLOWED_ORIGINS.some(o => e.origin === o) || e.origin === window.location.origin;
      if (!originOk) return;
      if (e.data.type === 'truthdesk:setClaim') {
        const raw = String(e.data.claim || '').slice(0, 2000); // cap length
        document.getElementById('claim').value = raw;
      }
    });
  </script>
</body>
</html>`;
}

// ─── Floating button JS SDK ───────────────────────────────────────────────────
function buildSdkJs(apiBase: string): string {
  return `/* Truth Desk Embed SDK v1.0 — https://truthdesk.io */
(function(w, d) {
  'use strict';
  var TD = w.TruthDesk = w.TruthDesk || {};
  if (TD._loaded) return;
  TD._loaded = true;

  var cfg = TD.config || {};
  var vertical = cfg.vertical || 'structural_biology';
  var theme = cfg.theme || 'auto';
  var position = cfg.position || 'bottom-right';
  var apiBase = cfg.apiBase || ${JSON.stringify(apiBase)};

  // ── Inject styles ──────────────────────────────────────────────────────────
  var style = d.createElement('style');
  style.textContent = [
    '#td-widget-btn{position:fixed;z-index:2147483647;width:52px;height:52px;border-radius:50%;',
    'background:#7c3aed;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(124,58,237,.4);',
    'display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s;}',
    '#td-widget-btn:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(124,58,237,.55);}',
    '#td-widget-btn:active{transform:scale(0.95);}',
    '#td-widget-btn svg{width:24px;height:24px;fill:#fff;}',
    '#td-widget-frame{position:fixed;z-index:2147483646;width:360px;height:420px;',
    'border:none;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.25);',
    'transition:opacity .2s,transform .2s;opacity:0;pointer-events:none;transform:scale(0.95);}',
    '#td-widget-frame.td-open{opacity:1;pointer-events:auto;transform:scale(1);}',
    '.td-pos-bottom-right{bottom:24px;right:24px;}',
    '.td-pos-bottom-left{bottom:24px;left:24px;}',
    '.td-pos-top-right{top:24px;right:24px;}',
    '.td-pos-top-left{top:24px;left:24px;}',
  ].join('');
  d.head.appendChild(style);

  // ── Create button ──────────────────────────────────────────────────────────
  var btn = d.createElement('button');
  btn.id = 'td-widget-btn';
  btn.className = 'td-pos-' + position;
  btn.setAttribute('aria-label', 'Open Truth Desk claim verifier');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  d.body.appendChild(btn);

  // ── Create iFrame ──────────────────────────────────────────────────────────
  var frameUrl = apiBase + '/api/embed/frame?vertical=' + encodeURIComponent(vertical) + '&theme=' + encodeURIComponent(theme);
  var frame = d.createElement('iframe');
  frame.id = 'td-widget-frame';
  frame.className = 'td-pos-' + position;
  frame.src = frameUrl;
  frame.title = 'Truth Desk Claim Verifier';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
  // Position the frame above the button
  var posMap = { 'bottom-right': 'bottom:88px;right:24px', 'bottom-left': 'bottom:88px;left:24px',
                 'top-right': 'top:88px;right:24px', 'top-left': 'top:88px;left:24px' };
  frame.style.cssText = (posMap[position] || posMap['bottom-right']);
  d.body.appendChild(frame);

  // ── Toggle logic ───────────────────────────────────────────────────────────
  var open = false;
  btn.addEventListener('click', function() {
    open = !open;
    frame.classList.toggle('td-open', open);
    w.dispatchEvent(new CustomEvent(open ? 'truthdesk:widgetOpen' : 'truthdesk:widgetClose'));
  });

  // ── Listen for messages from iFrame ───────────────────────────────────────
  w.addEventListener('message', function(e) {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'truthdesk:claimVerified') {
      w.dispatchEvent(new CustomEvent('truthdesk:claimVerified', { detail: e.data.payload }));
    }
  });

  // ── Public API ─────────────────────────────────────────────────────────────
  TD.open = function() { open = true; frame.classList.add('td-open'); };
  TD.close = function() { open = false; frame.classList.remove('td-open'); };
  TD.setClaim = function(claim) {
    frame.contentWindow && frame.contentWindow.postMessage({ type: 'truthdesk:setClaim', claim: claim }, '*');
    if (!open) TD.open();
  };

})(window, document);
`;
}


// ─── Hostinger integration snippet ───────────────────────────────────────────
function buildHostingerJs(apiBase: string): string {
  return `/* Truth Desk Hostinger Integration v1.0
 * Fires signed events to the Truth Desk autonomous knowledge loop.
 * Add to any Hostinger-hosted page <head> or footer:
 *   <script src="${apiBase}/embed/hostinger.js" data-site-key="YOUR_SITE_KEY" async></script>
 * Get your site key from Truth Desk Settings -> Integrations -> Hostinger.
 */
(function(w, d) {
  'use strict';
  var TD_HOST = '${apiBase}';
  var script = d.currentScript || d.querySelector('script[data-site-key]');
  var SITE_KEY = (script && script.getAttribute('data-site-key')) || '';
  if (!SITE_KEY) { console.warn('[TruthDesk] Missing data-site-key attribute'); return; }

  async function hmacSign(message) {
    var enc = new TextEncoder();
    var key = await w.crypto.subtle.importKey(
      'raw', enc.encode(SITE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    var sig = await w.crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(sig)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  async function fire(eventType, payload) {
    try {
      var body = JSON.stringify({
        eventType: eventType, siteKey: SITE_KEY,
        origin: w.location.origin, url: w.location.href,
        timestamp: Date.now(), payload: payload,
      });
      var sig = await hmacSign(body);
      await fetch(TD_HOST + '/api/webhook/hostinger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TruthDesk-Signature': 'sha256=' + sig },
        body: body, keepalive: true,
      });
    } catch (e) { /* silent fail */ }
  }

  var lastQuery = '';
  function watchSearch() {
    var inputs = d.querySelectorAll('input[type="search"],input[name="s"],input[name="q"],.search-input,#search-input');
    inputs.forEach(function(inp) {
      inp.addEventListener('change', function() {
        var q = inp.value.trim();
        if (q && q !== lastQuery && q.length > 3) { lastQuery = q; fire('search_query', { searchQuery: q, vertical: 'auto' }); }
      });
    });
  }

  w.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'truthdesk:claimVerified') return;
    var p = e.data.payload || {};
    fire('claim_verified', { claimText: p.claim, verdict: p.verdict, confidence: p.confidence, vertical: p.vertical });
  });

  d.addEventListener('click', function(e) {
    var a = e.target.closest('a[href*="pubmed"],a[href*="europepmc"],a[href*="doi.org"]');
    if (!a) return;
    var href = a.href || '';
    var pmid = (href.match(/\/pubmed\/(\d+)/) || href.match(/\/articles\/PMC(\d+)/) || [])[1] || null;
    fire('paper_clicked', { url: href, pmid: pmid, title: a.textContent.trim().slice(0, 120) });
  });

  w.addEventListener('truthdesk:widgetOpen', function() { fire('widget_opened', {}); });
  w.addEventListener('truthdesk:widgetClose', function() { fire('widget_closed', {}); });
  fire('page_view', { title: d.title, path: w.location.pathname });

  if (d.readyState === 'loading') { d.addEventListener('DOMContentLoaded', watchSearch); } else { watchSearch(); }
  w.TruthDeskHostinger = { fire: fire };
})(window, document);
`;
}

// ─── Route registration ───────────────────────────────────────────────────────
export function registerEmbedRoutes(app: Express): void {
  // iFrame widget endpoint
  app.get("/api/embed/frame", (req: Request, res: Response) => {
    const vertical = (req.query.vertical as string) || "structural_biology";
    const theme = ((req.query.theme as string) || "auto") as "auto" | "light" | "dark";

    if (!ALLOWED_VERTICALS.has(vertical)) {
      res.status(400).send("Unknown vertical");
      return;
    }

    const apiBase =
      process.env.VITE_APP_URL ||
      `${req.protocol}://${req.get("host")}`;

    const html = buildWidgetHtml({ vertical, theme, apiBase });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Allow embedding from any origin but restrict capabilities.
    // X-Frame-Options ALLOWALL is non-standard; use CSP frame-ancestors instead.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' 'unsafe-inline'; connect-src *; frame-ancestors *"
    );
    res.send(html);
  });

  // Floating button JS SDK
  app.get("/embed/sdk.js", (req: Request, res: Response) => {
    const apiBase =
      process.env.VITE_APP_URL ||
      `${req.protocol}://${req.get("host")}`;
    const js = buildSdkJs(apiBase);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(js);
  });

  // Hostinger integration snippet — fires signed events to Truth Desk autonomous loop
  app.get("/embed/hostinger.js", (req: Request, res: Response) => {
    const apiBase =
      process.env.VITE_APP_URL ||
      `${req.protocol}://${req.get("host")}`;
    const js = buildHostingerJs(apiBase);
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(js);
  });

  // Micron client SDK — served for static micron sites on Hostinger
  app.get("/embed/micron-client.js", (req: Request, res: Response) => {
    // Try to serve from embed-sdk/ directory (project root)
    const sdkPath = path.resolve(process.cwd(), "embed-sdk", "micron-client.js");
    if (fs.existsSync(sdkPath)) {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400"); // 24h cache
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.sendFile(sdkPath);
    } else {
      // Fallback: redirect to the floating SDK
      res.redirect("/embed/sdk.js");
    }
  });
}
