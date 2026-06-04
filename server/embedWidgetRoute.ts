/**
 * embedWidgetRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers two endpoints:
 *
 *   GET /embed/widget.js
 *     A self-contained JavaScript snippet (~3 KB minified) that site owners
 *     paste into any page. It scans for <span data-truthdesk-claim="...">
 *     elements and replaces them with live verdict badges fetched from the
 *     Truth Desk API.
 *
 *   GET /embed/badge-data/:claimId
 *     JSON endpoint used by the widget to fetch badge data without CORS issues.
 *     Returns: { claimId, verdict, verdictRationale, claimText, confidenceScore }
 *
 * Usage on external sites:
 *   <script src="https://your-domain.com/embed/widget.js" async></script>
 *   <span data-truthdesk-claim="42">Loading…</span>
 *
 * Or with a text query (fuzzy match):
 *   <span data-truthdesk-query="whey protein muscle mass">Loading…</span>
 */

import type { Express, Request, Response } from "express";
import { getClaimById } from "./db";
import { findSimilarClaims } from "./claimSimilarityEngine";

// ─── Verdict colour map (matches badge route) ─────────────────────────────────

const VERDICT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Supported:              { bg: "#d1fae5", text: "#065f46", border: "#10b981" },
  "Partially Supported":  { bg: "#fef3c7", text: "#92400e", border: "#f59e0b" },
  Contradicted:           { bg: "#fee2e2", text: "#991b1b", border: "#ef4444" },
  Ambiguous:              { bg: "#f1f5f9", text: "#475569", border: "#94a3b8" },
  "Insufficient Evidence":{ bg: "#f1f5f9", text: "#475569", border: "#94a3b8" },
  "Needs Expert Review":  { bg: "#fff7ed", text: "#9a3412", border: "#f97316" },
  "Out of Scope":         { bg: "#f1f5f9", text: "#475569", border: "#94a3b8" },
};
const DEFAULT_COLOR = { bg: "#f1f5f9", text: "#475569", border: "#94a3b8" };

// ─── Badge data JSON endpoint ─────────────────────────────────────────────────

async function badgeDataHandler(req: Request, res: Response) {
  const id = parseInt(req.params.claimId, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: "Invalid claim ID" });
    return;
  }

  const claim = await getClaimById(id);
  if (!claim) {
    res.status(404).json({ error: "Claim not found" });
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300"); // 5 min cache
  res.json({
    claimId: claim.id,
    verdict: claim.verdict,
    verdictRationale: claim.verdictRationale,
    claimText: claim.claimText,
    confidenceScore: claim.confidenceScore,
  });
}

// ─── Query badge data endpoint (fuzzy match by text) ─────────────────────────

async function queryBadgeDataHandler(req: Request, res: Response) {
  const text = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!text || text.length < 5) {
    res.status(400).json({ error: "Query too short (min 5 chars)" });
    return;
  }

  const results = await findSimilarClaims(text, { threshold: 0.4, topK: 1 });
  if (!results.length) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json({ found: false });
    return;
  }

  const top = results[0];
  const claim = await getClaimById(top.claimId);
  if (!claim) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json({ found: false });
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    found: true,
    similarity: top.similarity,
    claimId: claim.id,
    verdict: claim.verdict,
    verdictRationale: claim.verdictRationale,
    claimText: claim.claimText,
    confidenceScore: claim.confidenceScore,
  });
}

// ─── Widget JS builder ────────────────────────────────────────────────────────

function buildWidgetJs(origin: string): string {
  // Build the widget script as a template string.
  // We use a self-invoking function to avoid polluting global scope.
  return `
(function() {
  'use strict';
  var BASE = '${origin}';

  var COLORS = ${JSON.stringify(VERDICT_COLORS)};
  var DEFAULT = ${JSON.stringify(DEFAULT_COLOR)};

  function getColor(verdict) {
    return COLORS[verdict] || DEFAULT;
  }

  function buildBadge(data) {
    var c = getColor(data.verdict);
    var label = data.verdict || 'Unverified';
    var score = data.confidenceScore != null ? Math.round(data.confidenceScore * 100) + '% confidence' : '';
    var link = BASE + '/claim/' + data.claimId;
    var badge = document.createElement('a');
    badge.href = link;
    badge.target = '_blank';
    badge.rel = 'noopener noreferrer';
    badge.title = data.verdictRationale || data.claimText || label;
    badge.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'gap:5px',
      'padding:2px 8px',
      'border-radius:4px',
      'border:1px solid ' + c.border,
      'background:' + c.bg,
      'color:' + c.text,
      'font-size:12px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'text-decoration:none',
      'line-height:1.5',
      'white-space:nowrap',
      'cursor:pointer',
    ].join(';');

    var dot = document.createElement('span');
    dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:' + c.border + ';flex-shrink:0';
    badge.appendChild(dot);

    var text = document.createElement('span');
    text.textContent = label;
    badge.appendChild(text);

    if (score) {
      var scoreEl = document.createElement('span');
      scoreEl.style.cssText = 'opacity:0.7;font-size:10px;margin-left:2px';
      scoreEl.textContent = '(' + score + ')';
      badge.appendChild(scoreEl);
    }

    var logo = document.createElement('span');
    logo.style.cssText = 'opacity:0.5;font-size:10px;margin-left:3px';
    logo.textContent = 'TD';
    badge.appendChild(logo);

    return badge;
  }

  function fetchAndReplace(el, url) {
    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error || data.found === false) return;
        var badge = buildBadge(data);
        el.parentNode && el.parentNode.replaceChild(badge, el);
      })
      .catch(function() { /* silently fail — never break host page */ });
  }

  function processElements() {
    // By claim ID
    var byId = document.querySelectorAll('[data-truthdesk-claim]');
    for (var i = 0; i < byId.length; i++) {
      var el = byId[i];
      var id = el.getAttribute('data-truthdesk-claim');
      if (id) fetchAndReplace(el, BASE + '/embed/badge-data/' + encodeURIComponent(id));
    }

    // By query text
    var byQuery = document.querySelectorAll('[data-truthdesk-query]');
    for (var j = 0; j < byQuery.length; j++) {
      var qEl = byQuery[j];
      var q = qEl.getAttribute('data-truthdesk-query');
      if (q) fetchAndReplace(qEl, BASE + '/embed/badge-data/query?q=' + encodeURIComponent(q));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', processElements);
  } else {
    processElements();
  }
})();
`.trim();
}

// ─── Widget JS endpoint ───────────────────────────────────────────────────────

function widgetJsHandler(req: Request, res: Response) {
  const origin = `${req.protocol}://${req.get("host")}`;
  const js = buildWidgetJs(origin);

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600"); // 1 hour cache
  res.send(js);
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerEmbedWidgetRoutes(app: Express) {
  app.get("/embed/widget.js", widgetJsHandler);
  app.get("/embed/badge-data/query", queryBadgeDataHandler);
  app.get("/embed/badge-data/:claimId", badgeDataHandler);
}
