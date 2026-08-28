/**
 * autonomousIngest.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Autonomous Knowledge Loop — triggered after every CopilotKit tool call.
 *
 * Every time a user asks the CopilotKit assistant a question, the assistant
 * calls tools (searchPubMed, searchUniProt, verifyClaim, queryGraph, etc.).
 * This service intercepts those tool results and:
 *
 *   1. Extracts verifiable scientific claims from the raw text (PubMed
 *      abstracts + UniProt entry descriptions).
 *   2. Creates a lightweight "CopilotKit Query" document in the DB so the
 *      claims have a proper provenance anchor.
 *   3. Inserts each extracted claim and runs it through the vertical adapter
 *      verdict engine (same path as the main analysis pipeline).
 *   4. Upserts graph entities (proteins, organisms, PDB IDs, PMIDs) and
 *      edges (cites, mentions, contradicts) so the knowledge graph grows.
 *   5. Dispatches high-risk alerts if any Contradicted verdict is found.
 *   6. Publishes a `copilot_query_ingested` event into the autonomous loop
 *      event bus so downstream layers (Frontier, Dream, Self-Prompt) can react.
 *
 * All work is fire-and-forget from the caller's perspective — errors are
 * caught and logged without surfacing to the user.
 */

import { invokeLLM } from "./_core/llm";
import {
  createDocument,
  insertClaims,
  getExistingClaimTexts,
  updateDocumentStatus,
  updateClaimVerdict,
  getClaimsByDocument,
  upsertGraphEntity,
  upsertGraphRelation,
} from "./db";
import { getVertical } from "./verticalAdapters";
import { dispatchHighRiskAlert } from "./alertDispatcher";
import { publishEvent } from "./autonomousLoop/eventBus";
import { emitVerdictEvent, type IngestVerdictEvent } from "./trainingBridge";
import { reportUrl } from "./seo/indexNow";
import { logger, errData } from "./logger";
import { inferDomainFromText } from "./domainInference";
const log = logger("autonomousIngest");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PubMedResult {
  pmid: string;
  title: string;
  abstractSnippet: string;
  citationUrl: string;
  authors?: string[];
  journal?: string;
  year?: number;
}

export interface UniProtEntry {
  accession: string;
  proteinName: string;
  geneName?: string;
  organism?: string;
  function?: string;
  url: string;
}

export interface QueryResults {
  query: string;
  pubmedResults?: PubMedResult[];
  uniprotEntries?: UniProtEntry[];
  vertical?: string;
}

// ─── System user ID (same as other ingest jobs) ───────────────────────────────

const SYSTEM_USER_ID = 1;

// ─── Claim extraction from raw text via LLM ───────────────────────────────────

interface ExtractedClaim {
  claimText: string;
  claimType:
    | "protein_name"
    | "organism"
    | "pdb_id"
    | "general_molecular"
    | "ligand";
  proteinName?: string;
  organism?: string;
  pdbId?: string;
  extractedValue?: string;
}

