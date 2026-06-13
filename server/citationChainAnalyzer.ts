/**
 * citationChainAnalyzer.ts
 *
 * Phase 102 — Citation Chain Analysis
 *
 * Discovers papers that cite a given source document (via PubMed elink API),
 * then for each citing paper extracts the version of the original claim used
 * and scores the distortion relative to the source claim.
 *
 * This runs as a non-fatal background task after misrepresentation classification.
 * Results are stored in the citation_edges table for UI rendering and SIA evaluation.
 */

import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { citationEdges } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { logger, errData } from "./logger";
const log = logger("citationChainAnalyzer");


// ─── Types ────────────────────────────────────────────────────────────────────

export type DistortionType =
  | "faithful"
  | "amplification"
  | "selective_omission"
  | "scope_drift"
  | "causal_overclaim"
  | "fabrication"
  | "unknown";

export interface CitingPaper {
  pmid: string;
  title: string;
  doi?: string;
  abstract?: string;
  citingClaimText?: string;
}

export interface ChainHop {
  pmid: string;
  title: string;
  doi?: string;
  hopNumber: number;
  distortionScore: number;
  distortionType: DistortionType;
  distortionRationale: string;
  citingClaimText?: string;
}

export interface CitationChainResult {
  sourcePmid: string;
  originalClaimText: string;
  hops: ChainHop[];
  maxDistortionScore: number;
  dominantDistortionType: DistortionType;
}

// ─── PubMed elink: find papers that cite a given PMID ─────────────────────────

  // eslint-disable-next-line complexity -- TODO(phase-131): extract helpers to reduce complexity
async function fetchCitingPapers(
  pmid: string,
  maxResults = 10
): Promise<CitingPaper[]> {
  try {
    // PubMed elink API: find papers in PMC that cite this PMID
    const elinkUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi` +
      `?dbfrom=pubmed&db=pubmed&linkname=pubmed_pubmed_citedin&id=${pmid}&retmode=json`;

    const elinkResp = await fetch(elinkUrl, {
      headers: {
        "User-Agent": "ProteinTruthDesk/1.0 (citation-chain-analysis)",
      },
    });

    if (!elinkResp.ok) return [];

    const elinkData = await elinkResp.json();
    const linkSets = elinkData?.linksets?.[0]?.linksetdbs;
    if (!linkSets || !Array.isArray(linkSets)) return [];

    const citedinSet = linkSets.find(
      (ls: { linkname: string }) => ls.linkname === "pubmed_pubmed_citedin"
    );
    if (!citedinSet?.links?.length) return [];

    // Take up to maxResults citing PMIDs
    const citingPmids: string[] = citedinSet.links
      .slice(0, maxResults)
      .map(String);
    if (citingPmids.length === 0) return [];

    // Fetch summaries for citing papers
    const summaryUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` +
      `?db=pubmed&id=${citingPmids.join(",")}&retmode=json`;

    const summaryResp = await fetch(summaryUrl, {
      headers: {
        "User-Agent": "ProteinTruthDesk/1.0 (citation-chain-analysis)",
      },
    });

    if (!summaryResp.ok) return [];

    const summaryData = await summaryResp.json();
    const result: CitingPaper[] = [];

    for (const pmidStr of citingPmids) {
      const doc = summaryData?.result?.[pmidStr];
      if (!doc) continue;
      result.push({
        pmid: pmidStr,
        title: doc.title || "Unknown title",
        doi: doc.elocationid?.replace("doi: ", "") || undefined,
      });
    }

    return result;
  } catch {
    return [];
  }
}

// ─── Fetch abstract for a PMID ────────────────────────────────────────────────

