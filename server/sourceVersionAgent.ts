/**
 * sourceVersionAgent.ts — Phase 109
 *
 * Source Version Tracking + Supersession Signal
 *
 * This agent runs daily at 03:30 UTC and:
 *   1. Iterates over every approved source in the SOURCE_WHITELIST
 *   2. Fetches a lightweight canonical metadata probe from each source
 *   3. Computes a deterministic SHA-256 hash of the probe payload
 *   4. Compares the hash against the last recorded version in source_versions
 *   5. If the hash has changed, classifies the change type:
 *        - "retraction"  — probe contains retraction signal keywords
 *        - "major"       — probe contains major-update keywords or version bump
 *        - "minor"       — any other detected change
 *   6. Writes the new version to source_versions
 *   7. Queues all claims sourced from this source for re-evaluation
 *      (by publishing a "source_version_changed" event to the autonomous loop)
 *
 * Design principles:
 *   - Non-fatal: individual source failures are caught and logged; the loop continues
 *   - Idempotent: same probe payload → same hash → no duplicate version rows
 *   - Bounded: processes at most MAX_SOURCES_PER_RUN sources per run
 *   - Auditable: returns a structured result with per-source outcomes
 */
import { createHash } from "crypto";
import { SOURCE_WHITELIST } from "./sourceRegistry";
import {
  getSourceVersion,
  upsertSourceVersion,
} from "./db";
import { publishEvent } from "./autonomousLoop/eventBus";
import { logger, errData } from "./logger";
const log = logger("sourceVersionAgent");


// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_SOURCES_PER_RUN = 30;
const PROBE_TIMEOUT_MS = 10_000;

// Keywords that signal a retraction in probe metadata
const RETRACTION_KEYWORDS = [
  "retract",
  "retraction",
  "withdrawn",
  "expression of concern",
  "erratum",
];

// Keywords that signal a major update (new version, schema change, etc.)
const MAJOR_UPDATE_KEYWORDS = [
  "major release",
  "breaking change",
  "schema update",
  "api version",
  "v2",
  "v3",
  "v4",
];

// ─── Types ────────────────────────────────────────────────────────────────────
export type ChangeType = "minor" | "major" | "retraction";

export interface SourceVersionOutcome {
  sourceId: string;
  status: "unchanged" | "updated" | "new" | "error" | "skipped";
  changeType?: ChangeType;
  previousHash?: string | null;
  newHash?: string;
  affectedClaimCount?: number;
  errorMessage?: string;
}

export interface SourceVersionRunResult {
  sourcesChecked: number;
  sourcesUpdated: number;
  sourcesUnchanged: number;
  sourcesErrored: number;
  sourcesSkipped: number;
  outcomes: SourceVersionOutcome[];
  durationMs: number;
}

// ─── Hash computation ─────────────────────────────────────────────────────────
/**
 * Compute a deterministic SHA-256 hash of a probe payload.
 * The payload is JSON-serialised with sorted keys to ensure stability.
 */
export function computeVersionHash(payload: unknown): string {
  const normalised = JSON.stringify(payload, Object.keys(
    typeof payload === "object" && payload !== null ? payload : {}
  ).sort());
  return createHash("sha256").update(normalised).digest("hex").slice(0, 32);
}

// ─── Change type classification ───────────────────────────────────────────────
/**
 * Classify the change type based on the probe payload text.
 * Checks for retraction signals first (highest severity), then major updates.
 */
export function classifyChangeType(probeText: string): ChangeType {
  const lower = probeText.toLowerCase();
  if (RETRACTION_KEYWORDS.some(kw => lower.includes(kw))) return "retraction";
  if (MAJOR_UPDATE_KEYWORDS.some(kw => lower.includes(kw))) return "major";
  return "minor";
}

// ─── Source probe ─────────────────────────────────────────────────────────────
/**
 * Fetch a lightweight canonical metadata probe from a source.
 * Returns the raw probe text, or null if the fetch fails.
 *
 * Each source uses a lightweight endpoint that returns stable metadata
 * (e.g., a known record, the API root, or a version endpoint).
 * The probe is NOT a full data fetch — it is a fingerprint check only.
 */
