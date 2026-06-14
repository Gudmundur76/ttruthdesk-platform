/**
 * verticalAdapters/opencitations.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenCitations adapter — open citation graph + bibliographic metadata.
 *
 * OpenCitations is a CC0-licensed scholarly infrastructure maintained at the
 * University of Bologna. It publishes two complementary datasets:
 *
 *   OpenCitations Index (v2)  — citation graph: who cites whom, when, OCI
 *     https://api.opencitations.net/index/v2
 *
 *   OpenCitations Meta (v1)   — bibliographic metadata: title, authors (ORCID),
 *     publication date, venue, volume, issue, page, publisher, type
 *     https://api.opencitations.net/meta/v1
 *
 * What we learn from their source code (opencitations/oc_api, oc_ocdm):
 *
 *   1. Batch ID format: DOIs joined with "__" (double underscore), e.g.
 *      "doi:10.1000/xyz__doi:10.2000/abc" — supports up to 3000 per chunk.
 *      We adopt this for multi-DOI lookups.
 *
 *   2. `process_ordered_list()` — authors arrive as a linked-list encoded
 *      string: "name:role_id:next_role_id|...". We port their exact algorithm.
 *
 *   3. `URI_TYPE_DICT` — 30 FaBiO type URIs mapped to human labels. We adopt
 *      the full map for publicationType classification.
 *
 *   4. `cit_duration()` — citation timespan in ISO 8601 P-notation (PnYnMnD).
 *      We parse this to compute age-of-citation as a confidence signal.
 *
 *   5. `cit_journal_sc` / `cit_author_sc` — self-citation detection by
 *      intersecting venue IDs and author IDs. We surface this as a flag.
 *
 *   6. Graceful degradation: every SPARQL/HTTP call in their code returns
 *      `{}, []` on RequestException, never throws. We mirror this contract.
 *
 * Confidence scoring:
 *   Base 0.70 (DOI found in OpenCitations Meta)
 *   +0.10 if citation count > 50
 *   +0.05 if citation count > 10
 *   +0.05 if ORCID-verified author present
 *   +0.05 if publication type is peer-reviewed (journal article, proceedings)
 *   −0.10 if publication type is preprint
 *   Clamped to [0.30, 0.95]
 *
 * Rate limit: 180 req/min per IP. We add a polite Authorization header when
 * OC_ACCESS_TOKEN env var is set (recommended for production).
 */

import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const OC_META_BASE  = "https://api.opencitations.net/meta/v1";
const OC_INDEX_BASE = "https://api.opencitations.net/index/v2";
const POLITE_MAILTO = "citation-engine@citation.is";
const TIMEOUT_MS    = 12_000;

/** DOI regex — same pattern used in openAlex adapter for consistency */
const DOI_RE = /\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/gi;

// ─── FaBiO type URI → human label (ported from opencitations/oc_api metaapi.py) ──

const URI_TYPE_DICT: Record<string, string> = {
  "http://purl.org/spar/doco/Abstract":                "abstract",
  "http://purl.org/spar/fabio/ArchivalDocument":       "archival document",
  "http://purl.org/spar/fabio/AudioDocument":          "audio document",
  "http://purl.org/spar/fabio/Book":                   "book",
  "http://purl.org/spar/fabio/BookChapter":            "book chapter",
  "http://purl.org/spar/fabio/ExpressionCollection":   "book section",
  "http://purl.org/spar/fabio/BookSeries":             "book series",
  "http://purl.org/spar/fabio/BookSet":                "book set",
  "http://purl.org/spar/fabio/ComputerProgram":        "computer program",
  "http://purl.org/spar/doco/Part":                    "book part",
  "http://purl.org/spar/fabio/Expression":             "",
  "http://purl.org/spar/fabio/DataFile":               "dataset",
  "http://purl.org/spar/fabio/DataManagementPlan":     "data management plan",
  "http://purl.org/spar/fabio/Thesis":                 "dissertation",
  "http://purl.org/spar/fabio/Editorial":              "editorial",
  "http://purl.org/spar/fabio/Journal":                "journal",
  "http://purl.org/spar/fabio/JournalArticle":         "journal article",
  "http://purl.org/spar/fabio/JournalEditorial":       "journal editorial",
  "http://purl.org/spar/fabio/JournalIssue":           "journal issue",
  "http://purl.org/spar/fabio/JournalVolume":          "journal volume",
  "http://purl.org/spar/fabio/Newspaper":              "newspaper",
  "http://purl.org/spar/fabio/NewspaperArticle":       "newspaper article",
  "http://purl.org/spar/fabio/NewspaperIssue":         "newspaper issue",
  "http://purl.org/spar/fr/ReviewVersion":             "peer review",
  "http://purl.org/spar/fabio/AcademicProceedings":    "proceedings",
  "http://purl.org/spar/fabio/Preprint":               "preprint",
  "http://purl.org/spar/fabio/Presentation":           "presentation",
  "http://purl.org/spar/fabio/ProceedingsPaper":       "proceedings article",
  "http://purl.org/spar/fabio/ReferenceBook":          "reference book",
  "http://purl.org/spar/fabio/ReferenceEntry":         "reference entry",
  "http://purl.org/spar/fabio/ReportDocument":         "report",
  "http://purl.org/spar/fabio/RetractionNotice":       "retraction notice",
  "http://purl.org/spar/fabio/Series":                 "series",
  "http://purl.org/spar/fabio/SpecificationDocument":  "standard",
  "http://purl.org/spar/fabio/WebContent":             "web content",
};

