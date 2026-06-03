import puppeteer from "puppeteer-core";
import { getAuditReportByDocument, getClaimsByDocument, getDocumentById } from "./db";

const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";

const VERDICT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Supported: { bg: "#f0fdf4", text: "#15803d", border: "#86efac" },
  Contradicted: { bg: "#fef2f2", text: "#b91c1c", border: "#fca5a5" },
  "Partially Supported": { bg: "#fffbeb", text: "#b45309", border: "#fcd34d" },
  Ambiguous: { bg: "#f5f3ff", text: "#7c3aed", border: "#c4b5fd" },
  "Insufficient Evidence": { bg: "#f8fafc", text: "#475569", border: "#cbd5e1" },
  "Out of Scope": { bg: "#f8fafc", text: "#64748b", border: "#e2e8f0" },
  "Needs Expert Review": { bg: "#fff7ed", text: "#c2410c", border: "#fdba74" },
};

function verdictStyle(verdict: string | null) {
  const c = VERDICT_COLORS[verdict ?? ""] ?? VERDICT_COLORS["Insufficient Evidence"];
  return `background:${c.bg};color:${c.text};border:1px solid ${c.border};`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function generatePdfReport(documentId: number): Promise<Buffer> {
  const [doc, claimsList, report] = await Promise.all([
    getDocumentById(documentId),
    getClaimsByDocument(documentId),
    getAuditReportByDocument(documentId),
  ]);

  if (!doc) throw new Error("Document not found");

  const verdictCounts: Record<string, number> = {};
  for (const c of claimsList) {
    const v = c.overriddenVerdict ?? c.verdict ?? "Insufficient Evidence";
    verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
  }

  const claimsHtml = claimsList
    .map((c, i) => {
      const v = c.overriddenVerdict ?? c.verdict ?? "Insufficient Evidence";
      const rationale = c.overriddenVerdict ? c.reviewNotes : c.verdictRationale;
      const confidence = c.confidenceScore != null ? Math.round(c.confidenceScore * 100) : null;
      return `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:10px 8px;font-size:11px;color:#64748b;vertical-align:top;">${i + 1}</td>
        <td style="padding:10px 8px;font-size:12px;color:#0f172a;vertical-align:top;">${escapeHtml(c.claimText)}</td>
        <td style="padding:10px 8px;vertical-align:top;">
          <span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;${verdictStyle(v)}">${escapeHtml(v)}</span>
          ${confidence != null ? `<div style="font-size:10px;color:#94a3b8;margin-top:3px;">${confidence}% confidence</div>` : ""}
        </td>
        <td style="padding:10px 8px;font-size:11px;color:#475569;vertical-align:top;">${rationale ? escapeHtml(rationale) : "<span style='color:#cbd5e1'>—</span>"}</td>
        <td style="padding:10px 8px;font-size:11px;vertical-align:top;">${c.pdbEvidenceUrl ? `<a href="${escapeHtml(c.pdbEvidenceUrl)}" style="color:#2563eb;text-decoration:underline;">PDB</a>` : "<span style='color:#cbd5e1'>—</span>"}</td>
      </tr>`;
    })
    .join("");

  const summaryRows = Object.entries(verdictCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([v, n]) => `<tr><td style="padding:4px 8px;font-size:12px;">${escapeHtml(v)}</td><td style="padding:4px 8px;font-size:12px;font-weight:600;">${n}</td></tr>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Audit Report — ${escapeHtml(doc.title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; background: #fff; font-size: 13px; }
  .page { padding: 40px 48px; max-width: 900px; margin: 0 auto; }
  .header { border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 28px; }
  .logo { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; margin-bottom: 8px; }
  h1 { font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.3; }
  .meta { font-size: 11px; color: #64748b; margin-top: 6px; }
  .section-title { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 32px; }
  .stat-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; }
  .stat-value { font-size: 26px; font-weight: 700; color: #0f172a; }
  .stat-label { font-size: 11px; color: #64748b; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; padding: 8px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
  .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
  .report-section { margin-bottom: 32px; }
  .report-text { font-size: 12px; line-height: 1.7; color: #334155; white-space: pre-wrap; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo">Protein Truth Desk · Molecular Claim Verification</div>
    <h1>${escapeHtml(doc.title)}</h1>
    <div class="meta">
      Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} &nbsp;·&nbsp;
      ${claimsList.length} claim${claimsList.length !== 1 ? "s" : ""} analysed &nbsp;·&nbsp;
      Quality tier: ${doc.qualityTier ?? "draft"}
    </div>
  </div>

  <!-- Summary stats -->
  <div class="summary-grid">
    <div class="stat-card">
      <div class="stat-value">${claimsList.length}</div>
      <div class="stat-label">Total Claims</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#15803d;">${verdictCounts["Supported"] ?? 0}</div>
      <div class="stat-label">Supported</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#b91c1c;">${verdictCounts["Contradicted"] ?? 0}</div>
      <div class="stat-label">Contradicted</div>
    </div>
  </div>

  <!-- Verdict breakdown -->
  <div class="report-section">
    <div class="section-title">Verdict Breakdown</div>
    <table>
      <thead><tr><th>Verdict</th><th>Count</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
  </div>

  ${report && (report.highRiskCount ?? 0) > 0 ? `
  <div class="report-section">
    <div class="section-title">Risk Summary</div>
    <div class="report-text" style="color:#b91c1c;">${report.highRiskCount} high-risk claim${report.highRiskCount !== 1 ? 's' : ''} identified requiring expert review.</div>
  </div>` : ""}

  <!-- Claims table -->
  <div class="report-section">
    <div class="section-title">Claim-Level Analysis</div>
    <table>
      <thead>
        <tr>
          <th style="width:28px;">#</th>
          <th>Claim</th>
          <th style="width:160px;">Verdict</th>
          <th>Rationale</th>
          <th style="width:50px;">Evidence</th>
        </tr>
      </thead>
      <tbody>${claimsHtml}</tbody>
    </table>
  </div>

  <div class="footer">
    <span>Protein Truth Desk · protein-desk-5r5rzpyg.manus.space</span>
    <span>Document ID: ${documentId} · ${new Date().toISOString()}</span>
  </div>
</div>
</body>
</html>`;

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