export async function fetchSourceProbe(
  sourceId: string,
  apiBaseUrl: string
): Promise<{ text: string; label: string } | null> {
  const probeUrl = buildProbeUrl(sourceId, apiBaseUrl);
  if (!probeUrl) return null; // null or undefined — no probe endpoint available

  try {
    const res = await fetch(probeUrl, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: "application/json, text/plain, */*" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    // Extract a version label if present in the response
    const label = extractVersionLabel(text);
    return { text, label };
  } catch {
    return null;
  }
}

/**
 * Build the probe URL for a given source.
 * Uses a well-known lightweight endpoint per source type.
 */
function buildProbeUrl(sourceId: string, apiBaseUrl: string): string | null | undefined {
  const probeMap: Record<string, string | undefined> = {
    rcsb_pdb: "https://data.rcsb.org/rest/v1/core/entry/1LYZ",
    pubmed: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?db=pubmed&retmode=json",
    crossref: "https://api.crossref.org/v1/works/10.1038/nature12373?rows=1",
    openalex: "https://api.openalex.org/works/W2741809807",
    semantic_scholar: "https://api.semanticscholar.org/graph/v1/paper/649def34f8be52c8b66281af98ae884c09aef38d?fields=title,year",
    who: "https://www.who.int/api/news/newsitems?sf_culture=en&$top=1",
    cochrane: "https://www.cochranelibrary.com/api/v1/reviews?rows=1",
    biorxiv: "https://api.biorxiv.org/details/biorxiv/10.1101/2021.01.01.000001/na/json",
    medrxiv: "https://api.biorxiv.org/details/medrxiv/10.1101/2021.01.01.000001/na/json",
    europe_pmc: "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=pmid:7159321&resulttype=core&format=json&pageSize=1",
    clinvar: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=BRCA1&retmax=1&retmode=json",
    chembl: "https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL25?format=json",
    sec_edgar: "https://data.sec.gov/submissions/CIK0000320193.json",
    eur_lex: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679",
    courtlistener: "https://www.courtlistener.com/api/rest/v3/opinions/?format=json&page_size=1",
    ietf_rfc: "https://www.rfc-editor.org/rfc/rfc9110.txt",
    world_bank: "https://api.worldbank.org/v2/indicator/NY.GDP.MKTP.CD?format=json&per_page=1",
    owid: "https://ourworldindata.org/grapher/life-expectancy.csv?country=OWID_WRL&time=latest",
    oecd: "https://stats.oecd.org/SDMX-JSON/data/HEALTH_STAT/LIFEEXP.AUS+AUT/all?startTime=2020&endTime=2020",
    eurostat: "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_pjan?format=JSON&geo=EU27_2020&time=2020",
    ipcc: "https://www.ipcc.ch/site/assets/uploads/2021/08/WGI_AR6_SPM_final.pdf",
    arxiv: "https://export.arxiv.org/api/query?id_list=2301.00001&max_results=1",
    wikidata: "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q42&format=json&props=labels&languages=en",
    nist: "https://nvd.nist.gov/feeds/json/cve/1.1/nvdcve-1.1-recent.meta",
    openfda: "https://api.fda.gov/drug/event.json?limit=1",
    efsa: "https://www.efsa.europa.eu/en/publications?field_publication_type=journal-article&items_per_page=1",
    pubchem: "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/JSON",
    uniprot: "https://rest.uniprot.org/uniprotkb/P04637.json",
    clinical_trials: "https://clinicaltrials.gov/api/query/full_studies?expr=cancer&min_rnk=1&max_rnk=1&fmt=json",
    generic_url: undefined,
    doi_fallback: undefined,
  };

  const specific = probeMap[sourceId];
  if (specific !== undefined) return specific;

  // Fallback: use the apiBaseUrl root
  return apiBaseUrl || undefined;
}

/**
 * Extract a version label from a probe response text.
 * Looks for common version patterns: v1.2.3, "version": "1.2.3", etc.
 */
function extractVersionLabel(text: string): string {
  const patterns = [
    /"version"\s*:\s*"([^"]+)"/i,
    /"api_version"\s*:\s*"([^"]+)"/i,
    /version[:\s]+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i,
    /v([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "unknown";
}

// ─── Main agent loop ──────────────────────────────────────────────────────────
/**
 * Run the source version tracking agent.
 * Checks each approved source for version changes and queues affected claims.
 */
export async function runSourceVersionAgent(): Promise<SourceVersionRunResult> {
  const t0 = Date.now();
  const outcomes: SourceVersionOutcome[] = [];
  let sourcesUpdated = 0;
  let sourcesUnchanged = 0;
  let sourcesErrored = 0;
  let sourcesSkipped = 0;

  const approvedSources = SOURCE_WHITELIST
    .filter(s => s.approved)
    .slice(0, MAX_SOURCES_PER_RUN);

  log.info(
    `[SourceVersionAgent] Starting run: ${approvedSources.length} approved sources`
  );

  for (const source of approvedSources) {
    // Skip sources with no probe URL (generic_url, doi_fallback)
    if (source.id === "generic_url" || source.id === "doi_fallback") {
      sourcesSkipped++;
      outcomes.push({ sourceId: source.id, status: "skipped" });
      continue;
    }

    try {
      const probe = await fetchSourceProbe(source.id, source.apiBaseUrl);
      if (!probe) {
        sourcesErrored++;
        outcomes.push({
          sourceId: source.id,
          status: "error",
          errorMessage: "Probe fetch returned null",
        });
        continue;
      }

      const newHash = computeVersionHash(probe.text);
      const existing = await getSourceVersion(source.id);
      const previousHash = existing?.versionHash ?? null;

      if (newHash === previousHash) {
        sourcesUnchanged++;
        outcomes.push({
          sourceId: source.id,
          status: "unchanged",
          previousHash,
          newHash,
        });
        continue;
      }

      // Hash changed — classify the change type
      const changeType = classifyChangeType(probe.text);
      const now = Math.floor(Date.now() / 1000);

      await upsertSourceVersion({
        sourceId: source.id,
        versionHash: newHash,
        versionLabel: probe.label,
        detectedAt: now,
        changeType,
        affectedClaimCount: 0, // updated by re-evaluation engine
      });

      // Publish event to autonomous loop so affected claims get re-evaluated
      await publishEvent("source_version_changed", {
        sourceId: source.id,
        changeType,
        previousHash,
        newHash,
        detectedAt: now,
      }).catch(err =>
        log.warn(
          `[SourceVersionAgent] publishEvent failed for ${source.id}:`,
          err
        )
      );

      sourcesUpdated++;
      outcomes.push({
        sourceId: source.id,
        status: existing ? "updated" : "new",
        changeType,
        previousHash,
        newHash,
      });

      log.info(
        `[SourceVersionAgent] ${source.id}: ${existing ? "updated" : "new"} (${changeType}) — hash ${previousHash?.slice(0, 8) ?? "none"} → ${newHash.slice(0, 8)}`
      );
    } catch (err) {
      sourcesErrored++;
      outcomes.push({
        sourceId: source.id,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      log.warn(
        `[SourceVersionAgent] ${source.id} error:`,
        errData(err)
      );
    }
  }

  const durationMs = Date.now() - t0;
  log.info(
    `[SourceVersionAgent] Run complete: ${sourcesUpdated} updated, ` +
      `${sourcesUnchanged} unchanged, ${sourcesErrored} errors, ` +
      `${sourcesSkipped} skipped — ${durationMs}ms`
  );

  return {
    sourcesChecked: approvedSources.length,
    sourcesUpdated,
    sourcesUnchanged,
    sourcesErrored,
    sourcesSkipped,
    outcomes,
    durationMs,
  };
}
