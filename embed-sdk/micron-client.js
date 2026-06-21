/**
 * micron-client.js — Truth Desk Micron Widget SDK
 * Version: 1.0.0
 * Size target: <8KB minified
 *
 * Calls citation.manus.space public API from any static site.
 * Zero dependencies. Zero server required on the host site.
 *
 * Usage:
 *   <script src="https://citation.manus.space/embed/sdk.js"></script>
 *   <div id="truth-desk-widget" data-vertical="structural_biology" data-theme="dark"></div>
 *
 * Or programmatic:
 *   TruthDesk.init({ vertical: 'structural_biology', theme: 'dark', target: '#my-div' });
 */
(function (global) {
  "use strict";

  var API_BASE = "https://citation.manus.space";
  var VERSION = "1.0.0";

  // ─── Verdict colour map ───────────────────────────────────────────────────
  var VERDICT_STYLES = {
    Supported:           { bg: "#16a34a", color: "#fff", icon: "✓" },
    "Partially Supported":{ bg: "#ca8a04", color: "#fff", icon: "~" },
    Contradicted:        { bg: "#dc2626", color: "#fff", icon: "✗" },
    Ambiguous:           { bg: "#7c3aed", color: "#fff", icon: "?" },
    "Insufficient Evidence":{ bg: "#6b7280", color: "#fff", icon: "–" },
    "Out of Scope":      { bg: "#374151", color: "#d1d5db", icon: "○" },
  };

  // ─── Minimal CSS injected once ────────────────────────────────────────────
  var CSS = [
    ".td-widget{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;",
    "max-width:640px;border-radius:12px;overflow:hidden;",
    "box-shadow:0 4px 24px rgba(0,0,0,.18);}",
    ".td-widget.dark{background:#0f0f1a;color:#e5e7eb;}",
    ".td-widget.light{background:#fff;color:#111827;}",
    ".td-header{padding:16px 20px 12px;border-bottom:1px solid rgba(255,255,255,.08);}",
    ".td-widget.light .td-header{border-color:rgba(0,0,0,.08);}",
    ".td-logo{font-size:13px;font-weight:700;letter-spacing:.04em;opacity:.7;}",
    ".td-form{display:flex;gap:8px;padding:16px 20px;}",
    ".td-input{flex:1;padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.15);",
    "background:rgba(255,255,255,.05);color:inherit;font-size:14px;outline:none;}",
    ".td-widget.light .td-input{background:#f9fafb;border-color:#d1d5db;color:#111;}",
    ".td-input:focus{border-color:#a855f7;}",
    ".td-btn{padding:9px 16px;border-radius:8px;border:none;cursor:pointer;",
    "background:#a855f7;color:#fff;font-size:14px;font-weight:600;white-space:nowrap;}",
    ".td-btn:hover{background:#9333ea;}.td-btn:disabled{opacity:.5;cursor:not-allowed;}",
    ".td-result{padding:0 20px 16px;}.td-badge{display:inline-flex;align-items:center;",
    "gap:6px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;",
    "margin-bottom:8px;}",
    ".td-rationale{font-size:13px;line-height:1.5;opacity:.8;}",
    ".td-meta{font-size:11px;opacity:.45;margin-top:6px;}",
    ".td-recent{padding:0 20px 16px;}",
    ".td-recent-title{font-size:11px;font-weight:700;letter-spacing:.06em;",
    "text-transform:uppercase;opacity:.45;margin-bottom:8px;}",
    ".td-claim-row{display:flex;align-items:flex-start;gap:8px;padding:6px 0;",
    "border-top:1px solid rgba(255,255,255,.06);}",
    ".td-widget.light .td-claim-row{border-color:rgba(0,0,0,.06);}",
    ".td-claim-text{font-size:12px;flex:1;opacity:.75;line-height:1.4;}",
    ".td-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(168,85,247,.3);",
    "border-top-color:#a855f7;border-radius:50%;animation:td-spin .7s linear infinite;}",
    "@keyframes td-spin{to{transform:rotate(360deg)}}",
    ".td-error{padding:10px 20px;font-size:13px;color:#f87171;}",
    ".td-powered{text-align:right;padding:8px 20px;font-size:10px;opacity:.3;}",
    ".td-powered a{color:inherit;text-decoration:none;}",
    ".td-powered a:hover{opacity:.7;}",
  ].join("");

  // ─── Utility helpers ──────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function injectStyles() {
    if (global.document.getElementById("td-styles")) return;
    var s = global.document.createElement("style");
    s.id = "td-styles";
    s.textContent = CSS;
    global.document.head.appendChild(s);
  }

  // ─── API calls ────────────────────────────────────────────────────────────
  function verifyClaim(claimText, callback) {
    fetch(API_BASE + "/api/public/verify-claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim: claimText }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) { callback(null, data); })
      .catch(function (err) { callback(err, null); });
  }

  function getRecentClaims(vertical, limit, callback) {
    var url = API_BASE + "/api/public/claims.json?limit=" + (limit || 5);
    if (vertical) url += "&vertical=" + encodeURIComponent(vertical);
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) { callback(null, data); })
      .catch(function (err) { callback(err, null); });
  }

  // ─── Render helpers ───────────────────────────────────────────────────────
  function renderBadge(verdict) {
    var style = VERDICT_STYLES[verdict] || VERDICT_STYLES["Ambiguous"];
    return (
      '<span class="td-badge" style="background:' +
      style.bg +
      ";color:" +
      style.color +
      '">' +
      style.icon +
      " " +
      esc(verdict) +
      "</span>"
    );
  }

  function renderResult(data) {
    if (!data || !data.ok) {
      return '<div class="td-error">⚠ ' + esc((data && data.error) || "Verification failed") + "</div>";
    }
    var html =
      '<div class="td-result">' +
      renderBadge(data.verdict) +
      '<div class="td-rationale">' +
      esc(data.rationale || "") +
      "</div>";
    if (data.evidenceUrl) {
      html +=
        '<div class="td-meta">Source: <a href="' +
        esc(data.evidenceUrl) +
        '" target="_blank" rel="noopener">' +
        esc(data.evidenceUrl) +
        "</a></div>";
    }
    html +=
      '<div class="td-meta">Verified ' +
      new Date(data.processedAt).toLocaleString() +
      " · API v" +
      esc(data.apiVersion || "1.0") +
      "</div></div>";
    return html;
  }

  function renderRecentClaims(claims) {
    if (!claims || !claims.length) return "";
    var rows = claims
      .slice(0, 4)
      .map(function (c) {
        var style = VERDICT_STYLES[c.verdict] || VERDICT_STYLES["Ambiguous"];
        return (
          '<div class="td-claim-row">' +
          '<span class="td-badge" style="background:' +
          style.bg +
          ";color:" +
          style.color +
          ";font-size:10px;padding:2px 7px\">" +
          style.icon +
          "</span>" +
          '<span class="td-claim-text">' +
          esc(c.value || c.claim || "") +
          "</span></div>"
        );
      })
      .join("");
    return (
      '<div class="td-recent">' +
      '<div class="td-recent-title">Recent Verdicts</div>' +
      rows +
      "</div>"
    );
  }

  // ─── Widget builder ───────────────────────────────────────────────────────
  function buildWidget(container, opts) {
    var vertical = opts.vertical || "structural_biology";
    var theme = opts.theme || "dark";

    injectStyles();

    container.innerHTML =
      '<div class="td-widget ' +
      esc(theme) +
      '">' +
      '<div class="td-header">' +
      '<span class="td-logo">⬡ Truth Desk</span>' +
      "</div>" +
      '<div class="td-form">' +
      '<input class="td-input" placeholder="Enter a scientific claim to verify…" />' +
      '<button class="td-btn">Verify</button>' +
      "</div>" +
      '<div class="td-result-area"></div>' +
      '<div class="td-recent-area"></div>' +
      '<div class="td-powered"><a href="https://citation.manus.space" target="_blank" rel="noopener">Powered by Truth Desk</a></div>' +
      "</div>";

    var input = container.querySelector(".td-input");
    var btn = container.querySelector(".td-btn");
    var resultArea = container.querySelector(".td-result-area");
    var recentArea = container.querySelector(".td-recent-area");

    // Load recent claims
    getRecentClaims(vertical, 4, function (err, data) {
      if (!err && data && data.claims) {
        recentArea.innerHTML = renderRecentClaims(data.claims);
      }
    });

    // Verify on click or Enter
    function doVerify() {
      var text = input.value.trim();
      if (!text) return;
      btn.disabled = true;
      resultArea.innerHTML = '<div style="padding:10px 20px"><span class="td-spinner"></span></div>';
      verifyClaim(text, function (err, data) {
        btn.disabled = false;
        resultArea.innerHTML = err
          ? '<div class="td-error">⚠ Network error — please try again.</div>'
          : renderResult(data);
      });
    }

    btn.addEventListener("click", doVerify);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") doVerify();
    });
  }

  // ─── Auto-init from data attributes ──────────────────────────────────────
  function autoInit() {
    var els = global.document.querySelectorAll("[data-truth-desk],[id='truth-desk-widget']");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      buildWidget(el, {
        vertical: el.getAttribute("data-vertical") || "structural_biology",
        theme: el.getAttribute("data-theme") || "dark",
      });
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  global.TruthDesk = {
    version: VERSION,
    apiBase: API_BASE,

    /** Programmatic init */
    init: function (opts) {
      var target = opts.target || "#truth-desk-widget";
      var container =
        typeof target === "string"
          ? global.document.querySelector(target)
          : target;
      if (!container) {
        console.warn("[TruthDesk] Target element not found:", target);
        return;
      }
      buildWidget(container, opts);
    },

    /** Direct API access */
    verifyClaim: verifyClaim,
    getRecentClaims: getRecentClaims,

    /** Auto-init all [data-truth-desk] elements */
    autoInit: autoInit,
  };

  // Auto-init on DOM ready
  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }
})(window);
