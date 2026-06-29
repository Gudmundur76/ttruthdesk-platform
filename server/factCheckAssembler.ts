/**
 * factCheckAssembler.ts — FactCheckAssembler
 *
 * Assembles a structured fact-check document from a completed document analysis.
 * Produces the same format as the Ornith-1.0 fact-check PDF (Fact-Check___Ornith_1.pdf):
 *
 *   1. Preamble — context, scope, and methodology
 *   2. Per-claim verdicts with source references and distortion analysis
 *   3. Overall verdict with confidence score
 *   4. Relevance analysis — how the claims relate to the broader topic
 *
 * Uses Kimi K2 (via invokeMultiLLM with "kimi" providerOverride) for all LLM calls.
 * Persists results to the documents and claims tables via the new schema fields.
 */

import { invokeMultiLLM, extractLLMText } from "./_core/multiLLM";
import { getDocumentById, getClaimsByDocument, getDb } from "./db";
import { documents, claims } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const log = logger("factCheckAssembler");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SourceRef {
  title: string;
  url?: string;
  doi?: string;
  year?: number;
  relevanceNote: string;
}

export interface ClaimFactCheck {
  claimId: number;
  claimText: string;
  verdict: string;
  confidence: number;
  sourceRefs: SourceRef[];
  distortionNote?: string;
  evidenceSummary: string;
}

export interface FactCheckDocument {
  documentId: number;
  title: string;
  factCheckPreamble: string;
  claimFactChecks: ClaimFactCheck[];
  overallVerdict: string;
  overallConfidence: number;
  relevanceAnalysis: string;
  assembledAt: string;
}

// ─── FactCheckAssembler ───────────────────────────────────────────────────────

export class FactCheckAssembler {
  /**
   * Assemble a complete fact-check document for the given document ID.
   * Persists results to the DB and returns the assembled document.
   */
  public async assemble(documentId: number): Promise<FactCheckDocument> {
    const doc = await getDocumentById(documentId);
    if (!doc) throw new Error(`Document ${documentId} not found`);

    const claimRows = await getClaimsByDocument(documentId);
    if (claimRows.length === 0) {
      throw new Error(`Document ${documentId} has no claims to fact-check`);
    }

    log.info("Assembling fact-check document", {
      documentId,
      claimCount: claimRows.length,
    });

    // Step 1: Generate preamble
    const preamble = await this.generatePreamble(
      doc.title ?? "Untitled",
      ((doc as Record<string, unknown>).rawText as string) ?? ""
    );

    // Step 2: Enrich each claim with source refs (batch via Kimi)
    const claimFactChecks = await this.enrichClaims(claimRows);

    // Step 3: Generate overall verdict
    const { overallVerdict, overallConfidence } =
      await this.generateOverallVerdict(
        doc.title ?? "Untitled",
        claimFactChecks
      );

    // Step 4: Generate relevance analysis
    const relevanceAnalysis = await this.generateRelevanceAnalysis(
      doc.title ?? "Untitled",
      claimFactChecks
    );

    // Step 5: Persist to DB
    await this.persistToDb(
      documentId,
      claimFactChecks,
      preamble,
      overallVerdict,
      relevanceAnalysis
    );

    const result: FactCheckDocument = {
      documentId,
      title: doc.title ?? "Untitled",
      factCheckPreamble: preamble,
      claimFactChecks,
      overallVerdict,
      overallConfidence,
      relevanceAnalysis,
      assembledAt: new Date().toISOString(),
    };

    log.info("Fact-check assembly complete", {
      documentId,
      overallVerdict,
      overallConfidence,
    });
    return result;
  }

  // ─── Private: generation steps ───────────────────────────────────────────

  private async generatePreamble(
    title: string,
    rawText: string
  ): Promise<string> {
    const response = await invokeMultiLLM(
      {
        messages: [
          {
            role: "system",
            content:
              "You are a scientific fact-checker. Write a concise preamble (3–5 sentences) for a fact-check report. " +
              "Describe the document's subject, the scope of the analysis, and the methodology used (citation chain analysis, distortion scoring).",
          },
          {
            role: "user",
            content: `Document title: ${title}\n\nDocument excerpt (first 800 chars):\n${rawText.slice(0, 800)}`,
          },
        ],
        max_tokens: 300,
      },
      "quality",
      "kimi"
    );
    return extractLLMText(response);
  }

  private async enrichClaims(
    claimRows: Awaited<ReturnType<typeof getClaimsByDocument>>
  ): Promise<ClaimFactCheck[]> {
    const results: ClaimFactCheck[] = [];
    for (const claim of claimRows) {
      if (!claim.claimText) continue;
      const enriched = await this.enrichOneClaim(claim);
      results.push(enriched);
    }
    return results;
  }

