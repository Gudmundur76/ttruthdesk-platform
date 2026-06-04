/**
 * qualityPassJob.ts — Quality re-pass for draft corpus documents.
 *
 * Picks up documents with qualityTier = "draft" and re-runs claim extraction
 * using the premium model (Kimi K2 by default). This is the second pass of
 * the two-pass corpus strategy:
 *
 *   Pass 1 (bulk seed): FreeLLMAPI / manus_builtin → qualityTier = "draft"
 *   Pass 2 (quality pass): Kimi K2 → qualityTier = "verified"
 *
 * The job is idempotent — re-running it skips already-verified documents.
 *
 * Registered as POST /api/scheduled/quality-pass
 */

import type { Request, Response } from "express";
import { getDraftDocuments, updateDocumentStatus, deleteClaimsByDocument } from "./db";
import { runAnalysisPipeline } from "./analysisPipeline";
import { ENV } from "./_core/env";
import { notifyOwner } from "./_core/notification";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QualityPassResult {
  processed: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SYSTEM_USER_ID = 1;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ─── Core job ─────────────────────────────────────────────────────────────────

export async function runQualityPass(options: {
  batchSize?: number;
  delayMs?: number;
}): Promise<QualityPassResult> {
  // Default delay of 8s between docs to avoid free-tier rate limits across all three OpenRouter providers.
  // During off-peak hours this can be reduced to 3000ms.
  const { batchSize = 20, delayMs = 8000 } = options;
  const result: QualityPassResult = { processed: 0, skipped: 0, failed: 0, errors: [] };

  // Verify a quality LLM is available — prefer OpenRouter (Kimi K2.6 free) or fall back to direct Kimi API
  const hasOpenRouter = !!ENV.openRouterApiKey;
  const hasKimi = !!ENV.kimiApiKey;

  if (!hasOpenRouter && !hasKimi) {
    result.errors.push(
      "Neither OPENROUTER_API_KEY nor KIMI_API_KEY is set. " +
      "Quality pass requires a premium model. " +
      "Set LLM_PROVIDER=openrouter + OPENROUTER_API_KEY (free) or LLM_PROVIDER=kimi + KIMI_API_KEY."
    );
    return result;
  }

  // Determine which provider to use — prefer OpenRouter (Kimi K2.6 free) or fall back to direct Kimi API
  // Pass as an explicit parameter instead of mutating the global ENV object (which is not thread-safe)
  const providerOverride = hasOpenRouter ? "openrouter" : "kimi";
  if (hasOpenRouter) {
    console.log("[QualityPass] Using OpenRouter → moonshotai/kimi-k2.6:free");
  } else {
    console.log("[QualityPass] Using direct Kimi API");
  }

  try {
    const draftDocs = await getDraftDocuments(batchSize);

    if (draftDocs.length === 0) {
      console.log("[QualityPass] No draft documents found — corpus is fully verified.");
      return result;
    }

    const modelLabel = hasOpenRouter ? "OpenRouter/Kimi K2.6 (free)" : "Kimi K2 direct";
    console.log(`[QualityPass] Processing ${draftDocs.length} draft documents with ${modelLabel}...`);

    for (const doc of draftDocs) {
      // Skip documents that are not complete (still processing)
      if (doc.status !== "complete") {
        result.skipped++;
        continue;
      }

      // Skip documents without raw text (uploaded files without stored text)
      if (!doc.rawText) {
        result.skipped++;
        continue;
      }

      try {
        console.log(`[QualityPass] Re-processing doc ${doc.id}: "${doc.title.slice(0, 60)}..."`);

        // Delete existing claims first so the re-pass produces a clean set (no duplicates)
        await deleteClaimsByDocument(doc.id);

        // Reset status to pending so the pipeline can re-run cleanly
        await updateDocumentStatus(doc.id, "pending");

        // Re-run the full pipeline with the quality provider passed explicitly
        await runAnalysisPipeline(doc.id, doc.rawText, doc.userId ?? SYSTEM_USER_ID, { providerOverride });
        result.processed++;

        // Rate limit between documents to avoid hammering the Kimi API
        if (delayMs > 0) await delay(delayMs);
      } catch (err) {
        result.failed++;
        result.errors.push(`Doc ${doc.id}: ${String(err).slice(0, 200)}`);
        try {
          await updateDocumentStatus(doc.id, "failed", {
            errorMessage: `Quality pass failed: ${String(err).slice(0, 400)}`,
          });
        } catch {
          // Best-effort
        }
      }
    }
  } catch (outerErr) {
    console.error("[QualityPass] Unexpected error:", outerErr);
    result.errors.push(`Unexpected: ${String(outerErr).slice(0, 200)}`);
  }

  return result;
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

export async function qualityPassJobHandler(req: Request, res: Response) {
  // Basic auth guard: require the same BUILT_IN_FORGE_API_KEY used by other scheduled endpoints
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (ENV.forgeApiKey && token !== ENV.forgeApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const batchSize = Math.min(
    Math.max(1, parseInt(String(req.body?.batchSize ?? "20"), 10) || 20),
    100
  );
  const delayMs = Math.min(
    Math.max(0, parseInt(String(req.body?.delayMs ?? "2000"), 10) || 2000),
    10_000
  );

  console.log(`[QualityPass] Starting quality pass — batchSize=${batchSize}, delayMs=${delayMs}`);

  try {
    const result = await runQualityPass({ batchSize, delayMs });

    const summary =
      `Quality pass complete: ${result.processed} verified, ` +
      `${result.skipped} skipped, ${result.failed} failed`;

    console.log(`[QualityPass] ${summary}`);

    if (result.processed > 0) {
      await notifyOwner({
        title: "Quality Pass Complete",
        content: `${summary}\n\n${result.errors.length > 0 ? "Errors:\n" + result.errors.join("\n") : "No errors."}`,
      }).catch(() => {/* non-fatal */});
    }

    res.json({
      ok: true,
      ...result,
      summary,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[QualityPass] Fatal error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
