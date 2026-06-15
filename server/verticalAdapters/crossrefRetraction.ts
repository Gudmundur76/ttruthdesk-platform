/**
 * crossrefRetraction.ts — Crossref + Scite.ai Retraction Detection Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Perplexity Doc 4 integration #1: Crossref DOI retraction detection.
 *
 * Two-source strategy:
 *   1. Crossref API  — checks `update-to` field for retraction notices
 *   2. Scite.ai API  — checks `retracted` boolean + `editorialNotices` array
 *
 * Usage:
 *   import { checkDoiRetraction } from "./verticalAdapters/crossrefRetraction";
 *   const status = await checkDoiRetraction("10.1016/S0140-6736(97)11096-0");
 *   // { retracted: true, retractionDate: "2010-02-06", noticeDoi: "10.1016/..." }
 *
 * Rate limits:
 *   Crossref: 50 req/s with polite pool (mailto header)
 *   Scite:    free tier — no auth needed for basic retraction check
 */

import { registerVertical } from "./types";
import type { VerticalAdapter, EvidenceResult } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RetractionStatus {
  [key: string]: unknown; // index signature for Record<string, unknown> compat
  doi: string;
  retracted: boolean;
  retractionDate: string | null;
  noticeDoi: string | null;
  source: "crossref" | "scite" | "none";
  editorialNotices: EditorialNotice[];
}

export interface EditorialNotice {
  status: string;
  date: string;
  noticeDoi: string;
}

// ─── DOI extraction ───────────────────────────────────────────────────────────

const DOI_PATTERN = /\b(10\.\d{4,}(?:\.\d+)*\/(?:(?!["&'<>])\S)+)/gi;

export function extractDoisFromText(text: string): string[] {
  const matches = text.match(DOI_PATTERN) ?? [];
  const unique = Array.from(new Set(matches.map(d => d.toLowerCase())));
  return unique;
}

// ─── Crossref retraction check ────────────────────────────────────────────────

const CROSSREF_BASE = "https://api.crossref.org/works";
const POLITE_MAILTO = "citation@ttruthdesk.claims";

async function checkCrossrefRetraction(doi: string): Promise<RetractionStatus> {
  const url = `${CROSSREF_BASE}/${encodeURIComponent(doi)}?mailto=${POLITE_MAILTO}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return noRetractionStatus(doi);
    const data = (await resp.json()) as {
      message?: {
        "update-to"?: Array<{
          type?: string;
          DOI?: string;
          updated?: { "date-time"?: string };
        }>;
      };
    };
    const msg = data.message;
    if (!msg) return noRetractionStatus(doi);
    const updateTo = msg["update-to"] ?? [];
    const retractionNotice = updateTo.find(u =>
      u.type?.toLowerCase().includes("retract")
    );
    if (retractionNotice) {
      return {
        doi,
        retracted: true,
        retractionDate:
          retractionNotice.updated?.["date-time"]?.slice(0, 10) ?? null,
        noticeDoi: retractionNotice.DOI ?? null,
        source: "crossref",
        editorialNotices: updateTo.map(u => ({
          status: u.type ?? "unknown",
          date: u.updated?.["date-time"]?.slice(0, 10) ?? "",
          noticeDoi: u.DOI ?? "",
        })),
      };
    }
    return noRetractionStatus(doi);
  } catch {
    return noRetractionStatus(doi);
  }
}

// ─── Scite.ai retraction check ────────────────────────────────────────────────

const SCITE_BASE = "https://api.scite.ai/papers";

async function checkSciteRetraction(doi: string): Promise<RetractionStatus> {
  const url = `${SCITE_BASE}/${encodeURIComponent(doi)}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) return noRetractionStatus(doi);
    const data = (await resp.json()) as {
      retracted?: boolean;
      editorialNotices?: Array<{
        status?: string;
        date?: string;
        noticeDoi?: string;
      }>;
    };
    const notices: EditorialNotice[] = (data.editorialNotices ?? []).map(n => ({
      status: n.status ?? "unknown",
      date: n.date ?? "",
      noticeDoi: n.noticeDoi ?? "",
    }));
    if (data.retracted === true) {
      const retractionNotice = notices.find(n =>
        n.status.toLowerCase().includes("retract")
      );
      return {
        doi,
        retracted: true,
        retractionDate: retractionNotice?.date ?? null,
        noticeDoi: retractionNotice?.noticeDoi ?? null,
        source: "scite",
        editorialNotices: notices,
      };
    }
    return {
      doi,
      retracted: false,
      retractionDate: null,
      noticeDoi: null,
      source: "none",
      editorialNotices: notices,
    };
  } catch {
    return noRetractionStatus(doi);
  }
}

// ─── Combined check ───────────────────────────────────────────────────────────

export async function checkDoiRetraction(
  doi: string
): Promise<RetractionStatus> {
  const [crossrefResult, sciteResult] = await Promise.all([
    checkCrossrefRetraction(doi),
    checkSciteRetraction(doi),
  ]);
  if (sciteResult.retracted) return sciteResult;
  if (crossrefResult.retracted) return crossrefResult;
  return {
    ...noRetractionStatus(doi),
    editorialNotices: sciteResult.editorialNotices,
  };
}

// ─── Vertical adapter registration ───────────────────────────────────────────

const crossrefRetractionAdapter: VerticalAdapter = {
  domainKey: "crossref_retraction",
  displayName: "Crossref + Scite Retraction Detection",
  description:
    "Checks DOIs in claim text against Crossref and Scite.ai for retraction notices, corrections, and editorial concerns.",
  claimExtractorPrompt: `
Extract claims that reference a specific DOI or published paper.
Focus on claims where a paper is cited as evidence.
Return the DOI if present (format: 10.xxxx/xxxxx).
`,
  discoverySearchTerms: [
    "retraction notice doi",
    "erratum correction published paper",
    "retracted article crossref scite",
  ],

  async lookupEvidence(params): Promise<EvidenceResult> {
    const dois = extractDoisFromText(params.claimText);
    if (dois.length === 0) {
      return {
        found: false,
        sourceId: "crossref_retraction",
        sourceUrl: "https://api.crossref.org",
        confidenceScore: 0,
        confidenceFlags: ["no_doi_in_claim"],
        evidenceRaw: null,
      };
    }
    const doi = dois[0]!;
    const status = await checkDoiRetraction(doi);
    if (status.retracted) {
      return {
        found: true,
        sourceId: "crossref_retraction",
        sourceUrl: `https://doi.org/${doi}`,
        confidenceScore: 0.05,
        confidenceFlags: [
          `retracted_doi:${doi}`,
          `retraction_date:${status.retractionDate ?? "unknown"}`,
          `notice_doi:${status.noticeDoi ?? "none"}`,
          `source:${status.source}`,
        ],
        evidenceRaw: status,
      };
    }
    return {
      found: true,
      sourceId: "crossref_retraction",
      sourceUrl: `https://doi.org/${doi}`,
      confidenceScore: 0.85,
      confidenceFlags:
        status.editorialNotices.length > 0
          ? [`editorial_notices:${status.editorialNotices.length}`]
          : [],
      evidenceRaw: status,
    };
  },
};

registerVertical(crossrefRetractionAdapter);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noRetractionStatus(doi: string): RetractionStatus {
  return {
    doi,
    retracted: false,
    retractionDate: null,
    noticeDoi: null,
    source: "none",
    editorialNotices: [],
  };
}