  private async enrichOneClaim(
    claim: Awaited<ReturnType<typeof getClaimsByDocument>>[number]
  ): Promise<ClaimFactCheck> {
    const confidenceScore =
      ((claim as Record<string, unknown>).confidenceScore as number | null) ??
      null;
    const response = await invokeMultiLLM(
      {
        messages: [
          {
            role: "system",
            content:
              "You are a scientific fact-checker. For the given claim and its verdict, identify 1–3 key source references " +
              "that support or contradict the verdict. Respond with valid JSON only: " +
              '{ "sourceRefs": [{"title": string, "url"?: string, "doi"?: string, "year"?: number, "relevanceNote": string}], ' +
              '"evidenceSummary": string, "distortionNote"?: string }',
          },
          {
            role: "user",
            content:
              `Claim: ${claim.claimText}\n` +
              `Verdict: ${claim.verdict ?? "Unknown"}\n` +
              `Confidence: ${confidenceScore ?? "N/A"}\n` +
              `Evidence URL: ${claim.pdbEvidenceUrl ?? "N/A"}`,
          },
        ],
        max_tokens: 512,
      },
      "quality",
      "kimi"
    );

    const raw = extractLLMText(response);
    let parsed: {
      sourceRefs?: SourceRef[];
      evidenceSummary?: string;
      distortionNote?: string;
    } = {};
    try {
      // Strip markdown code fences if present
      const jsonStr = raw
        .replace(/^```json\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = { sourceRefs: [], evidenceSummary: raw };
    }

    return {
      claimId: claim.id,
      claimText: claim.claimText,
      verdict: claim.verdict ?? "Unknown",
      confidence: typeof confidenceScore === "number" ? confidenceScore : 0.5,
      sourceRefs: parsed.sourceRefs ?? [],
      distortionNote: parsed.distortionNote,
      evidenceSummary: parsed.evidenceSummary ?? "",
    };
  }

  private async generateOverallVerdict(
    title: string,
    claimFactChecks: ClaimFactCheck[]
  ): Promise<{ overallVerdict: string; overallConfidence: number }> {
    const verdictSummary = claimFactChecks
      .map(
        c =>
          `- ${c.claimText.slice(0, 100)}: ${c.verdict} (confidence: ${c.confidence.toFixed(2)})`
      )
      .join("\n");

    const response = await invokeMultiLLM(
      {
        messages: [
          {
            role: "system",
            content:
              "You are a scientific fact-checker. Based on the per-claim verdicts, produce an overall verdict for the document. " +
              'Respond with valid JSON only: { "verdict": string, "confidence": number (0-1), "rationale": string }',
          },
          {
            role: "user",
            content: `Document: ${title}\n\nPer-claim verdicts:\n${verdictSummary}`,
          },
        ],
        max_tokens: 256,
      },
      "quality",
      "kimi"
    );

    const raw = extractLLMText(response);
    let parsed: { verdict?: string; confidence?: number } = {};
    try {
      const jsonStr = raw
        .replace(/^```json\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = { verdict: raw.slice(0, 100), confidence: 0.5 };
    }

    return {
      overallVerdict: parsed.verdict ?? "Inconclusive",
      overallConfidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
    };
  }

  private async generateRelevanceAnalysis(
    title: string,
    claimFactChecks: ClaimFactCheck[]
  ): Promise<string> {
    const claimSummary = claimFactChecks
      .slice(0, 10)
      .map(c => `- ${c.claimText.slice(0, 120)} [${c.verdict}]`)
      .join("\n");

    const response = await invokeMultiLLM(
      {
        messages: [
          {
            role: "system",
            content:
              "You are a scientific fact-checker. Write a relevance analysis (3–5 sentences) explaining how the verified claims " +
              "relate to the broader scientific topic and what the overall pattern of evidence suggests.",
          },
          {
            role: "user",
            content: `Document: ${title}\n\nVerified claims:\n${claimSummary}`,
          },
        ],
        max_tokens: 300,
      },
      "quality",
      "kimi"
    );

    return extractLLMText(response);
  }

  // ─── Private: persistence ─────────────────────────────────────────────────

  private async persistToDb(
    documentId: number,
    claimFactChecks: ClaimFactCheck[],
    preamble: string,
    overallVerdict: string,
    relevanceAnalysis: string
  ): Promise<void> {
    const db = await getDb();
    if (!db) return;

    // Update document with preamble, overall verdict, and relevance analysis
    await db
      .update(documents)
      .set({
        factCheckPreamble: preamble,
        overallVerdict,
        relevanceAnalysis,
      })
      .where(eq(documents.id, documentId));

    // Update each claim with its source refs
    for (const fc of claimFactChecks) {
      await db
        .update(claims)
        .set({ sourceRefs: JSON.stringify(fc.sourceRefs) })
        .where(eq(claims.id, fc.claimId));
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const factCheckAssembler = new FactCheckAssembler();
