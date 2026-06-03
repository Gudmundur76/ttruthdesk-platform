/**
 * analysisPipeline.ts
 *
 * Exports runAnalysisPipeline so it can be imported by both routers.ts
 * and the pubmedIngestJob.ts scheduled handler without circular deps.
 *
 * This is an exact extraction of the pipeline logic from routers.ts.
 */

import {
  updateDocumentStatus,
  insertClaims,
  getClaimsByDocument,
  getDocumentById,
  upsertAuditReport,
  updateClaimVerdict,
} from "./db";
import { extractClaims, getActiveLLMProvider } from "./claimExtractor";
import { verdictForClaim } from "./pdbAdapter";
import { generateHtmlReport, buildVerdictSummary, countHighRisk } from "./reportGenerator";
import { storagePut } from "./storage";
import { notifyOwner } from "./_core/notification";
import { compileDocumentToWiki } from "./wikiCompiler";
import { generatePdfReport } from "./pdfReportGenerator";
import { computeClaimTrajectory, savePrediction } from "./predictionEngine";

export async function runAnalysisPipeline(
  documentId: number,
  rawText: string,
  userId: number
): Promise<void> {
  try {
    // 1. Extract claims
    const llmProvider = getActiveLLMProvider();
    await updateDocumentStatus(documentId, "extracting", { llmProvider });
    const extracted = await extractClaims(rawText);
    // 2. Insert claims into DB
    const claimInserts = extracted.map((c) => ({
      documentId,
      claimText: c.claimText,
      claimType: c.claimType,
      extractedValue: c.extractedValue,
      pdbId: c.pdbId,
      proteinName: c.proteinName,
      experimentalMethod: c.experimentalMethod,
      resolution: c.resolution,
      organism: c.organism,
      ligand: c.ligand,
    }));
    await insertClaims(claimInserts as never);
    await updateDocumentStatus(documentId, "validating", { claimCount: extracted.length });
    // 3. Validate each claim against PDB
    const allClaims = await getClaimsByDocument(documentId);
    for (const claim of allClaims) {
      const result = await verdictForClaim({
        claimType: claim.claimType,
        pdbId: claim.pdbId,
        proteinName: claim.proteinName,
        experimentalMethod: claim.experimentalMethod,
        resolution: claim.resolution ?? undefined,
        organism: claim.organism,
        ligand: claim.ligand,
        extractedValue: claim.extractedValue,
      });
      await updateClaimVerdict(claim.id, {
        verdict: result.verdict,
        verdictRationale: result.rationale,
        pdbEvidenceUrl: result.evidenceUrl ?? undefined,
        pdbEvidenceRaw: result.evidenceRaw ?? undefined,
        pdbEvidenceCheckedAt: new Date(),
      });
    }
    // 4. Generate report
    await updateDocumentStatus(documentId, "generating_report");
    const doc = await getDocumentById(documentId);
    const finalClaims = await getClaimsByDocument(documentId);
    const summary = buildVerdictSummary(finalClaims as never);
    const highRisk = countHighRisk(finalClaims as never);
    const htmlContent = generateHtmlReport({
      documentTitle: doc?.title ?? "Untitled",
      documentUrl: doc?.storageUrl ?? null,
      claims: finalClaims as never,
      generatedAt: new Date(),
      reportId: documentId,
    });
    // 5. Store HTML report
    const htmlKey = `reports/${userId}/${documentId}/audit-report.html`;
    const { url: htmlUrl } = await storagePut(
      htmlKey,
      Buffer.from(htmlContent, "utf-8"),
      "text/html"
    );
    // 6. Generate PDF report (non-fatal — HTML report is the fallback)
    let pdfStorageKey: string | undefined;
    let pdfStorageUrl: string | undefined;
    try {
      const pdfBuffer = await generatePdfReport(documentId);
      const pdfKey = `reports/${userId}/${documentId}/audit-report.pdf`;
      const { url: pdfUrl } = await storagePut(pdfKey, pdfBuffer, "application/pdf");
      pdfStorageKey = pdfKey;
      pdfStorageUrl = pdfUrl;
    } catch (pdfErr) {
      console.error("[Pipeline] PDF generation failed (non-fatal):", pdfErr);
    }
    // 7. Upsert audit report record (with PDF if available)
    await upsertAuditReport({
      documentId,
      userId,
      htmlStorageKey: htmlKey,
      htmlStorageUrl: htmlUrl,
      pdfStorageKey,
      pdfStorageUrl,
      verdictSummary: summary,
      highRiskCount: highRisk,
      totalClaims: finalClaims.length,
    });
    // Mark quality tier: kimi = verified, everything else = draft (needs quality pass)
    const qualityTier = llmProvider === "kimi" ? "verified" : "draft";
    await updateDocumentStatus(documentId, "complete", {
      claimCount: finalClaims.length,
      llmProvider,
      qualityTier,
      needsReview: qualityTier !== "verified",
    });
    // Notify owner that report is ready
    const supportedCount = (summary as Record<string, number>)["Supported"] ?? 0;
    const contradictedCount = (summary as Record<string, number>)["Contradicted"] ?? 0;
    await notifyOwner({
      title: `Audit Report Ready: ${doc?.title ?? "Untitled"}`,
      content: `Document audit complete.\n\nClaims: ${finalClaims.length} total\nSupported: ${supportedCount}\nContradicted: ${contradictedCount}\nHigh-risk: ${highRisk}\n\nReport: ${htmlUrl}`,
    }).catch(() => {
      /* non-fatal */
    });
    // Compile wiki pages and update knowledge graph (non-fatal)
    compileDocumentToWiki(documentId).catch((err) =>
      console.error("[Pipeline] Wiki compilation error:", err)
    );
    // Compute claim trajectory predictions (non-fatal, fire-and-forget)
    (async () => {
      try {
        for (const claim of finalClaims) {
          if (!claim.verdict) continue;
          const prediction = await computeClaimTrajectory(claim.id, userId);
          await savePrediction({
            modelType: "claim_trajectory",
            targetClaimId: claim.id,
            targetEntityId: null,
            targetUserId: userId,
            prediction: prediction as unknown as Record<string, unknown>,
            baseRate: prediction.baseRate,
            featuresUsed: prediction.factors as unknown as Record<string, unknown>,
            validationResult: "pending",
          });
        }
        console.log(`[Pipeline] Predictions saved for ${finalClaims.length} claims in doc ${documentId}`);
      } catch (predErr) {
        console.warn("[Pipeline] Prediction engine error (non-fatal):", predErr);
      }
    })();
  } catch (err) {
    console.error("[Pipeline] Error:", err);
    await updateDocumentStatus(documentId, "failed", {
      errorMessage: String(err).substring(0, 500),
      // Preserve provider info even on failure so quality pass can skip or retry
      llmProvider: getActiveLLMProvider(),
    });
  }
}
