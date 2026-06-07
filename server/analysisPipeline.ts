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
import { verdictForClaim, type VerdictResult, fetchPdbEntry } from "./pdbAdapter";
import { getVertical } from "./verticalAdapters/types";
import type { EvidenceResult } from "./verticalAdapters/types";
import {
  verdictForResolution,
  classifyByConfidence,
  computeFinalVerdict,
  type VerdictDecision,
} from "./verdictEngine";
import { checkPdbCompleteness, checkAdapterCompleteness } from "./completenessCheck";
import { generateHtmlReport, buildVerdictSummary, countHighRisk } from "./reportGenerator";
import { storagePut } from "./storage";
import { notifyOwner } from "./_core/notification";
import { compileDocumentToWiki } from "./wikiCompiler";
import { ingestSourceToWiki } from "./wikiEngine";
import "./verticalAdapters"; // ensure all adapters are registered
import { generatePdfReport } from "./pdfReportGenerator";
import { computeClaimTrajectory, savePrediction } from "./predictionEngine";
import { dispatchHighRiskAlert } from "./alertDispatcher";
import { notifyIndexNow, notifyIndexNowBatch, claimUrl, reportUrl } from "./seo/indexNow";
import { recordModelUsage } from "./llmProviderQuality";
import { runSelfPromptCycle } from "./selfPrompt/engine";
import { runInversePromptForEntity } from "./inversePrompt/inversePromptEngine";

