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
  insertCitation,
} from "./db";
import { extractClaims, getActiveLLMProvider } from "./claimExtractor";
import { extractPassageForClaim } from "./passageExtractor";
import { classifyMisrepresentation } from "./misrepresentationClassifier";
import {
  verdictForClaim,
  type VerdictResult,
  fetchPdbEntry,
} from "./pdbAdapter";
import {
  verifyResolutionByProteinSearch,
  verifyProteinNameBySearch,
} from "./pdbLookupAdapter";
import {
  verifyStructurePredictionViaAlphaFold,
  extractUniProtAccessions,
} from "./alphafoldAdapter";
import { getVertical } from "./verticalAdapters/types";
import type { EvidenceResult } from "./verticalAdapters/types";
import {
  verdictForResolution,
  classifyByConfidence,
  type VerdictDecision,
} from "./verdictEngine";
import {
  checkPdbCompleteness,
  checkAdapterCompleteness,
} from "./completenessCheck";
import {
  generateHtmlReport,
  buildVerdictSummary,
  countHighRisk,
} from "./reportGenerator";
import { storagePut } from "./storage";
import { notifyOwner } from "./_core/notification";
import { compileDocumentToWiki } from "./wikiCompiler";
import { ingestSourceToWiki } from "./wikiEngine";
import "./verticalAdapters"; // ensure all adapters are registered
import { generatePdfReport } from "./pdfReportGenerator";
import { computeClaimTrajectory, savePrediction } from "./predictionEngine";
import { dispatchHighRiskAlert } from "./alertDispatcher";
import {
  notifyIndexNow,
  notifyIndexNowBatch,
  claimUrl,
  reportUrl,
} from "./seo/indexNow";
import { recordModelUsage } from "./llmProviderQuality";
import { runSelfPromptCycle } from "./selfPrompt/engine";
import { runInversePromptForEntity } from "./inversePrompt/inversePromptEngine";
import { analyzeCitationChain } from "./citationChainAnalyzer";
import { computeCompositeTruth } from "./compositeTruthEngine";
import { openCitationsEnrichClaim } from "./openCitationsEnricher";
import {
  verifyClaimAgainstSourcePaper,
  extractPmids,
} from "./sourcePaperAdapter";
import { setCitationGraphEnriched } from "./db";
import { logger, errData } from "./logger";
const log = logger("analysisPipeline");

// eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
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
    if (
      existingDoc &&
      existingDoc.qualityTier === "draft" &&
      existingDoc.status === "complete"
    ) {
      // Re-running on a draft that has already completed: upgrade to verified tier first.
      // This allows deliberate re-runs (e.g. after provider upgrade) while blocking
      // accidental re-entry of stale draft content.
      await updateDocumentStatus(documentId, "pending", {
        qualityTier: "verified",
      });
    }

    // 1. Extract claims — fetch domain FIRST so the extractor uses the correct prompt
    const llmProvider = options?.providerOverride ?? getActiveLLMProvider();
    await updateDocumentStatus(documentId, "extracting", { llmProvider });
    const docForDomain = await getDocumentById(documentId);
    const extractionDomain: string =
      ((docForDomain as Record<string, unknown>)?.verticalDomain as string) ??
      "structural_biology";
    const extracted = await extractClaims(
      rawText,
      options?.providerOverride,
      extractionDomain
    );
    // 2. Insert claims into DB
    const claimInserts = extracted.map(c => ({
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
    await updateDocumentStatus(documentId, "validating", {
      claimCount: extracted.length,
    });
    // 3. Validate each claim — route through vertical adapter if available, else PDB
    const allClaims = await getClaimsByDocument(documentId);
    // Re-use the domain already fetched in step 1 (avoids a redundant DB round-trip)
    const verticalDomain: string = extractionDomain;
    const adapter = getVertical(verticalDomain);
    const CLAIM_CONCURRENCY = 8;
    for (let i = 0; i < allClaims.length; i += CLAIM_CONCURRENCY) {
      const batch = allClaims.slice(i, i + CLAIM_CONCURRENCY);
      const results = await Promise.allSettled(
        // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
        batch.map(async claim => {
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
          } else if (
            claim.claimType === "resolution" &&
            claim.pdbId &&
            claim.resolution != null
          ) {
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
          } else if (
            claim.claimType === "resolution" &&
            !claim.pdbId &&
            claim.resolution != null
          ) {
            // ── Sprint 41: Resolution claim with no PDB ID — search by protein name ──
            const lookupResult = await verifyResolutionByProteinSearch({
              claimText: claim.claimText,
              proteinName: claim.proteinName ?? undefined,
              resolution: claim.resolution,
            });
            result = lookupResult ?? {
              verdict: "Insufficient Evidence",
              rationale: "No protein name extractable for resolution lookup.",
              evidenceUrl: null,
              evidenceRaw: null,
            };
            decision = {
              verdict: result.verdict,
              rationale: result.rationale,
              method: "deterministic_source",
              decisionConfidence: 0.85,
              sourceCompletenessScore: 0.9,
            };
          } else if (
            (claim.claimType === "general_molecular" ||
              claim.claimType === "protein_name") &&
            !claim.pdbId
          ) {
            // ── Sprint 41: Route general_molecular / protein_name through structuralBiology adapter ──
            const sbAdapter = getVertical("structural_biology");
            if (sbAdapter) {
              const evidence = await sbAdapter.lookupEvidence({
                claimText: claim.claimText,
                extractedValue:
                  claim.extractedValue ?? claim.proteinName ?? null,
              });
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
            } else {
              // structuralBiology adapter not registered — try protein name search
              const nameResult = await verifyProteinNameBySearch({
                claimText: claim.claimText,
                proteinName: claim.proteinName ?? undefined,
              });
              result = nameResult ?? {
                verdict: "Insufficient Evidence",
                rationale:
                  "No structural biology adapter available and protein name not found in PDB.",
                evidenceUrl: null,
                evidenceRaw: null,
              };
              decision = {
                verdict: result.verdict,
                rationale: result.rationale,
                method: "deterministic_source",
                decisionConfidence: 0.75,
                sourceCompletenessScore: 0.8,
              };
            }
          } else if (
            (claim.claimType === "protein_function" ||
              claim.claimType === "sequence" ||
              claim.claimType === "general_protein") &&
            !claim.pdbId
          ) {
            // ── Phase 137: AlphaFold pLDDT verification for protein biochemistry claims ──
            // Extract UniProt accession codes from the claim text; if found, query AlphaFold.
            const accessions = extractUniProtAccessions(claim.claimText);
            const accession = accessions[0] ?? null;
            if (accession) {
              const afVerdict = await verifyStructurePredictionViaAlphaFold(
                accession,
                claim.claimText
              );
              result = {
                verdict: afVerdict.verdict,
                rationale: afVerdict.rationale,
                evidenceUrl: afVerdict.evidenceUrl,
                evidenceRaw: afVerdict.evidenceRaw as never,
              };
              decision = {
                verdict: afVerdict.verdict,
                rationale: afVerdict.rationale,
                method: "deterministic_source",
                decisionConfidence: afVerdict.confidenceScore,
                sourceCompletenessScore: afVerdict.confidenceScore,
              };
            } else {
              // No UniProt accession — fall through to PDB adapter
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
              decision = {
                verdict: result.verdict,
                rationale: result.rationale,
                method: "deterministic_source",
                decisionConfidence: 0.7,
                sourceCompletenessScore: 0.7,
              };
            }
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
          const auditedVerdict = result.verdict;
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
            const audit = await runOutputAudit(
              auditPrompt,
              result.rationale,
              auditCriteria
            );
            if (audit.verdict === "revise" && audit.suggestedRevision) {
              // Append the audit's suggested revision to the rationale
              auditedRationale = `${result.rationale} [Audit note: ${audit.suggestedRevision}]`;
            }
          } catch (auditErr) {
            // Non-fatal — use original verdict/rationale
            log.warn(
              "[FrictionEngine] Pipeline output audit error (non-fatal):",
              errData(auditErr)
            );
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
          // ── Phase 100: Passage-level extraction (Citation-first) ────────
          // Non-fatal: if extraction fails the verdict is still persisted.
          // We fire this as a background task so it never blocks the pipeline.
          if (rawText && rawText.length > 20) {
            extractPassageForClaim(claim.claimText, rawText)
              .then(async passage => {
                if (passage) {
                  await updateClaimVerdict(claim.id, {
                    sourcePassage: passage.sourcePassage,
                    passageConfidence: passage.passageConfidence,
                    passageStartChar: passage.passageStartChar,
                    passageEndChar: passage.passageEndChar,
                  });
                  // ── Tier 2: Write citations table row ──────────────────────────────────────
                  // Map the claim verdict to a CitationType for the citations table.
                  // VERIFIED → Supported/Partially Supported
                  // CONTESTED → Contradicted/Ambiguous
                  // BEYOND_EVIDENCE → Insufficient Evidence
                  // IMPLIED → everything else (general molecular claims)
                  const verdictToCitationType = (
                    v: string
                  ):
                    | "VERIFIED"
                    | "CONTESTED"
                    | "IMPLIED"
                    | "BEYOND_EVIDENCE" => {
                    if (v === "Supported" || v === "Partially Supported")
                      return "VERIFIED";
                    if (v === "Contradicted" || v === "Ambiguous")
                      return "CONTESTED";
                    if (v === "Insufficient Evidence") return "BEYOND_EVIDENCE";
                    return "IMPLIED";
                  };
                  insertCitation({
                    claimId: claim.id,
                    documentId,
                    passageText: passage.sourcePassage,
                    passageSection: null,
                    citationType: verdictToCitationType(auditedVerdict),
                    citationConfidence: passage.passageConfidence,
                    evidenceBoundary: null,
                  }).catch(e =>
                    log.warn(
                      `[Citations] Failed to insert citation for claim ${claim.id} (non-fatal):`,
                      errData(e)
                    )
                  );
                  // ── Phase 101: Misrepresentation classification ───────────
                  // Fires only for Contradicted / Partially Supported verdicts
                  // after the source passage is available.
                  const misrep = await classifyMisrepresentation(
                    claim.claimText,
                    auditedVerdict,
                    passage.sourcePassage
                  );
                  if (misrep) {
                    await updateClaimVerdict(claim.id, {
                      misrepresentationType: misrep.misrepresentationType,
                    });
                  }
                } else {
                  // No passage found — still attempt misrepresentation classification
                  // using the raw text as fallback context (lower quality but better than nothing)
                  const misrep = await classifyMisrepresentation(
                    claim.claimText,
                    auditedVerdict,
                    null
                  );
                  if (misrep) {
                    await updateClaimVerdict(claim.id, {
                      misrepresentationType: misrep.misrepresentationType,
                    });
                  }
                }
              })
              .catch(e =>
                log.warn(
                  `[PassageExtractor] Claim ${claim.id} passage extraction failed (non-fatal):`,
                  e
                )
              );
          }
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
              .catch(e =>
                log.warn(
                  "[FrontierEngine] Gap detection trigger failed (non-fatal):",
                  e
                )
              );
          }
          // ── Quantum Provenance: Frontier Gap + Dream Layer Routing ───────
          // When a claim has quantum provenance (from molecularDiscovery adapter),
          // trigger the quantum gap detector and (for Contradicted quantum-dual
          // claims) route to the dream layer for priority re-verification.
          const evidenceRawObj = result.evidenceRaw as Record<
            string,
            unknown
          > | null;
          const qProvenanceType = evidenceRawObj?.provenance_type as
            | string
            | undefined;
          const qVqeScore = evidenceRawObj?.pic50_vqe as number | undefined;
          const qGbsSimilarity = evidenceRawObj?.similarity_search as
            | number
            | undefined;
          if (
            (qProvenanceType === "quantum-dual" ||
              qProvenanceType === "quantum-single") &&
            qVqeScore != null &&
            qGbsSimilarity != null
          ) {
            import("./frontier/gapMapper")
              .then(({ detectQuantumProvenanceGapForDocument }) =>
                detectQuantumProvenanceGapForDocument(
                  documentId,
                  claim.id,
                  qProvenanceType as "quantum-dual" | "quantum-single",
                  qVqeScore,
                  qGbsSimilarity,
                  claim.claimText
                )
              )
              .catch(e =>
                log.warn(
                  "[QuantumProvenance] Gap trigger failed (non-fatal):",
                  e
                )
              );
            if (
              auditedVerdict === "Contradicted" &&
              qProvenanceType === "quantum-dual"
            ) {
              import("./dream/contradictionSimulator")
                .then(({ routeQuantumDualContradiction }) =>
                  routeQuantumDualContradiction(
                    claim.id,
                    documentId,
                    qVqeScore,
                    qGbsSimilarity
                  )
                )
                .catch(e =>
                  log.warn(
                    "[DreamLayer] Quantum dual contradiction routing failed (non-fatal):",
                    e
                  )
                );
            }
          }
        })
      );
      // Log any individual claim failures without aborting the whole document
      results.forEach((r, idx) => {
        if (r.status === "rejected") {
          log.warn(
            `[Pipeline] Claim ${batch[idx]?.id} validation failed (non-fatal):`,
            r.reason
          );
        }
      });
    }
    // 4. Generate report
    await updateDocumentStatus(documentId, "generating_report");
    const doc = await getDocumentById(documentId);
    const finalClaims = await getClaimsByDocument(documentId);
    const summary = buildVerdictSummary(finalClaims as never);
    const highRisk = countHighRisk(finalClaims as never);
    const reportResult = generateHtmlReport({
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
      Buffer.from(reportResult.html, "utf-8"),
      "text/html"
    );
    // 6. Generate PDF report (non-fatal — HTML report is the fallback)
    let pdfStorageKey: string | undefined;
    let pdfStorageUrl: string | undefined;
    try {
      const pdfBuffer = await generatePdfReport(documentId);
      const pdfKey = `reports/${userId}/${documentId}/audit-report.pdf`;
      const { url: pdfUrl } = await storagePut(
        pdfKey,
        pdfBuffer,
        "application/pdf"
      );
      pdfStorageKey = pdfKey;
      pdfStorageUrl = pdfUrl;
    } catch (pdfErr) {
      log.error(
        "[Pipeline] PDF generation failed (non-fatal):",
        errData(pdfErr)
      );
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
    const isFreeModel =
      llmProvider === "openrouter" || llmProvider === "freellmapi";
    recordModelUsage(
      llmProvider,
      llmProvider,
      llmProvider.split(":")[0],
      isFreeModel
    ).catch(log.error);

    // Mark quality tier: kimi = verified, everything else = draft (needs quality pass)
    const qualityTier = llmProvider === "kimi" ? "verified" : "draft";
    await updateDocumentStatus(documentId, "complete", {
      claimCount: finalClaims.length,
      llmProvider,
      qualityTier,
      needsReview: qualityTier !== "verified",
    });
    // Notify owner that report is ready
    // Guard: suppress notification for zero-claim documents — these are domain-mismatch
    // artefacts (e.g. a neuroscience paper ingested before domain-aware extraction was
    // deployed). Sending 0/0/0 notifications is noise and erodes trust in the system.
    const supportedCount =
      (summary as Record<string, number>)["Supported"] ?? 0;
    const contradictedCount =
      (summary as Record<string, number>)["Contradicted"] ?? 0;
    if (finalClaims.length > 0) {
      await notifyOwner({
        title: `Audit Report Ready: ${doc?.title ?? "Untitled"}`,
        content: `Document audit complete.\n\nDomain: ${extractionDomain}\nClaims: ${finalClaims.length} total\nSupported: ${supportedCount}\nContradicted: ${contradictedCount}\nHigh-risk: ${highRisk}\n\nReport: ${htmlUrl}`,
      }).catch(() => {
        /* non-fatal */
      });
    } else {
      log.info(
        `[Pipeline] Suppressed zero-claim notification for doc ${documentId} (domain: ${extractionDomain}) — no verifiable claims extracted`
      );
    }
    // Ping IndexNow for all claim pages (instant Bing/Perplexity re-indexing)
    notifyIndexNowBatch(finalClaims.map(c => claimUrl(c.id))).catch(() => {
      /* non-fatal */
    });
    // Ping IndexNow for the public report page
    notifyIndexNow(reportUrl(documentId)).catch(() => {
      /* non-fatal */
    });
    // Compile wiki pages and update knowledge graph — S3 + graph entities (non-fatal)
    compileDocumentToWiki(documentId).catch(err =>
      log.error("[Pipeline] Wiki compilation error (S3):", errData(err))
    );
    // Ingest into DB-backed LLM wiki (non-fatal, fire-and-forget)
    if (doc) {
      ingestSourceToWiki(doc as never, finalClaims as never).catch(err =>
        log.error("[Pipeline] Wiki engine ingest error:", errData(err))
      );
    }
    // ── Self-Prompting Engine: Post-Pipeline Cycle ──────────────────────────
    // After the full pipeline completes, fire a self-prompt cycle so the system
    // can reason about what to do next (notify subscribers, update wiki, close
    // gaps, reindex, etc.) based on the actual verdict distribution.
    const contradictedCount2 =
      (summary as Record<string, number>)["Contradicted"] ?? 0;
    const insufficientCount =
      (summary as Record<string, number>)["Insufficient Evidence"] ?? 0;
    const eventType =
      contradictedCount2 > 0
        ? ("contradiction_found" as const)
        : insufficientCount > 0
          ? ("verdict_assigned" as const)
          : ("verdict_assigned" as const);
    runSelfPromptCycle({
      type: eventType,
      description: `Pipeline complete for document ${documentId}: ${finalClaims.length} claims, ${contradictedCount2} contradicted, ${insufficientCount} insufficient evidence`,
      documentId,
      verdict: contradictedCount2 > 0 ? "Contradicted" : "Supported",
    }).catch(e =>
      log.warn("[SelfPromptEngine] Post-pipeline cycle error (non-fatal):", e)
    );
    // ── Autonomous Loop: publish events to the event bus ─────────────────────
    import("./autonomousLoop/eventBus")
      .then(({ publishEvent }) => {
        const eventPayload = {
          documentId,
          claimCount: finalClaims.length,
          contradictedCount: contradictedCount2,
          insufficientCount,
          verdict: contradictedCount2 > 0 ? "Contradicted" : "Supported",
        };
        publishEvent("verdict_complete", eventPayload).catch(() => {});
        if (contradictedCount2 > 0) {
          const firstContradicted = finalClaims.find(
            c => c.verdict === "Contradicted"
          );
          publishEvent("contradiction_found", {
            ...eventPayload,
            claimId: firstContradicted?.id,
          }).catch(() => {});
        }
      })
      .catch(() => {});

    // ── Inverse Prompt Architecture: Supported verdicts → graph questions ──────
    // For each Supported claim linked to a known graph entity, fire the Inverse
    // Prompt Engine so verified truth seeds new testable claims.
    // Authority boundary: inversePromptEngine only writes to generated_claims
    // and coord_queue — never to the knowledge graph itself.
    const supportedClaims = finalClaims.filter(
      c => c.verdict === "Supported" && (c.pdbId || c.proteinName)
    );
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
              runInversePromptForEntity(entity.id).catch(e =>
                log.warn(
                  "[InversePrompt] Entity generation error (non-fatal):",
                  e
                )
              );
            }
          }
        } catch (e) {
          log.warn(
            "[InversePrompt] Entity lookup error (non-fatal):",
            errData(e)
          );
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
            featuresUsed: prediction.factors as unknown as Record<
              string,
              unknown
            >,
            validationResult: "pending",
          });
          // Dispatch high-risk alert if probability >= 0.70
          if (prediction.probabilityContradicted >= 0.7) {
            dispatchHighRiskAlert({
              claimId: claim.id,
              claimText: claim.claimText,
              documentId,
              documentTitle: doc?.title ?? "Untitled",
              verdict: claim.verdict ?? "Unknown",
              contradictionProbability: prediction.probabilityContradicted,
              confidenceScore: claim.confidenceScore ?? null,
              reportUrl: reportUrl(documentId),
            }).catch(e =>
              log.warn(
                "[Pipeline] Alert dispatch error (non-fatal):",
                errData(e)
              )
            );
          }
        }
        log.info(
          `[Pipeline] Predictions saved for ${finalClaims.length} claims in doc ${documentId}`
        );
      } catch (predErr) {
        log.warn(
          "[Pipeline] Prediction engine error (non-fatal):",
          errData(predErr)
        );
      }
    })().catch(predErr =>
      log.warn(
        "[Pipeline] Prediction IIFE error (non-fatal):",
        errData(predErr)
      )
    );
    // ── TurboVec: auto-index all verified/supported claims into FAISS sidecar ──
    // Non-fatal fire-and-forget. If the Python sidecar is unavailable the
    // vectorStore falls back to SQL FULLTEXT search automatically.
    (async () => {
      try {
        const { indexClaim } = await import("./vectorStore");
        const verifiedClaims = finalClaims.filter(
          c => c.verdict === "Supported" || c.verdict === "Partially Supported"
        );
        const _domainKey =
          ((doc as Record<string, unknown>)?.verticalDomain as string) ??
          "structural_biology";
        for (const claim of verifiedClaims) {
          await indexClaim(claim.id, claim.claimText);
        }
        if (verifiedClaims.length > 0) {
          log.info(
            `[TurboVec] Auto-indexed ${verifiedClaims.length} verified claims for doc ${documentId}`
          );
        }
      } catch (vecErr) {
        log.warn(
          "[TurboVec] Auto-indexing error (non-fatal):",
          errData(vecErr)
        );
      }
    })().catch(vecErr =>
      log.warn("[TurboVec] Auto-index IIFE error (non-fatal):", errData(vecErr))
    );
    // ── Phase 102: Citation Chain Analysis ────────────────────────────────────
    // After all per-claim tasks complete, fire citation chain analysis for the
    // document as a whole. Requires a PubMed ID on the document record.
    // Non-fatal fire-and-forget.
    (async () => {
      try {
        const chainDoc = await getDocumentById(documentId);
        const sourcePmid = (chainDoc as Record<string, unknown>)?.pubmedId as
          | string
          | undefined;
        if (!sourcePmid) return; // No PMID — skip chain analysis

        const chainClaims = await getClaimsByDocument(documentId);
        const firstClaim = chainClaims[0];
        if (!firstClaim) return;

        await analyzeCitationChain({
          documentId,
          sourcePmid,
          sourceTitle: chainDoc?.title ?? undefined,
          originalClaimId: firstClaim.id,
          originalClaimText: firstClaim.claimText,
          maxHops: 10,
        });

        log.info(
          `[CitationChain] Chain analysis complete for doc ${documentId} (PMID ${sourcePmid})`
        );
      } catch (chainErr) {
        log.warn(
          "[CitationChain] Chain analysis error (non-fatal):",
          errData(chainErr)
        );
      }
    })().catch(chainErr =>
      log.warn(
        "[CitationChain] Chain analysis IIFE error (non-fatal):",
        chainErr
      )
    );

    // ── Phase 103: Stage 7 — Composite Truth Signal ───────────────────────────
    // Runs after citation chain analysis is queued (chain data may not be ready
    // yet for brand-new documents, but we compute an initial composite signal
    // from the upstream verdict + provenance alone, and the autonomous re-eval
    // loop will recompute once chain data arrives).
    // Non-fatal fire-and-forget.
    (async () => {
      try {
        const { getCitationChainStats } = await import(
          "./citationChainAnalyzer"
        );
        const compositeDoc = await getDocumentById(documentId);
        const compositeClaims = await getClaimsByDocument(documentId);

        // Fetch chain stats for this document (may be empty if no PMID)
        const chainStats = await getCitationChainStats(documentId);

        for (const claim of compositeClaims) {
          if (!claim.verdict) continue; // Skip unvalidated claims

          // ── Stage 3.5: OpenCitations DOI enrichment (non-fatal) ────────────
          // If the claim text or extractedValue contains a DOI, look it up in
          // OpenCitations to get citation authority score and retraction flag.
          // This enriches the composite truth signal without blocking the pipeline.
          let ocCitationScore: number | null = null;
          let ocIsRetracted: boolean | null = null;
          let ocCitationCount: number | null = null;
          let ocSelfCitationFraction: number | null = null;
          try {
            const ocResult = await openCitationsEnrichClaim(
              claim.claimText,
              (claim as Record<string, unknown>).extractedValue as string | null
            );
            if (ocResult) {
              ocCitationScore = ocResult.citationAuthorityScore;
              ocIsRetracted = ocResult.isRetracted;
              ocCitationCount = ocResult.citationCount ?? null;
              ocSelfCitationFraction =
                (ocResult as { selfCitationFraction?: number | null })
                  .selfCitationFraction ?? null;
              // Phase 115: mark claim as citation-graph-enriched
              await setCitationGraphEnriched(claim.id);
            }
          } catch (ocErr) {
            log.warn(
              `[Stage3.5/OC] OpenCitations enrichment failed for claim ${claim.id} (non-fatal):`,
              errData(ocErr)
            );
          }

          // ── Phase 138: Source Paper Semantic Similarity enrichment ──
          // If the claim text contains a PMID reference, verify semantic alignment
          // with the cited abstract. This enriches the composite truth signal.
          let sourcePaperSimilarity: number | null = null;
          try {
            const pmids = extractPmids(claim.claimText);
            if (pmids.length > 0) {
              const spVerdict = await verifyClaimAgainstSourcePaper(
                claim.claimText,
                pmids[0]
              );
              sourcePaperSimilarity = spVerdict.similarityScore;
              // If the source paper strongly contradicts the claim, downgrade confidence
              if (
                spVerdict.verdict === "Insufficient Evidence" &&
                claim.verdict === "Supported"
              ) {
                log.warn(
                  `[Stage3.6/SP] Source paper similarity low (${sourcePaperSimilarity?.toFixed(2)}) for claim ${claim.id} — confidence may be overstated`
                );
              }
            }
          } catch (spErr) {
            log.warn(
              `[Stage3.6/SP] Source paper enrichment failed for claim ${claim.id} (non-fatal):`,
              errData(spErr)
            );
          }

          const result = computeCompositeTruth({
            upstreamVerdict:
              claim.verdict as import("./compositeTruthEngine").UpstreamVerdict,
            provenanceScore:
              ((claim as Record<string, unknown>).provenanceScore as
                | number
                | null) ?? null,
            chainDistortionScore:
              chainStats.totalCitingPapers > 0
                ? chainStats.maxDistortionScore
                : null,
            chainHopCount:
              chainStats.totalCitingPapers > 0
                ? chainStats.totalCitingPapers
                : null,
            citationAuthorityScore: ocCitationScore,
            isRetracted: ocIsRetracted,
            citationCount: ocCitationCount,
            selfCitationFraction: ocSelfCitationFraction,
          });

          await updateClaimVerdict(claim.id, {
            compositeTruthScore: result.score,
            compositeTruthLabel: result.label,
          });
        }

        log.info(
          `[CompositeTruth] Stage 7 complete for doc ${documentId}: ${compositeClaims.length} claims scored`
        );
        void compositeDoc; // suppress unused warning
      } catch (compErr) {
        log.warn(
          "[CompositeTruth] Stage 7 error (non-fatal):",
          errData(compErr)
        );
      }
    })().catch(compErr =>
      log.warn("[CompositeTruth] Stage 7 IIFE error (non-fatal):", compErr)
    );

    // ── Phase 106: Stage 8 — Knowledge Graph Edge Population ─────────────────
    // After composite truth signals are written, insert semantic_similar edges
    // between claims in this document and existing claims with matching entities.
    // This makes the graph grow with every submission and feeds the re-evaluation
    // loop with richer signal on the next 6-hour tick.
    // Non-fatal fire-and-forget — graph edges are advisory, not required.
    (async () => {
      try {
        const { insertGraphClaimEdge, findClaimsByTextSimilarity } =
          await import("./graphTraversal");
        const stageClaims = await getClaimsByDocument(documentId);

        let edgesCreated = 0;
        for (const claim of stageClaims) {
          if (!claim.claimText || !claim.verdict) continue;

          // Find existing claims with similar text (top 3, excluding self)
          const similar = await findClaimsByTextSimilarity(claim.claimText, {
            limit: 3,
            minScore: 0.6,
          });

          for (const match of similar) {
            if (match.claimId === claim.id) continue;
            await insertGraphClaimEdge({
              sourceClaimId: claim.id,
              targetClaimId: match.claimId,
              relationType: "semantic_similar",
              weight: match.edgeWeight ?? 0.5,
            });
            edgesCreated++;
          }
        }

        if (edgesCreated > 0) {
          log.info(
            `[GraphEdges] Stage 8 complete for doc ${documentId}: ${edgesCreated} semantic_similar edge(s) created`
          );
          // Reactive cascade — fire source_data_changed so the contradiction detector
          // re-evaluates the new edges without waiting for the weekly cron.
          import("./autonomousLoop/eventBus")
            .then(({ publishEvent }) =>
              publishEvent("source_data_changed", {
                documentId,
                edgesCreated,
              }).catch(() => {})
            )
            .catch(() => {});
        }
      } catch (graphErr) {
        log.warn("[GraphEdges] Stage 8 error (non-fatal):", errData(graphErr));
      }
    })().catch(graphErr =>
      log.warn("[GraphEdges] Stage 8 IIFE error (non-fatal):", graphErr)
    );
  } catch (err) {
    log.error("[Pipeline] Error:", errData(err));
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function evidenceToVerdict(
  evidence: EvidenceResult,
  claimText: string
): VerdictResult {
  if (!evidence.found) {
    return {
      verdict: "Insufficient Evidence",
      rationale:
        evidence.confidenceFlags.length > 0
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
  } else if (evidence.confidenceScore >= 0.6) {
    verdict = "Partially Supported";
  } else if (evidence.confidenceScore >= 0.3) {
    verdict = "Ambiguous";
  } else {
    verdict = "Needs Expert Review";
  }
  const flags =
    evidence.confidenceFlags.length > 0
      ? ` Flags: ${evidence.confidenceFlags.join("; ")}`
      : "";
  return {
    verdict,
    rationale: `Source: ${evidence.sourceId ?? evidence.sourceUrl ?? "unknown"} (confidence ${(evidence.confidenceScore * 100).toFixed(0)}%).${flags}`,
    evidenceUrl: evidence.sourceUrl,
    evidenceRaw: evidence.evidenceRaw as never,
  };
}