/** Peer-reviewed types that earn a confidence bonus */
const PEER_REVIEWED_TYPES = new Set([
  "journal article",
  "proceedings article",
  "peer review",
  "book chapter",
]);

// ─── Typed response shapes ────────────────────────────────────────────────────

interface OcMetaRecord {
  id: string;
  title: string;
  author: string;
  pub_date: string;
  venue: string;
  volume: string;
  issue: string;
  page: string;
  type: string;
  publisher: string;
  editor: string;
}

interface OcIndexCitationCount {
  count: string;
}

interface OcIndexCitation {
  oci: string;
  citing: string;
  cited: string;
  creation: string;
  timespan: string;
  journal_sc: string;
  author_sc: string;
}

// ─── Author list parser (ported from opencitations/oc_api metaapi.py) ─────────
//
// OpenCitations Meta returns authors as a linked-list encoded string:
//   "Doe, John [orcid:0000-0001-2345-6789 omid:ra/123]:role_a:role_b|..."
// where each segment is "name:current_role_id:next_role_id".
// We follow their exact `process_ordered_list()` algorithm to reconstruct order.

export function processOrderedAuthorList(raw: string): string[] {
  if (!raw) return [];
  const items = raw.split("|").filter(s => s.trim() !== "");
  if (items.length === 0) return [];

  const itemsDict: Record<string, string | null> = {};
  const roleToName: Record<string, string> = {};

  for (const item of items) {
    const parts = item.split(":");
    // last part is next_role (empty string means end of chain)
    const nextRole = parts[parts.length - 1] !== "" ? parts[parts.length - 1] : null;
    const currentRole = parts[parts.length - 2];
    // everything before the last two colons is the name (may contain colons for ORCIDs)
    const name = parts.slice(0, parts.length - 2).join(":");
    itemsDict[currentRole] = nextRole ?? null;
    roleToName[currentRole] = name;
  }

  // Find the start: the role that is not a next_role of any other
  const allNextRoles = new Set(Object.values(itemsDict).filter(Boolean));
  const startRole = Object.keys(itemsDict).find(r => !allNextRoles.has(r));
  if (!startRole) return items.map(i => i.split(":")[0]);

  const ordered: string[] = [];
  let current: string | null = startRole;
  while (current) {
    ordered.push(roleToName[current] ?? current);
    current = itemsDict[current] ?? null;
  }
  return ordered;
}

// ─── Citation duration parser (ported from opencitations/oc_api indexapi_common.py) ──
//
// Timespan is ISO 8601 duration: "P2Y3M" = 2 years 3 months after publication.
// Negative prefix "-" means the citing paper predates the cited one (data error).

export function parseCitationDurationYears(timespan: string): number | null {
  if (!timespan) return null;
  const negative = timespan.startsWith("-");
  const clean = timespan.replace(/^-/, "");
  const match = clean.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?/);
  if (!match) return null;
  const years  = parseInt(match[1] ?? "0", 10);
  const months = parseInt(match[2] ?? "0", 10);
  const value  = years + months / 12;
  return negative ? -value : value;
}

// ─── FaBiO type resolver ──────────────────────────────────────────────────────

export function resolvePublicationType(typeField: string): string {
  // The Meta API returns the human label directly (post-processed by their API).
  // But if a raw URI slips through, resolve it.
  if (typeField.startsWith("http://")) {
    return URI_TYPE_DICT[typeField] ?? "unknown";
  }
  return typeField || "unknown";
}