export async function runAnalysisPipeline(
  documentId: number,
  rawText: string,
  userId: number,
  options?: { providerOverride?: string }
): Promise<void> {
  try {
    // 0. Tension 6: Block draft-tier documents from entering the verdict pipeline.
    //    A document is "draft" if its qualityTier is explicitly set to "draft" AND
    //    it has already been through a pipeline run (status = "complete").
    //    Fresh submissions start as "pending" and are always allowed through.
    const existingDoc = await getDocumentById(documentId);
    if (existingDoc && existingDoc.qualityTier === "draft" && existingDoc.status === "complete") {
      // Re-running on a draft that has already completed: upgrade to verified tier first.
      // This allows deliberate re-runs (e.g. after provider upgrade) while blocking
      // accidental re-entry of stale draft content.
      await updateDocumentStatus(documentId, "pending", { qualityTier: "verified" });
    }

    // 1. Extract claims
    const llmProvider = options?.providerOverride ?? getActiveLLMProvider();
    await updateDocumentStatus(documentId, "extracting", { llmProvider });
    const extracted = await extractClaims(rawText, options?.providerOverride);
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
    // 3. Validate each claim — route through vertical adapter if available, else PDB
    const allClaims = await getClaimsByDocument(documentId);
    const doc0 = await getDocumentById(documentId);
    const verticalDomain: string = (doc0 as Record<string, unknown>)?.verticalDomain as string ?? "structural_biology";
    const adapter = getVertical(verticalDomain);
    const CLAIM_CONCURRENCY = 8;
    for (let i = 0; i < allClaims.length; i += CLAIM_CONCURRENCY) {
      const batch = allClaims.slice(i, i + CLAIM_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (claim) => {
          let result: VerdictResult;
          let decision: VerdictDecision | null = null;

          if (adapter) {
            // Route through the registered vertical adapter
            const evidence: EvidenceResult = await adapter.lookupEvidence({
              claimText: claim.claimText,
              extractedValue: claim.extractedValue,
            });
            // ── Phase 79: Run completeness gate before issuing verdict ──────
            const completeness = checkAdapterCompleteness({
              found: evidence.found,
              confidenceScore: evidence.confidenceScore,
              confidenceFlags: evidence.confidenceFlags,
              sourceId: evidence.sourceId,
              sourceUrl: evidence.sourceUrl,
            });
            decision = classifyByConfidence(
              evidence.confidenceScore,
              completeness,
              evidence.sourceId,
              evidence.confidenceFlags
            );
            result = {
              verdict: decision.verdict,
              rationale: decision.rationale,
              evidenceUrl: evidence.sourceUrl,
              evidenceRaw: evidence.evidenceRaw as never,
            };
          } else if (claim.claimType === "resolution" && claim.pdbId && claim.resolution != null) {
            // ── Phase 79: Deterministic resolution verdict ─────────────────
            const pdbResult = await fetchPdbEntry(claim.pdbId);
            const completeness = checkPdbCompleteness({
              pdbId: claim.pdbId,
              found: pdbResult.found,
              entry: pdbResult.entry,
              claimType: claim.claimType,
            });
            decision = verdictForResolution(
              claim.resolution,
              pdbResult.entry?.resolution ?? null,
              claim.pdbId,
              completeness
            );
            result = {
              verdict: decision.verdict,
              rationale: decision.rationale,
              evidenceUrl: pdbResult.entry?.url ?? null,
              evidenceRaw: pdbResult.entry,
            };
          } else {
            // Fall back to PDB adapter for other claim types
            result = await verdictForClaim({
              claimType: claim.claimType,
              pdbId: claim.pdbId,
              proteinName: claim.proteinName,
              experimentalMethod: claim.experimentalMethod,
              resolution: claim.resolution ?? undefined,
              organism: claim.organism,
              ligand: claim.ligand,
              extractedValue: claim.extractedValue,
            });
            // Assign fallback method for non-deterministic paths
            decision = {
              verdict: result.verdict,
              rationale: result.rationale,
              method: "deterministic_source",
              decisionConfidence: 0.9,
              sourceCompletenessScore: 1.0,
            };
          }
          // ── FrictionEngine Output Audit (Output Critic) ─────────────────
          // After the verdict is computed, run the paper's Answer Audit loop.
          // If the audit flags the rationale as insufficient, retry once with
          // a revised prompt. Non-fatal: original verdict is used on error.
          let auditedVerdict = result.verdict;
          let auditedRationale = result.rationale;
          try {
            const { runOutputAudit } = await import("./frictionEngine");
            const auditCriteria = [
              "The rationale must cite specific evidence (PDB ID, source URL, or database entry).",
              "The verdict must be consistent with the confidence score.",
              "The rationale must not guess — say 'Insufficient Evidence' if evidence is absent.",
              "The verdict must distinguish between 'Supported', 'Partially Supported', 'Ambiguous', 'Contradicted', 'Needs Expert Review', and 'Insufficient Evidence'.",
            ];
            const auditPrompt = `Claim: ${claim.claimText}\nVerdict: ${result.verdict}\nRationale: ${result.rationale}`;
            const audit = await runOutputAudit(auditPrompt, result.rationale, auditCriteria);
            if (audit.verdict === "revise" && audit.suggestedRevision) {
              // Append the audit's suggested revision to the rationale
              auditedRationale = `${result.rationale} [Audit note: ${audit.suggestedRevision}]`;
            }
          } catch (auditErr) {
            // Non-fatal — use original verdict/rationale
            console.warn("[FrictionEngine] Pipeline output audit error (non-fatal):", auditErr);
          }
          await updateClaimVerdict(claim.id, {
            verdict: auditedVerdict,
            verdictRationale: auditedRationale,
            pdbEvidenceUrl: result.evidenceUrl ?? undefined,
            pdbEvidenceRaw: result.evidenceRaw ?? undefined,
            pdbEvidenceCheckedAt: new Date(),
            // Phase 79: record determinism provenance
            verdictMethod: decision?.method ?? "fallback",
            sourceCompletenessScore: decision?.sourceCompletenessScore ?? 1.0,
          });
          // ── Frontier Engine: Gap Detection Trigger ──────────────────────
          // When a claim returns "Insufficient Evidence", the Frontier Engine
          // detects the gap and queues evidence pursuit.
          // This is the loopback: Insufficient Evidence → Frontier → Discovery
          // → new papers → same pipeline → Supported/Contradicted.
          // The Frontier Engine NEVER writes verdicts or graph edges.
          if (auditedVerdict === "Insufficient Evidence") {
            import("./frontier/frontierEngine")
              .then(({ detectEvidenceGapForDocument }) =>
                detectEvidenceGapForDocument(documentId, 1, claim.claimText)
              )
              .catch((e) =>
                console.warn("[FrontierEngine] Gap detection trigger failed (non-fatal):", e)
              );
          }
        })
      );
      // Log any individual claim failures without aborting the whole document
      results.forEach((r, idx) => {
        if (r.status === "rejected") {
          console.warn(`[Pipeline] Claim ${batch[idx]?.id} validation failed (non-fatal):`, r.reason);
        }
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
    // Track model usage in quality scoring table (fire-and-forget)
    const isFreeModel = llmProvider === "openrouter" || llmProvider === "freellmapi";
    recordModelUsage(
      llmProvider,
      llmProvider,
      llmProvider.split(":")[0],
      isFreeModel
    ).catch(console.error);

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
    // Ping IndexNow for all claim pages (instant Bing/Perplexity re-indexing)
    notifyIndexNowBatch(finalClaims.map((c) => claimUrl(c.id))).catch(() => {/* non-fatal */});
    // Ping IndexNow for the public report page
    notifyIndexNow(reportUrl(documentId)).catch(() => {/* non-fatal */});
    // Compile wiki pages and update knowledge graph — S3 + graph entities (non-fatal)
    compileDocumentToWiki(documentId).catch((err) =>
      console.error("[Pipeline] Wiki compilation error (S3):", err)
    );
    // Ingest into DB-backed LLM wiki (non-fatal, fire-and-forget)
    if (doc) {
      ingestSourceToWiki(doc as never, finalClaims as never).catch((err) =>
        console.error("[Pipeline] Wiki engine ingest error:", err)
      );
    }
    // ── Self-Prompting Engine: Post-Pipeline Cycle ──────────────────────────
    // After the full pipeline completes, fire a self-prompt cycle so the system
    // can reason about what to do next (notify subscribers, update wiki, close
    // gaps, reindex, etc.) based on the actual verdict distribution.
    const contradictedCount2 = (summary as Record<string, number>)["Contradicted"] ?? 0;
    const insufficientCount = (summary as Record<string, number>)["Insufficient Evidence"] ?? 0;
    const eventType = contradictedCount2 > 0
      ? "contradiction_found" as const
      : insufficientCount > 0
      ? "verdict_assigned" as const
      : "verdict_assigned" as const;
    runSelfPromptCycle({
      type: eventType,
      description: `Pipeline complete for document ${documentId}: ${finalClaims.length} claims, ${contradictedCount2} contradicted, ${insufficientCount} insufficient evidence`,
      documentId,
      verdict: contradictedCount2 > 0 ? "Contradicted" : "Supported",
    }).catch((e) => console.warn("[SelfPromptEngine] Post-pipeline cycle error (non-fatal):", e));
    // ── Autonomous Loop: publish events to the event bus ─────────────────────
    import("./autonomousLoop/eventBus").then(({ publishEvent }) => {
      const eventPayload = {
        documentId,
        claimCount: finalClaims.length,
        contradictedCount: contradictedCount2,
        insufficientCount,
        verdict: contradictedCount2 > 0 ? "Contradicted" : "Supported",
      };
      publishEvent("verdict_complete", eventPayload).catch(() => {});
      if (contradictedCount2 > 0) {
        const firstContradicted = finalClaims.find((c) => c.verdict === "Contradicted");
        publishEvent("contradiction_found", { ...eventPayload, claimId: firstContradicted?.id }).catch(() => {});
      }
    }).catch(() => {});

    // ── Inverse Prompt Architecture: Supported verdicts → graph questions ──────
    // For each Supported claim linked to a known graph entity, fire the Inverse
    // Prompt Engine so verified truth seeds new testable claims.
    // Authority boundary: inversePromptEngine only writes to generated_claims
    // and coord_queue — never to the knowledge graph itself.
    const supportedClaims = finalClaims.filter((c) => c.verdict === "Supported" && (c.pdbId || c.proteinName));
    if (supportedClaims.length > 0) {
      (async () => {
        try {
          const { getDb } = await import("./db");
          const { graphEntities } = await import("../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const db = await getDb();
          if (!db) return;
          for (const claim of supportedClaims.slice(0, 3)) {
            const entityName = claim.pdbId ?? claim.proteinName ?? "";
            if (!entityName) continue;
            const [entity] = await db
              .select({ id: graphEntities.id })
              .from(graphEntities)
              .where(eq(graphEntities.canonicalName, entityName))
              .limit(1);
            if (entity) {
              runInversePromptForEntity(entity.id).catch((e) =>
                console.warn("[InversePrompt] Entity generation error (non-fatal):", e)
              );
            }
          }
        } catch (e) {
          console.warn("[InversePrompt] Entity lookup error (non-fatal):", e);
        }
      })();
    }
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
          // Dispatch high-risk alert if probability >= 0.70
          if (prediction.probabilityContradicted >= 0.70) {
            dispatchHighRiskAlert({
              claimId: claim.id,
              claimText: claim.claimText,
              documentId,
              documentTitle: doc?.title ?? "Untitled",
              verdict: claim.verdict ?? "Unknown",
              contradictionProbability: prediction.probabilityContradicted,
              confidenceScore: claim.confidenceScore ?? null,
              reportUrl: reportUrl(documentId),
            }).catch((e) => console.warn("[Pipeline] Alert dispatch error (non-fatal):", e));
          }
        }
        console.log(`[Pipeline] Predictions saved for ${finalClaims.length} claims in doc ${documentId}`);
      } catch (predErr) {
        console.warn("[Pipeline] Prediction engine error (non-fatal):", predErr);
      }
    })().catch((predErr) => console.warn("[Pipeline] Prediction IIFE error (non-fatal):", predErr));
  } catch (err) {
    console.error("[Pipeline] Error:", err);
    await updateDocumentStatus(documentId, "failed", {
      errorMessage: String(err).substring(0, 500),
      // Preserve provider info even on failure so quality pass can skip or retry
      llmProvider: getActiveLLMProvider(),
    });
  }
}

