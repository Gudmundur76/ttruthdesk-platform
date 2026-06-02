/**
 * Audit Report Generator
 * Produces HTML and PDF audit reports from verified claims.
 */

import { Claim } from "../drizzle/schema";

export type VerdictSummary = Record<string, number>;

export function buildVerdictSummary(claims: Claim[]): VerdictSummary {
  const summary: VerdictSummary = {
    Supported: 0,
    Contradicted: 0,
    "Partially Supported": 0,
    Ambiguous: 0,
    "Insufficient Evidence": 0,
    "Out of Scope": 0,
    "Needs Expert Review": 0,
  };
  for (const c of claims) {
    const v = c.overriddenVerdict ?? c.verdict;
    if (v && v in summary) summary[v]++;
  }
  return summary;
}

export function countHighRisk(claims: Claim[]): number {
  return claims.filter((c) => {
    const v = c.overriddenVerdict ?? c.verdict;
    return v === "Contradicted" || v === "Needs Expert Review";
  }).length;
}

const VERDICT_COLORS: Record<string, string> = {
  Supported: "#16a34a",
  Contradicted: "#dc2626",
  "Partially Supported": "#d97706",
  Ambiguous: "#7c3aed",
  "Insufficient Evidence": "#6b7280",
  "Out of Scope": "#374151",
  "Needs Expert Review": "#0369a1",
};

const VERDICT_BG: Record<string, string> = {
  Supported: "#f0fdf4",
  Contradicted: "#fef2f2",
  "Partially Supported": "#fffbeb",
  Ambiguous: "#f5f3ff",
  "Insufficient Evidence": "#f9fafb",
  "Out of Scope": "#f3f4f6",
  "Needs Expert Review": "#eff6ff",
};

export function generateHtmlReport(params: {
  documentTitle: string;
  documentUrl: string | null;
  claims: Claim[];
  generatedAt: Date;
  reportId: number;
}): string {
  const { documentTitle, documentUrl, claims, generatedAt, reportId } = params;
  const summary = buildVerdictSummary(claims);
  const highRisk = countHighRisk(claims);
  const total = claims.length;

  const summaryRows = Object.entries(summary)
    .filter(([, count]) => count > 0)
    .map(
      ([verdict, count]) =>
        `<tr>
          <td style="padding:8px 16px;border-bottom:1px solid #e5e7eb;">
            <span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600;background:${VERDICT_BG[verdict]};color:${VERDICT_COLORS[verdict]};">${verdict}</span>
          </td>
          <td style="padding:8px 16px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">${count}</td>
          <td style="padding:8px 16px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;">${total > 0 ? Math.round((count / total) * 100) : 0}%</td>
        </tr>`
    )
    .join("");

  const claimRows = claims
    .map((c, i) => {
      const v = c.overriddenVerdict ?? c.verdict ?? "Insufficient Evidence";
      const color = VERDICT_COLORS[v] ?? "#374151";
      const bg = VERDICT_BG[v] ?? "#f9fafb";
      const isOverridden = !!c.overriddenVerdict;
      return `<tr style="background:${i % 2 === 0 ? "#fff" : "#f9fafb"}">
        <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;max-width:320px;">${escapeHtml(c.claimText)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${escapeHtml(c.claimType.replace(/_/g, " "))}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;">
          <span style="display:inline-block;padding:3px 10px;border-radius:9999px;font-size:12px;font-weight:600;background:${bg};color:${color};">${v}</span>
          ${isOverridden ? '<span style="font-size:10px;color:#7c3aed;margin-left:4px;">Overridden</span>' : ""}
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#374151;max-width:280px;">${escapeHtml(c.verdictRationale ?? "")}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:12px;">
          ${c.pdbEvidenceUrl ? `<a href="${escapeHtml(c.pdbEvidenceUrl)}" target="_blank" style="color:#0369a1;text-decoration:none;">View in PDB ↗</a>` : '<span style="color:#9ca3af;">—</span>'}
        </td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Protein Truth Desk — Audit Report #${reportId}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;background:#f8f9fa;color:#111827;}
  .page{max-width:1100px;margin:0 auto;padding:40px 24px;}
  h1{font-size:26px;font-weight:700;color:#0f172a;margin:0 0 4px;}
  .subtitle{font-size:14px;color:#6b7280;margin:0 0 32px;}
  .section{background:#fff;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:24px;overflow:hidden;}
  .section-header{padding:16px 24px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:12px;}
  .section-title{font-size:15px;font-weight:600;color:#0f172a;margin:0;}
  table{width:100%;border-collapse:collapse;}
  th{padding:10px 16px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;background:#f9fafb;border-bottom:1px solid #e5e7eb;}
  .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;}
  .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;padding:20px 24px;}
  .meta-item label{display:block;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;}
  .meta-item span{font-size:16px;font-weight:700;color:#0f172a;}
  .high-risk{color:#dc2626;}
  .footer{text-align:center;font-size:12px;color:#9ca3af;margin-top:32px;}
  @media print{body{background:#fff;}.page{padding:20px;}}
</style>
</head>
<body>
<div class="page">
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:32px;">
    <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#0f172a,#1e40af);display:flex;align-items:center;justify-content:center;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18"/></svg>
    </div>
    <div>
      <h1>Molecular Evidence Audit Report</h1>
      <p class="subtitle">Protein Truth Desk · Report #${reportId} · Generated ${generatedAt.toUTCString()}</p>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <p class="section-title">Document</p>
    </div>
    <div style="padding:16px 24px;">
      <p style="font-size:15px;font-weight:600;color:#0f172a;margin:0 0 4px;">${escapeHtml(documentTitle)}</p>
      ${documentUrl ? `<a href="${escapeHtml(documentUrl)}" style="font-size:13px;color:#0369a1;">View source document ↗</a>` : ""}
    </div>
  </div>

  <div class="section">
    <div class="section-header"><p class="section-title">Verdict Summary</p></div>
    <div class="meta">
      <div class="meta-item"><label>Total Claims</label><span>${total}</span></div>
      <div class="meta-item"><label>High-Risk</label><span class="high-risk">${highRisk}</span></div>
      <div class="meta-item"><label>Supported</label><span style="color:#16a34a;">${summary["Supported"]}</span></div>
      <div class="meta-item"><label>Contradicted</label><span style="color:#dc2626;">${summary["Contradicted"]}</span></div>
    </div>
    <table>
      <thead><tr><th>Verdict</th><th style="text-align:right">Count</th><th style="text-align:right">Share</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-header"><p class="section-title">Claim Evidence Table</p></div>
    <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>Claim</th>
            <th>Type</th>
            <th>Verdict</th>
            <th>Rationale</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>${claimRows}</tbody>
      </table>
    </div>
  </div>

  <div class="footer">
    <p>This report was generated autonomously by Protein Truth Desk using the RCSB Protein Data Bank public APIs.<br/>
    Verdicts are scoped to structural biology evidence only. Claims marked "Needs Expert Review" require human scientific judgment.<br/>
    <strong>Protein Truth Desk</strong> · Molecular Evidence Intelligence</p>
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
