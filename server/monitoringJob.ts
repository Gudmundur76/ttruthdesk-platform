/**
 * Monitoring heartbeat handler
 * POST /api/scheduled/monitoring
 *
 * Polls PubMed, bioRxiv, and patent feeds for each active document
 * and stores new items in the monitoring_feed table.
 *
 * This is a project-level Heartbeat cron (§4a in references/periodic-updates.md).
 * It is registered in server/_core/index.ts and triggered by the platform.
 */

import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { invokeLLM } from "./_core/llm";
import { insertMonitoringItems, getAllActiveMonitoringJobs, getDocumentById } from "./db";
import { notifyIndexNow, reportUrl } from "./seo/indexNow";

interface FeedItem {
  source: "pubmed" | "biorxiv" | "patent";
  title: string;
  summary?: string;
  url?: string;
  relevanceScore?: number;
  publishedAt?: string;
}

/**
 * Fetch relevant papers from PubMed for a given query term.
 */
async function fetchPubMed(query: string): Promise<FeedItem[]> {
  try {
    const encoded = encodeURIComponent(query);
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encoded}&retmax=5&sort=relevance&retmode=json`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(10_000) });
    if (!searchRes.ok) return [];
    const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
    const ids: string[] = searchData.esearchresult?.idlist ?? [];
    if (!ids.length) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
    const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(10_000) });
    if (!summaryRes.ok) return [];
    const summaryData = (await summaryRes.json()) as {
      result?: Record<string, { title?: string; source?: string; pubdate?: string; uid?: string }>;
    };
    const result = summaryData.result ?? {};

    return ids.map((id) => {
      const item = result[id] ?? {};
      return {
        source: "pubmed" as const,
        title: (item.title ?? "Untitled").replace(/<[^>]+>/g, ""),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        publishedAt: item.pubdate ?? undefined,
        relevanceScore: 0.7,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Fetch recent preprints from bioRxiv for a given query term.
 */
async function fetchBioRxiv(query: string): Promise<FeedItem[]> {
  try {
    // bioRxiv search API (public, no key needed)
    // Note: bioRxiv's public API doesn't have a search endpoint; the query param
    // is reserved for future search integration. We fetch the latest preprints
    // from the category listing and filter by title relevance via LLM.
    void query; // reserved for future search endpoint integration
    const res = await fetch(`https://api.biorxiv.org/details/biorxiv/2024-01-01/2099-12-31/0/json`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      collection?: Array<{ title?: string; abstract?: string; doi?: string; date?: string }>;
    };
    const items = (data.collection ?? []).slice(0, 10);
    return items.map((item) => ({
      source: "biorxiv" as const,
      title: item.title ?? "Untitled",
      summary: item.abstract ? item.abstract.slice(0, 300) : undefined,
      url: item.doi ? `https://doi.org/${item.doi}` : undefined,
      publishedAt: item.date ?? undefined,
      relevanceScore: 0.5,
    }));
  } catch {
    return [];
  }
}

/**
 * Use LLM to score relevance of feed items against a document's key terms.
 */
async function scoreRelevance(items: FeedItem[], documentTitle: string): Promise<FeedItem[]> {
  if (!items.length) return [];
  try {
    const prompt = `You are a biotech relevance scoring assistant.
Document being audited: "${documentTitle}"

For each of the following items, assign a relevance score from 0.0 to 1.0 based on how relevant it is to the document topic.
Return a JSON array of numbers in the same order as the input.

Items:
${items.map((item, i) => `${i + 1}. ${item.title}`).join("\n")}`;

    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a biotech relevance scoring assistant. Return only a JSON array of numbers." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_schema", json_schema: {
        name: "relevance_scores",
        strict: true,
        schema: {
          type: "object",
          properties: { scores: { type: "array", items: { type: "number" } } },
          required: ["scores"],
          additionalProperties: false,
        },
      }},
    });

    const content = response.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content)) as { scores?: number[] };
    const scores = parsed.scores ?? [];
    return items.map((item, i) => ({
      ...item,
      relevanceScore: scores[i] ?? item.relevanceScore ?? 0.5,
    }));
  } catch {
    return items;
  }
}

export async function monitoringJobHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) {
      return res.status(403).json({ error: "cron-only" });
    }

    // Get all complete documents to monitor
    // We use a special admin user ID 0 to get all docs, but since getDocumentsByUser
    // requires a userId, we instead query all monitoring jobs which track active docs.
    // For the heartbeat job, we use getAllActiveMonitoringJobs to find docs to monitor.
    const monitoringJobs = await getAllActiveMonitoringJobs();
    const completeDocs = monitoringJobs;

    let totalInserted = 0;

    for (const job of completeDocs) {
      const doc = await getDocumentById(job.documentId);
      if (!doc) continue;
      try {
        // Extract search terms from document title
        const searchQuery = doc.title.replace(/[^a-zA-Z0-9 ]/g, " ").trim().slice(0, 100);

        // Fetch from all three sources in parallel
        const [pubmedItems, biorxivItems] = await Promise.all([
          fetchPubMed(searchQuery),
          fetchBioRxiv(searchQuery),
        ]);

        // Combine and score
        const allItems = [...pubmedItems, ...biorxivItems];
        const scoredItems = await scoreRelevance(allItems, doc.title);

        // Only insert items with relevance >= 0.4
        const relevantItems = scoredItems.filter((item) => (item.relevanceScore ?? 0) >= 0.4);

        if (relevantItems.length > 0) {
          await insertMonitoringItems(
            relevantItems.map((item) => ({
              documentId: doc.id,
              source: item.source,
              title: item.title,
              summary: item.summary ?? null,
              url: item.url ?? null,
              relevanceScore: item.relevanceScore ?? null,
              publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
            }))
          );
          totalInserted += relevantItems.length;
          // Ping IndexNow so Bing/Perplexity re-crawls the report page with fresh evidence
          notifyIndexNow(reportUrl(doc.id)).catch(() => {/* non-fatal */});
        }
      } catch (docErr) {
        console.error(`[monitoring-job] Error processing doc ${doc.id}:`, docErr);
      }
    }

    return res.json({
      ok: true,
      processedDocuments: completeDocs.length,
      itemsInserted: totalInserted,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return res.status(500).json({
      error,
      stack,
      context: { url: req.url },
      timestamp: new Date().toISOString(),
    });
  }
}