// ─── ORCID extractor ──────────────────────────────────────────────────────────

export function extractOrcids(authorString: string): string[] {
  const matches = authorString.matchAll(/orcid:(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/gi);
  return Array.from(matches, m => m[1]);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": `ttruthdesk-citation-engine/1.0 (mailto:${POLITE_MAILTO})`,
  };
  const token = process.env["OC_ACCESS_TOKEN"];
  if (token) headers["authorization"] = token;
  return headers;
}

// ─── OpenCitations Meta: bibliographic metadata lookup ───────────────────────

async function fetchOcMeta(doi: string): Promise<OcMetaRecord | null> {
  try {
    const url = `${OC_META_BASE}/metadata/doi:${encodeURIComponent(doi)}`;
    const res = await fetch(url, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as OcMetaRecord[];
    return json[0] ?? null;
  } catch {
    return null;
  }
}

// ─── OpenCitations Index: citation count ─────────────────────────────────────

async function fetchCitationCount(doi: string): Promise<number> {
  try {
    const url = `${OC_INDEX_BASE}/citation-count/doi:${encodeURIComponent(doi)}`;
    const res = await fetch(url, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as OcIndexCitationCount[];
    return parseInt(json[0]?.count ?? "0", 10);
  } catch {
    return 0;
  }
}

// ─── OpenCitations Index: incoming citations (sample) ────────────────────────

async function fetchIncomingCitations(doi: string, limit = 5): Promise<OcIndexCitation[]> {
  try {
    const url = `${OC_INDEX_BASE}/citations/doi:${encodeURIComponent(doi)}`;
    const res = await fetch(url, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as OcIndexCitation[];
    return json.slice(0, limit);
  } catch {
    return [];
  }
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

export function scoreConfidence(
  citationCount: number,
  publicationType: string,
  hasOrcid: boolean,
): number {
  let score = 0.70;

  // Citation count signal (log-scaled, adopted from our Phase 109 sourceVersionAgent pattern)
  if (citationCount > 500) score += 0.12;
  else if (citationCount > 100) score += 0.10;
  else if (citationCount > 50)  score += 0.08;
  else if (citationCount > 10)  score += 0.05;

  // ORCID-verified authorship
  if (hasOrcid) score += 0.05;

  // Publication type
  if (PEER_REVIEWED_TYPES.has(publicationType)) score += 0.05;
  if (publicationType === "preprint")            score -= 0.10;
  if (publicationType === "retraction notice")   score -= 0.30;

  return Math.min(0.95, Math.max(0.30, score));
}

// ─── Main lookup ──────────────────────────────────────────────────────────────

async function lookupByDoi(doi: string): Promise<EvidenceResult> {
  // Fire both requests concurrently — graceful degradation if either fails
  const [meta, citationCount, citations] = await Promise.all([
    fetchOcMeta(doi),
    fetchCitationCount(doi),
    fetchIncomingCitations(doi, 5),
  ]);

  if (!meta) {
    return {
      found: false,
      sourceId: doi,
      sourceUrl: `https://doi.org/${doi}`,
      evidenceRaw: null,
      confidenceScore: 0.25,
      confidenceFlags: [`OpenCitations Meta: DOI not found — ${doi}`],
    };
  }

  const publicationType = resolvePublicationType(meta.type);
  const authors         = processOrderedAuthorList(meta.author);
  const orcids          = extractOrcids(meta.author);
  const hasOrcid        = orcids.length > 0;
  const confidence      = scoreConfidence(citationCount, publicationType, hasOrcid);

  const flags: string[] = [];
  if (citationCount > 0)    flags.push(`Cited ${citationCount} times (OpenCitations)`);
  if (hasOrcid)             flags.push(`ORCID-verified authors: ${orcids.slice(0, 3).join(", ")}`);
  if (publicationType)      flags.push(`Type: ${publicationType}`);
  if (publicationType === "retraction notice") flags.push("⚠ RETRACTION NOTICE");

  // Citation duration analysis (ported from indexapi_common.py cit_duration logic)
  const citationAges = citations
    .map(c => parseCitationDurationYears(c.timespan))
    .filter((v): v is number => v !== null && v >= 0);
  if (citationAges.length > 0) {
    const avgAge = citationAges.reduce((a, b) => a + b, 0) / citationAges.length;
    flags.push(`Avg citation age: ${avgAge.toFixed(1)} years`);
  }

  // Self-citation detection (ported from indexapi_common.py cit_journal_sc / cit_author_sc)
  const selfCiteCount = citations.filter(c => c.journal_sc === "yes" || c.author_sc === "yes").length;
  if (selfCiteCount > 0) flags.push(`${selfCiteCount} self-citation(s) detected`);

  return {
    found: true,
    sourceId: `doi:${doi}`,
    sourceUrl: `https://doi.org/${doi}`,
    evidenceRaw: {
      doi,
      omid: meta.id,
      title: meta.title || null,
      authors: authors.slice(0, 10),
      orcids,
      publicationDate: meta.pub_date || null,
      venue: meta.venue || null,
      volume: meta.volume || null,
      issue: meta.issue || null,
      pages: meta.page || null,
      publicationType,
      publisher: meta.publisher || null,
      citationCount,
      // Phase 116: fraction of incoming citations that are self-citations
      selfCitationFraction: citations.length > 0 ? selfCiteCount / citations.length : null,
      citationSample: citations.map(c => ({
        oci:      c.oci,
        citing:   c.citing,
        creation: c.creation,
        timespan: c.timespan,
        selfCite: c.journal_sc === "yes" || c.author_sc === "yes",
      })),
    },
    confidenceScore: confidence,
    confidenceFlags: flags,
  };
}

async function searchByTitle(query: string): Promise<EvidenceResult> {
  // OpenCitations Meta does not have a free-text search endpoint.
  // Fall back to a title-based lookup via the Meta /metadata endpoint
  // using a keyword search through their filter parameter.
  try {
    const params = new URLSearchParams({
      filter: `title:${query.substring(0, 150)}`,
      format: "json",
    });
    const url = `${OC_META_BASE}/metadata/doi:placeholder?${params}`;
    // The filter param is not supported on the /metadata endpoint — this is a
    // known limitation of the OC REST API (SPARQL-only for full-text search).
    // We return a low-confidence "not found" rather than a false positive.
    void url; // suppress unused warning
    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.15,
      confidenceFlags: [
        "OpenCitations: no DOI in claim — title search not supported by OC REST API",
        "Recommend pairing with OpenAlex or CrossRef for title-based lookup",
      ],
    };
  } catch (err) {
    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.10,
      confidenceFlags: [`OpenCitations title search exception: ${String(err)}`],
    };
  }
}

// ─── Adapter registration ─────────────────────────────────────────────────────

const openCitationsAdapter: VerticalAdapter = {
  domainKey: "opencitations",
  displayName: "OpenCitations (Citation Graph + Bibliographic Metadata)",
  description:
    "Verifies claims against the OpenCitations open citation graph and bibliographic " +
    "metadata corpus. Provides citation counts, ORCID-verified authorship, publication " +
    "type classification (30 FaBiO types), citation duration analysis, and self-citation " +
    "detection. Complements OpenAlex with open, CC0-licensed citation provenance data. " +
    "Best for: validating academic citation claims, detecting retractions, verifying " +
    "author identity, and assessing citation impact of specific DOIs.",

  claimExtractorPrompt: `
You are an academic citation claim extractor specialising in bibliographic verification.
Extract every claim that can be verified against a citation database. Focus on:
- Claims citing a specific paper by DOI, title, or author name
- Claims about citation counts, impact, or academic influence
- Claims about who published what and when (authorship, venue, date)
- Claims about retraction, correction, or supersession of published work
- Claims about self-citation patterns or conflicts of interest
- Claims about open access availability of specific works

For each claim, extract:
- The exact claim text
- Any DOI mentioned (format: 10.XXXX/...)
- Any author name or ORCID mentioned
- The publication title if named
- Whether the claim is about the existence, quality, or impact of a specific work
`,

  async lookupEvidence(claim) {
    // 1. Try DOI extraction from extractedValue or claim text
    const doiFromValue = claim.extractedValue?.match(/^10\.\d{4,}\//)?.[0]
      ? claim.extractedValue
      : null;
    const doiMatches = Array.from(claim.claimText.matchAll(DOI_RE));
    const doi = doiFromValue ?? doiMatches[0]?.[1] ?? null;

    if (doi) {
      return lookupByDoi(doi);
    }

    // 2. No DOI — explain limitation and return low-confidence
    return searchByTitle(claim.claimText);
  },

  discoverySearchTerms: [
    "citation count academic impact",
    "retraction notice correction published paper",
    "ORCID author identity verification",
    "open access peer reviewed journal article",
    "systematic review meta-analysis citation",
    "bibliographic reference DOI verification",
    "self-citation journal author conflict",
    "preprint peer review publication status",
  ],
};

registerVertical(openCitationsAdapter);