/**
 * Map an EvidenceResult from a vertical adapter to the VerdictResult shape
 * expected by updateClaimVerdict.
 */
function evidenceToVerdict(evidence: EvidenceResult, claimText: string): VerdictResult {
  if (!evidence.found) {
    return {
      verdict: "Insufficient Evidence",
      rationale: evidence.confidenceFlags.length > 0
        ? evidence.confidenceFlags.join("; ")
        : `No evidence found for: "${claimText.substring(0, 120)}"`,
      evidenceUrl: evidence.sourceUrl,
      evidenceRaw: evidence.evidenceRaw as never,
    };
  }
  // Map confidence score to verdict label
  let verdict: VerdictResult["verdict"];
  if (evidence.confidenceScore >= 0.85) {
    verdict = "Supported";
  } else if (evidence.confidenceScore >= 0.60) {
    verdict = "Partially Supported";
  } else if (evidence.confidenceScore >= 0.30) {
    verdict = "Ambiguous";
  } else {
    verdict = "Needs Expert Review";
  }
  const flags = evidence.confidenceFlags.length > 0
    ? ` Flags: ${evidence.confidenceFlags.join("; ")}`
    : "";
  return {
    verdict,
    rationale: `Source: ${evidence.sourceId ?? evidence.sourceUrl ?? "unknown"} (confidence ${(evidence.confidenceScore * 100).toFixed(0)}%).${flags}`,
    evidenceUrl: evidence.sourceUrl,
    evidenceRaw: evidence.evidenceRaw as never,
  };
}