async function extractClaimsFromText(text: string): Promise<ExtractedClaim[]> {
  if (!text || text.trim().length < 30) return [];

  const truncated = text.slice(0, 8000);
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system" as const,
          content:
            "You are a scientific claim extractor. Extract verifiable molecular biology claims from the provided text. Return a JSON array of claims. Each claim must have: claimText (full verifiable claim, max 300 chars), claimType (one of: protein_name, organism, pdb_id, general_molecular, ligand), proteinName (optional), organism (optional), pdbId (optional, 4-char format), extractedValue (optional). Extract 3-8 claims maximum. Focus on falsifiable, specific claims about proteins, structures, functions, or organisms. Extract only identifiers, accession codes, and values that appear verbatim in the text — never recall them from prior knowledge. Return ONLY valid JSON, no markdown.",
        },
        {
          role: "user" as const,
          content: `Extract verifiable scientific claims from this text:\n\n${truncated}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "claims_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              claims: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    claimText: { type: "string" },
                    claimType: { type: "string" },
                    proteinName: { type: "string" },
                    organism: { type: "string" },
                    pdbId: { type: "string" },
                    extractedValue: { type: "string" },
                  },
                  required: ["claimText", "claimType"],
                  additionalProperties: false,
                },
              },
            },
            required: ["claims"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : null;
    if (!content) return [];

    const parsed = JSON.parse(content) as { claims: ExtractedClaim[] };
    return (parsed.claims ?? [])
      .slice(0, 8)
      .filter(c => c.claimText && c.claimText.length >= 10);
  } catch (err) {
    log.warn("[autonomousIngest] Claim extraction failed:", errData(err));
    return [];
  }
}

// ─── Graph entity upsert helpers ──────────────────────────────────────────────

async function upsertEntitiesFromClaims(
  documentId: number,
  vertical: string,
  claimRows: Array<{
    id: number;
    claimText: string;
    proteinName?: string | null;
    organism?: string | null;
    pdbId?: string | null;
    verdict?: string | null;
  }>
): Promise<void> {
  // Create a document-level entity as the anchor node
  const docEntity = await upsertGraphEntity({
    entityType: "document",
    canonicalName: `doc:${documentId}`,
    firstSeenDocumentId: documentId,
    metadata: { documentId, source: "copilot_query", vertical },
  });

  for (const claim of claimRows) {
    // Protein entities
    if (claim.proteinName) {
      const proteinEntity = await upsertGraphEntity({
        entityType: "protein",
        canonicalName: claim.proteinName.slice(0, 256),
        firstSeenDocumentId: documentId,
        metadata: {
          documentId,
          claimId: claim.id,
          vertical,
          source: "copilot_query",
        },
      });
      if (proteinEntity && docEntity) {
        await upsertGraphRelation({
          sourceEntityId: docEntity.id,
          targetEntityId: proteinEntity.id,
          relationType: "cites",
          evidenceDocumentId: documentId,
          confidenceScore: 0.85,
        });
        // If contradicted, add a contradicts edge
        if (claim.verdict === "Contradicted") {
          await upsertGraphRelation({
            sourceEntityId: proteinEntity.id,
            targetEntityId: docEntity.id,
            relationType: "contradicts",
            evidenceDocumentId: documentId,
            confidenceScore: 0.9,
          });
        }
      }
    }

    // Organism entities
    if (claim.organism) {
      const orgEntity = await upsertGraphEntity({
        entityType: "organism",
        canonicalName: claim.organism.slice(0, 256),
        firstSeenDocumentId: documentId,
        metadata: { documentId, source: "copilot_query" },
      });
      if (orgEntity && docEntity) {
        await upsertGraphRelation({
          sourceEntityId: docEntity.id,
          targetEntityId: orgEntity.id,
          relationType: "related_to",
          evidenceDocumentId: documentId,
          confidenceScore: 0.75,
        });
      }
    }

    // PDB ID entities
    if (claim.pdbId) {
      const pdbEntity = await upsertGraphEntity({
        entityType: "pdb_id",
        canonicalName: claim.pdbId.toUpperCase().slice(0, 16),
        firstSeenDocumentId: documentId,
        metadata: { documentId, source: "copilot_query" },
      });
      if (pdbEntity && docEntity) {
        await upsertGraphRelation({
          sourceEntityId: docEntity.id,
          targetEntityId: pdbEntity.id,
          relationType: "cites",
          evidenceDocumentId: documentId,
          confidenceScore: 0.95,
        });
      }
    }
  }
}

// ─── Main ingest function ─────────────────────────────────────────────────────

/**
 * Process tool results from a CopilotKit query.
 * This is called fire-and-forget after every tool call.
 */
  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
export async function processQueryResults(
  results: QueryResults
): Promise<void> {
  const {
    query,
    pubmedResults = [],
    uniprotEntries = [],
    vertical: verticalOverride,
  } = results;

  // Build combined text for claim extraction
  const textParts: string[] = [];

  if (pubmedResults.length > 0) {
    textParts.push(`PubMed search results for: "${query}"`);
    for (const r of pubmedResults) {
      textParts.push(`Title: ${r.title}`);
      if (r.abstractSnippet) textParts.push(`Abstract: ${r.abstractSnippet}`);
      if (r.journal) textParts.push(`Journal: ${r.journal}`);
    }
  }

  if (uniprotEntries.length > 0) {
    textParts.push(`UniProt entries for: "${query}"`);
    for (const e of uniprotEntries) {
      textParts.push(`Protein: ${e.proteinName} (${e.accession})`);
      if (e.organism) textParts.push(`Organism: ${e.organism}`);
      if (e.function) textParts.push(`Function: ${e.function}`);
    }
  }

  if (textParts.length === 0) return; // Nothing to ingest

  const combinedText = textParts.join("\n");
  const vertical = verticalOverride ?? inferDomainFromText(combinedText);

  // Extract claims from the combined text
  const extractedClaims = await extractClaimsFromText(combinedText);
  if (extractedClaims.length === 0) {
    log.info(`[autonomousIngest] No claims extracted for query: "${query}"`);
    return;
  }

  // Build document title from query + first PMID if available
  const firstPmid = pubmedResults[0]?.pmid;
  const docTitle = firstPmid
    ? `CopilotKit Query: ${query.slice(0, 150)} [PMID:${firstPmid}]`
    : `CopilotKit Query: ${query.slice(0, 200)}`;

  // Build source URL — prefer first PubMed citation, fall back to EuropePMC search
  const sourceUrl =
    pubmedResults[0]?.citationUrl ??
    `https://europepmc.org/search?query=${encodeURIComponent(query)}`;

  // Create a document record as the provenance anchor
  let documentId: number;
  try {
    documentId = await createDocument({
      userId: SYSTEM_USER_ID,
      title: docTitle,
      rawText: combinedText.slice(0, 50000),
      sourceType: "paste",
      storageUrl: sourceUrl,
      verticalDomain: vertical,
      status: "extracting",
      llmProvider: "manus_builtin",
      qualityTier: "draft",
    });
  } catch (err) {
    log.error("[autonomousIngest] Failed to create document:", errData(err));
    return;
  }

  // Insert claims into the DB
  type ClaimTypeEnum =
    | "pdb_id"
    | "protein_name"
    | "experimental_method"
    | "resolution"
    | "organism"
    | "ligand"
    | "general_molecular";
  const validClaimTypes = new Set<string>([
    "pdb_id",
    "protein_name",
    "experimental_method",
    "resolution",
    "organism",
    "ligand",
    "general_molecular",
  ]);
  const claimInserts = extractedClaims.map(c => {
    const ct = (
      validClaimTypes.has(c.claimType) ? c.claimType : "general_molecular"
    ) as ClaimTypeEnum;
    return {
      documentId,
      claimText: c.claimText.slice(0, 2000),
      claimType: ct,
      proteinName: c.proteinName?.slice(0, 512) ?? null,
      organism: c.organism?.slice(0, 512) ?? null,
      pdbId: c.pdbId?.slice(0, 16) ?? null,
      extractedValue: c.extractedValue?.slice(0, 512) ?? null,
    } satisfies import("../drizzle/schema").InsertClaim;
  });

  // Deduplicate: skip claims whose normalised text already exists for this document
  let deduplicatedInserts = claimInserts;
  try {
    const existing = await getExistingClaimTexts(documentId);
    if (existing.size > 0) {
      const before = claimInserts.length;
      deduplicatedInserts = claimInserts.filter(
        c => !existing.has(c.claimText.trim().toLowerCase())
      );
      const skipped = before - deduplicatedInserts.length;
      if (skipped > 0) {
        log.info(`[autonomousIngest] Deduplication: skipped ${skipped} duplicate claim(s) for document ${documentId}`);
      }
    }
  } catch (dedupErr) {
    // Non-fatal: proceed with all claims if dedup query fails
    log.warn(`[autonomousIngest] Dedup check failed, inserting all claims: ${String(dedupErr)}`);
  }
  try {
    await insertClaims(deduplicatedInserts);
  } catch (err) {
    log.error("[autonomousIngest] Failed to insert claims:", errData(err));
    await updateDocumentStatus(documentId, "failed", {
      errorMessage: String(err),
    });
    return;
  }

  await updateDocumentStatus(documentId, "validating");

  // Fetch inserted claims to get their IDs
  const insertedClaims = await getClaimsByDocument(documentId);

  // Run verdict engine on each claim (concurrency-capped at 4)
  const CONCURRENCY = 4;
  const contradictedClaims: typeof insertedClaims = [];

  for (let i = 0; i < insertedClaims.length; i += CONCURRENCY) {
    const batch = insertedClaims.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async claim => {
        try {
          const adapter = getVertical(vertical);
          let verdict = "Insufficient Evidence";
          let rationale = "No adapter available for this vertical";
          let evidenceUrl: string | null = null;
          if (adapter) {
            const result = await adapter.lookupEvidence({
              claimText: claim.claimText,
              extractedValue: claim.extractedValue ?? claim.claimText,
            });
            verdict = result.found ? "Supported" : "Insufficient Evidence";
            rationale = result.evidenceRaw
              ? String(result.evidenceRaw).slice(0, 1000)
              : rationale;
            evidenceUrl = result.sourceUrl ?? null;
            // confidenceScore stored in result but not persisted here (updateClaimVerdict handles it)
          }

          await updateClaimVerdict(claim.id, {
            verdict,
            verdictRationale: rationale,
            pdbEvidenceUrl: evidenceUrl ?? undefined,
            verdictMethod: "llm_ingest",
          });

          // Emit to SLM training pipeline (fire-and-forget)
          const trainingEvent: IngestVerdictEvent = {
            claimText: claim.claimText,
            verdict,
            rationale,
            sourceUrl: evidenceUrl ?? undefined,
            domain: vertical,
            entityName: claim.proteinName ?? claim.pdbId ?? undefined,
          };
          emitVerdictEvent(trainingEvent);

          // Auto-index supported claims into TurboVec (fire-and-forget)
          if (verdict === "Supported" || verdict === "Partially Supported") {
            import("./vectorStore")
              .then(({ indexClaim }) => indexClaim(claim.id, claim.claimText))
              .catch((vecErr: unknown) =>
                log.warn(
                  `[autonomousIngest] indexClaim failed for claim ${claim.id}:`,
                  errData(vecErr)
                )
              );
          }

          if (verdict === "Contradicted") {
            contradictedClaims.push({ ...claim, verdict });
          }
        } catch (err) {
          log.warn(
            `[autonomousIngest] Verdict failed for claim ${claim.id}:`,
            errData(err)
          );
        }
      })
    );
  }

  await updateDocumentStatus(documentId, "complete", {
    claimCount: insertedClaims.length,
    qualityTier: "draft",
  });

  // Upsert graph entities and edges
  try {
    const verifiedClaims = await getClaimsByDocument(documentId);
    await upsertEntitiesFromClaims(
      documentId,
      vertical,
      verifiedClaims.map(c => ({
        id: c.id,
        claimText: c.claimText,
        proteinName: c.proteinName,
        organism: c.organism,
        pdbId: c.pdbId,
        verdict: c.verdict,
      }))
    );

    // Also upsert PMID entities for every PubMed result
    for (const pmResult of pubmedResults) {
      if (pmResult.pmid) {
        await upsertGraphEntity({
          entityType: "concept",
          canonicalName: `PMID:${pmResult.pmid}`,
          firstSeenDocumentId: documentId,
          metadata: {
            pmid: pmResult.pmid,
            title: pmResult.title.slice(0, 512),
            citationUrl: pmResult.citationUrl,
            source: "copilot_pubmed",
          },
        });
      }
    }

    // Upsert UniProt accession entities
    for (const entry of uniprotEntries) {
      if (entry.accession) {
        await upsertGraphEntity({
          entityType: "protein",
          canonicalName: entry.accession,
          firstSeenDocumentId: documentId,
          metadata: {
            accession: entry.accession,
            proteinName: entry.proteinName,
            organism: entry.organism,
            url: entry.url,
            source: "copilot_uniprot",
          },
        });
      }
    }
  } catch (err) {
    log.warn("[autonomousIngest] Graph upsert failed:", errData(err));
  }

  // Dispatch high-risk alerts for contradicted claims
  for (const claim of contradictedClaims) {
    try {
      await dispatchHighRiskAlert({
        claimId: claim.id,
        claimText: claim.claimText,
        verdict: "Contradicted",
        documentId,
        documentTitle: docTitle,
        confidenceScore: 0.8,
        contradictionProbability: 0.85,
        reportUrl: reportUrl(documentId),
      });
    } catch (err) {
      log.warn("[autonomousIngest] Alert dispatch failed:", errData(err));
    }
  }

  // Publish paper_discovered events for each PubMed result so the Frontier
  // Layer can autonomously generate follow-up hypotheses.
  for (const pmResult of pubmedResults) {
    if (pmResult.pmid) {
      publishEvent("paper_discovered", {
        pmid: pmResult.pmid,
        title: pmResult.title,
        abstractSnippet: pmResult.abstractSnippet,
        citationUrl: pmResult.citationUrl,
        journal: pmResult.journal ?? null,
        year: pmResult.year ?? null,
        documentId,
        query,
        source: "autonomousIngest",
      }).catch(() => {
        /* non-critical */
      });
    }
  }

  // Publish event to autonomous loop so downstream layers can react
  try {
    await publishEvent("document_submitted", {
      documentId,
      source: "copilot_query",
      query,
      claimCount: insertedClaims.length,
      contradictedCount: contradictedClaims.length,
      pmids: pubmedResults.map(r => r.pmid).filter(Boolean),
      uniprotAccessions: uniprotEntries.map(e => e.accession).filter(Boolean),
    });
  } catch (err) {
    log.warn("[autonomousIngest] Event publish failed:", errData(err));
  }

  log.info(
    `[autonomousIngest] ✓ Query "${query.slice(0, 60)}" → doc:${documentId}, ` +
      `${insertedClaims.length} claims, ${contradictedClaims.length} contradicted, ` +
      `${pubmedResults.length} PMIDs, ${uniprotEntries.length} UniProt entries`
  );
}

/**
 * Convenience wrapper — safe to call fire-and-forget.
 * Catches all errors so it never throws into the caller.
 */
export function triggerAutonomousIngest(results: QueryResults): void {
  processQueryResults(results).catch(err => {
    log.error(
      "[autonomousIngest] Unhandled error in processQueryResults:",
      err
    );
  });
}
