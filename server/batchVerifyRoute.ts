import type { Express, Response } from "express";
import { getDocumentById } from "./db";
import { runAnalysisPipeline } from "./analysisPipeline";

const BATCH_LIMIT = 20;
const CONCURRENCY = 3;

function apiError(res: Response, status: number, message: string) {
  return res.status(status).json({ ok: false, error: message });
}
function apiOk<T>(res: Response, data: T) {
  return res.json({ ok: true, data });
}

type BatchResult = {
  documentId: number;
  status: "queued" | "not_found" | "failed";
  error?: string;
};

/**
 * POST /api/v2/verify/batch
 *
 * Body: { documentIds: number[] }
 *
 * Runs runAnalysisPipeline() for each document concurrently (max CONCURRENCY=3).
 * Returns per-document status: "queued" | "not_found" | "failed".
 * Max 20 documents per request.
 */
export function registerBatchVerifyRoute(app: Express): void {
  app.post("/api/v2/verify/batch", async (req, res) => {
    const { documentIds } = req.body as { documentIds?: unknown };

    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return apiError(res, 400, "documentIds must be a non-empty array");
    }
    if (documentIds.length > BATCH_LIMIT) {
      return apiError(
        res,
        400,
        `documentIds must not exceed ${BATCH_LIMIT} items`
      );
    }

    const results: BatchResult[] = [];

    // Process in chunks of CONCURRENCY to avoid overloading the pipeline
    for (let i = 0; i < documentIds.length; i += CONCURRENCY) {
      const chunk = documentIds.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (docId: unknown): Promise<BatchResult> => {
          const id = Number(docId);
          const doc = await getDocumentById(id);
          if (!doc) {
            return { documentId: id, status: "not_found" };
          }
          try {
            await runAnalysisPipeline(id, doc.rawText ?? "", doc.userId ?? 0);
            return { documentId: id, status: "queued" };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { documentId: id, status: "failed", error: msg };
          }
        })
      );
      results.push(...chunkResults);
    }

    return apiOk(res, {
      total: results.length,
      results,
    });
  });
}