async function fetchAbstract(pmid: string): Promise<string> {
  try {
    const url =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi` +
      `?db=pubmed&id=${pmid}&rettype=abstract&retmode=text`;

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "ProteinTruthDesk/1.0 (citation-chain-analysis)",
      },
    });

    if (!resp.ok) return "";
    const text = await resp.text();
    // Return first 2000 chars to keep LLM context manageable
    return text.slice(0, 2000);
  } catch {
    return "";
  }
}

// ─── LLM: extract how the citing paper uses the original claim ─────────────────

async function extractCitingClaim(
  originalClaim: string,
  citingAbstract: string,
  citingTitle: string
): Promise<string> {
  if (!citingAbstract) return "";

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a scientific citation analyst. Given an original claim and the abstract of a paper that cites the source, " +
            "extract the exact sentence or phrase in the citing paper that references or uses the original claim. " +
            "If no clear reference is found, return an empty string. " +
            "Return ONLY the extracted sentence, nothing else.",
        },
        {
          role: "user",
          content:
            `Original claim: "${originalClaim}"\n\n` +
            `Citing paper title: "${citingTitle}"\n\n` +
            `Citing paper abstract:\n${citingAbstract}`,
        },
      ],
    });

    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return "";
    return content.trim().replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

// ─── LLM: score distortion between original and citing claim ──────────────────

interface DistortionResult {
  score: number;
  type: DistortionType;
  rationale: string;
}

async function scoreDistortion(
  originalClaim: string,
  citingClaim: string,
  citingTitle: string
): Promise<DistortionResult> {
  if (!citingClaim) {
    return {
      score: 0,
      type: "unknown",
      rationale: "No citing claim text available for comparison.",
    };
  }

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a scientific citation integrity analyst. Compare an original claim with how it is cited in a subsequent paper. " +
            "Score the distortion and classify the distortion type. " +
            "Respond with valid JSON only, no markdown, no explanation outside the JSON. " +
            "Schema: { score: number (0.0=faithful, 1.0=severe distortion), type: string, rationale: string } " +
            "Types: faithful | amplification | selective_omission | scope_drift | causal_overclaim | fabrication | unknown",
        },
        {
          role: "user",
          content:
            `Original claim: "${originalClaim}"\n\n` +
            `Citing paper: "${citingTitle}"\n` +
            `How the citing paper uses this claim: "${citingClaim}"`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "distortion_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              score: {
                type: "number",
                description: "Distortion score 0.0 to 1.0",
              },
              type: {
                type: "string",
                enum: [
                  "faithful",
                  "amplification",
                  "selective_omission",
                  "scope_drift",
                  "causal_overclaim",
                  "fabrication",
                  "unknown",
                ],
              },
              rationale: {
                type: "string",
                description: "One sentence explaining the distortion",
              },
            },
            required: ["score", "type", "rationale"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return {
        score: 0,
        type: "unknown",
        rationale: "LLM returned no content.",
      };
    }

    const parsed = JSON.parse(content) as DistortionResult;
    return {
      score: Math.max(0, Math.min(1, parsed.score ?? 0)),
      type: (parsed.type as DistortionType) ?? "unknown",
      rationale: parsed.rationale ?? "",
    };
  } catch {
    return {
      score: 0,
      type: "unknown",
      rationale: "Distortion analysis failed.",
    };
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export async function insertCitationEdge(edge: {
  sourceDocId?: number;
  sourcePmid?: string;
  sourceTitle?: string;
  targetDocId?: number;
  targetPmid?: string;
  targetTitle?: string;
  targetDoi?: string;
  hopNumber: number;
  distortionScore?: number;
  distortionType?: DistortionType;
  distortionRationale?: string;
  originalClaimId?: number;
  originalClaimText?: string;
  citingClaimText?: string;
  analysisStatus?: "pending" | "complete" | "failed" | "skipped";
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(citationEdges).values({
    ...edge,
    analysisStatus: edge.analysisStatus ?? "complete",
  });
}

export async function getCitationChainByDocument(documentId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(citationEdges)
    .where(eq(citationEdges.sourceDocId, documentId))
    .orderBy(citationEdges.hopNumber, citationEdges.distortionScore);
}

export async function getCitationChainStats(documentId: number) {
  const edges = await getCitationChainByDocument(documentId);
  if (edges.length === 0) {
    return {
      totalCitingPapers: 0,
      maxDistortionScore: 0,
      dominantType: "unknown" as DistortionType,
    };
  }

  const scores = edges.map(
    (e: { distortionScore: number | null }) => e.distortionScore ?? 0
  );
  const maxScore = Math.max(...scores);

  // Find most common distortion type (excluding "faithful" and "unknown")
  const typeCounts: Record<string, number> = {};
  for (const edge of edges as Array<{ distortionType: string | null }>) {
    const t = edge.distortionType ?? "unknown";
    if (t !== "faithful" && t !== "unknown") {
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    }
  }
  const dominantType =
    (Object.entries(typeCounts).sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0] as DistortionType) ?? "unknown";

  return {
    totalCitingPapers: edges.length,
    maxDistortionScore: maxScore,
    dominantType,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Analyse the citation chain for a document.
 * Discovers papers that cite the source PMID, extracts how each citing paper
 * uses the original claim, and scores the distortion at each hop.
 *
 * Non-fatal: errors are caught and logged, never thrown to the caller.
 */
export async function analyzeCitationChain(params: {
  documentId: number;
  sourcePmid: string;
  sourceTitle?: string;
  originalClaimId?: number;
  originalClaimText: string;
  maxHops?: number;
}): Promise<CitationChainResult | null> {
  const {
    documentId,
    sourcePmid,
    sourceTitle,
    originalClaimId,
    originalClaimText,
    maxHops = 10,
  } = params;

  try {
    // 1. Discover citing papers
    const citingPapers = await fetchCitingPapers(sourcePmid, maxHops);
    if (citingPapers.length === 0) {
      return {
        sourcePmid,
        originalClaimText,
        hops: [],
        maxDistortionScore: 0,
        dominantDistortionType: "unknown",
      };
    }

    const hops: ChainHop[] = [];

    // 2. For each citing paper: fetch abstract, extract citing claim, score distortion
    for (let i = 0; i < citingPapers.length; i++) {
      const paper = citingPapers[i];
      const hopNumber = i + 1;

      try {
        const abstract = await fetchAbstract(paper.pmid);
        const citingClaimText = await extractCitingClaim(
          originalClaimText,
          abstract,
          paper.title
        );
        const distortion = await scoreDistortion(
          originalClaimText,
          citingClaimText,
          paper.title
        );

        const hop: ChainHop = {
          pmid: paper.pmid,
          title: paper.title,
          doi: paper.doi,
          hopNumber,
          distortionScore: distortion.score,
          distortionType: distortion.type,
          distortionRationale: distortion.rationale,
          citingClaimText: citingClaimText || undefined,
        };

        hops.push(hop);

        // Persist to DB
        await insertCitationEdge({
          sourceDocId: documentId,
          sourcePmid,
          sourceTitle,
          targetPmid: paper.pmid,
          targetTitle: paper.title,
          targetDoi: paper.doi,
          hopNumber,
          distortionScore: distortion.score,
          distortionType: distortion.type,
          distortionRationale: distortion.rationale,
          originalClaimId,
          originalClaimText,
          citingClaimText: citingClaimText || undefined,
          analysisStatus: "complete",
        });
      } catch {
        // Skip this hop on error, continue with others
        await insertCitationEdge({
          sourceDocId: documentId,
          sourcePmid,
          targetPmid: paper.pmid,
          targetTitle: paper.title,
          hopNumber,
          originalClaimId,
          originalClaimText,
          analysisStatus: "failed",
        });
      }
    }

    const scores = hops.map(h => h.distortionScore);
    const maxDistortionScore = scores.length > 0 ? Math.max(...scores) : 0;

    const typeCounts: Record<string, number> = {};
    for (const hop of hops) {
      if (
        hop.distortionType !== "faithful" &&
        hop.distortionType !== "unknown"
      ) {
        typeCounts[hop.distortionType] =
          (typeCounts[hop.distortionType] ?? 0) + 1;
      }
    }
    const dominantDistortionType =
      (Object.entries(typeCounts).sort(
        (a, b) => b[1] - a[1]
      )[0]?.[0] as DistortionType) ?? "unknown";

    return {
      sourcePmid,
      originalClaimText,
      hops,
      maxDistortionScore,
      dominantDistortionType,
    };
  } catch (err) {
    log.error("[CitationChain] Analysis failed:", errData(err));
    return null;
  }
}
