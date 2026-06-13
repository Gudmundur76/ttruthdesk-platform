/**
 * verticalAdapters/genericSource.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generic source adapter — the fallback that makes ANY source verifiable.
 *
 * This adapter handles claims that reference a URL, DOI, or named source
 * that is not covered by a specific vertical adapter. It is the "bring your
 * own source" primitive:
 *
 *   1. DOI → resolve via CrossRef (metadata) + OpenAlex (semantic enrichment)
 *   2. URL → fetch page, extract structured metadata (title, description,
 *             author, date, schema.org, Open Graph), return as evidence
 *   3. Named source → attempt CrossRef keyword search as fallback
 *
 * This adapter intentionally returns lower confidence scores than dedicated
 * adapters — it is a best-effort fallback, not a primary verification source.
 * The pipeline should prefer specific adapters when available.
 *
 * Used by the analysisPipeline when no vertical adapter matches the claim domain.
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";

const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/gi;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const CROSSREF_BASE = "https://api.crossref.org";
const OPENALEX_BASE = "https://api.openalex.org";
const POLITE_MAILTO = "citation-engine@citation.is";

// ─── Metadata extraction from arbitrary URLs ──────────────────────────────────

interface PageMetadata {
  url: string;
  title: string | null;
  description: string | null;
  author: string | null;
  publishedDate: string | null;
  siteName: string | null;
  doi: string | null;
  schemaType: string | null;
  isAccessible: boolean;
  httpStatus: number;
}

async function fetchPageMetadata(url: string): Promise<PageMetadata> {
  const base: PageMetadata = {
    url,
    title: null,
    description: null,
    author: null,
    publishedDate: null,
    siteName: null,
    doi: null,
    schemaType: null,
    isAccessible: false,
    httpStatus: 0,
  };

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "citation-engine/1.0 (citation-engine@citation.is)",
        Accept: "text/html,application/xhtml+xml,application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    base.httpStatus = res.status;
    base.isAccessible = res.ok;

    if (!res.ok) return base;

    const contentType = res.headers.get("content-type") ?? "";

    // JSON-LD or structured data (e.g. CrossRef, OpenAlex, DOI resolver)
    if (contentType.includes("application/json") || contentType.includes("application/ld+json")) {
      const json = await res.json() as Record<string, unknown>;
      base.title = (json["title"] as string) ?? (json["name"] as string) ?? null;
      base.description = (json["abstract"] as string) ?? (json["description"] as string) ?? null;
      base.doi = (json["DOI"] as string) ?? (json["doi"] as string) ?? null;
      base.schemaType = (json["@type"] as string) ?? (json["type"] as string) ?? null;
      return base;
    }

    // HTML — extract meta tags
    const html = await res.text();

    const extractMeta = (name: string): string | null => {
      const patterns = [
        new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i"),
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m?.[1]) return m[1].trim();
      }
      return null;
    };

    const extractTitle = (): string | null => {
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return m?.[1]?.trim() ?? null;
    };

    base.title =
      extractMeta("og:title") ??
      extractMeta("twitter:title") ??
      extractMeta("citation_title") ??
      extractTitle();

    base.description =
      extractMeta("og:description") ??
      extractMeta("description") ??
      extractMeta("twitter:description") ??
      extractMeta("citation_abstract");

    base.author =
      extractMeta("author") ??
      extractMeta("citation_author") ??
      extractMeta("article:author");

    base.publishedDate =
      extractMeta("article:published_time") ??
      extractMeta("citation_publication_date") ??
      extractMeta("DC.date");

    base.siteName =
      extractMeta("og:site_name") ??
      extractMeta("citation_journal_title");

    // Try to extract a DOI from the page
    const doiMatch = html.match(/\b(10\.\d{4,}(?:\.\d+)*\/[^\s"'<>]+)\b/);
    base.doi = doiMatch?.[1] ?? null;

    // Schema.org type
    const schemaMatch = html.match(/"@type"\s*:\s*"([^"]+)"/);
    base.schemaType = schemaMatch?.[1] ?? null;

    return base;
  } catch {
    return base;
  }
}

// ─── DOI resolution via CrossRef + OpenAlex ───────────────────────────────────

async function resolveDoi(doi: string): Promise<EvidenceResult> {
  try {
    // Parallel lookup: CrossRef for metadata, OpenAlex for enrichment
    const [crRes, oaRes] = await Promise.allSettled([
      fetch(`${CROSSREF_BASE}/works/${encodeURIComponent(doi)}`, {
        headers: { "User-Agent": `citation-engine/1.0 (${POLITE_MAILTO})` },
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(`${OPENALEX_BASE}/works/doi:${encodeURIComponent(doi)}?mailto=${POLITE_MAILTO}`, {
        signal: AbortSignal.timeout(10_000),
      }),
    ]);

    let title: string | null = null;
    let abstract: string | null = null;
    let year: number | null = null;
    let citations = 0;
    let journal: string | null = null;
    let concepts: string[] = [];
    let confidence = 0.7;

    if (crRes.status === "fulfilled" && crRes.value.ok) {
      const crJson = await crRes.value.json() as { message: Record<string, unknown> };
      const work = crJson.message;
      title = (work["title"] as string[])?.[0] ?? null;
      year = (work["published"] as { "date-parts": number[][] })?.[
        "date-parts"
      ]?.[0]?.[0] ?? null;
      citations = (work["is-referenced-by-count"] as number) ?? 0;
      journal = (work["container-title"] as string[])?.[0] ?? null;
      if (citations > 100) confidence = 0.92;
      else if (citations > 10) confidence = 0.85;
    }

    if (oaRes.status === "fulfilled" && oaRes.value.ok) {
      const oaJson = await oaRes.value.json() as Record<string, unknown>;
      abstract = extractOpenAlexAbstract(oaJson["abstract_inverted_index"] as Record<string, number[]> | undefined);
      concepts = ((oaJson["concepts"] as Array<{ display_name: string; score: number; level: number }>) ?? [])
        .filter(c => c.level <= 2 && c.score > 0.3)
        .slice(0, 5)
        .map(c => c.display_name);
    }

    return {
      found: !!(title || abstract),
      sourceId: doi,
      sourceUrl: `https://doi.org/${doi}`,
      evidenceRaw: { doi, title, abstract, year, citations, journal, concepts },
      confidenceScore: confidence,
      confidenceFlags: concepts.length > 0 ? [`Domains: ${concepts.join(", ")}`] : [],
    };
  } catch (err) {
    return {
      found: false,
      sourceId: doi,
      sourceUrl: `https://doi.org/${doi}`,
      evidenceRaw: null,
      confidenceScore: 0.2,
      confidenceFlags: [`DOI resolution failed: ${String(err)}`],
    };
  }
}

function extractOpenAlexAbstract(invertedIndex: Record<string, number[]> | undefined): string | null {
  if (!invertedIndex) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(" ").substring(0, 600) || null;
}

// ─── Adapter definition ───────────────────────────────────────────────────────

const genericSourceAdapter: VerticalAdapter = {
  domainKey: "generic_source",
  displayName: "Generic Source (URL/DOI Fallback)",
  description:
    "Fallback adapter that makes any source verifiable. Handles claims referencing " +
    "a URL or DOI not covered by a specific vertical adapter. Resolves DOIs via " +
    "CrossRef + OpenAlex in parallel; fetches and extracts structured metadata from " +
    "arbitrary URLs. Returns lower confidence scores than dedicated adapters — " +
    "this is best-effort verification for uncovered domains.",

  claimExtractorPrompt: `
You are a general-purpose claim extractor. Extract every verifiable factual claim from the text.
Focus on claims that:
- Reference a specific URL, DOI, or named publication
- Make a specific, falsifiable assertion (not opinions or predictions)
- Can be traced to an authoritative source
For each claim, extract:
- The exact claim text
- Any URL or DOI mentioned
- The source name or publication if mentioned
- The domain or topic area
`,

  async lookupEvidence(claim) {
    // 1. Try DOI extraction from claim text or extractedValue
    const doiMatches = Array.from(claim.claimText.matchAll(DOI_RE));
    const doi = claim.extractedValue?.match(/^10\.\d{4,}\//)?.[0]
      ? claim.extractedValue
      : doiMatches[0]?.[1] ?? null;

    if (doi) {
      return resolveDoi(doi);
    }

    // 2. Try URL extraction from claim text
    const urlMatches = Array.from(claim.claimText.matchAll(URL_RE));
    const url = urlMatches[0]?.[0] ?? null;

    if (url) {
      const meta = await fetchPageMetadata(url);

      // If the page contains a DOI, resolve it properly
      if (meta.doi) {
        return resolveDoi(meta.doi);
      }

      if (!meta.isAccessible) {
        return {
          found: false,
          sourceId: url,
          sourceUrl: url,
          evidenceRaw: { url, httpStatus: meta.httpStatus },
          confidenceScore: 0.15,
          confidenceFlags: [`URL not accessible (HTTP ${meta.httpStatus})`],
        };
      }

      const hasMetadata = !!(meta.title || meta.description);
      return {
        found: hasMetadata,
        sourceId: url,
        sourceUrl: url,
        evidenceRaw: {
          url,
          title: meta.title,
          description: meta.description,
          author: meta.author,
          publishedDate: meta.publishedDate,
          siteName: meta.siteName,
          schemaType: meta.schemaType,
        },
        confidenceScore: hasMetadata ? 0.45 : 0.2,
        confidenceFlags: [
          "Generic URL extraction (no dedicated adapter)",
          ...(meta.schemaType ? [`Schema type: ${meta.schemaType}`] : []),
        ],
      };
    }

    // 3. No URL or DOI — CrossRef keyword search as last resort
    try {
      const params = new URLSearchParams({
        query: claim.claimText.substring(0, 150),
        rows: "1",
        select: "DOI,title,is-referenced-by-count,score",
        mailto: POLITE_MAILTO,
      });
      const res = await fetch(`${CROSSREF_BASE}/works?${params}`, {
        headers: { "User-Agent": `citation-engine/1.0 (${POLITE_MAILTO})` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const json = await res.json() as { message: { items: Array<{ DOI: string; title?: string[]; score?: number }> } };
        const item = json.message.items?.[0];
        if (item && (item.score ?? 0) > 25) {
          return {
            found: true,
            sourceId: item.DOI,
            sourceUrl: `https://doi.org/${item.DOI}`,
            evidenceRaw: {
              doi: item.DOI,
              title: item.title?.[0] ?? null,
              relevanceScore: item.score,
            },
            confidenceScore: 0.35,
            confidenceFlags: ["Generic fallback: CrossRef keyword search"],
          };
        }
      }
    } catch {
      // Silently fail — this is a best-effort fallback
    }

    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.05,
      confidenceFlags: ["Generic source: no URL, DOI, or matching literature found"],
    };
  },

  discoverySearchTerms: [],
};

registerVertical(genericSourceAdapter);
