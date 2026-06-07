/**
 * sourceRegistry.ts — Source Whitelist
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines the authoritative list of approved data sources for Truth Desk.
 *
 * Each source entry specifies:
 *   - schema: the fields this source can verify
 *   - healthCheckFn: async function returning { healthy, latencyMs, error }
 *   - failureMode: "hard_stop" (block all verdicts) | "degrade" (return Insufficient Evidence)
 *   - approved: boolean — only approved sources are used in production
 *   - approvedAt: ISO date string when the source was whitelisted
 *
 * Rule: A source MUST be approved before it can be used in the pipeline.
 * Adding a source here is not sufficient — set approved: true explicitly.
 */

import { checkUniProtHealth } from "./verticalAdapters/uniprotVertical";
import { checkClinicalTrialsHealth } from "./clinicalTrialsAdapter";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FailureMode = "hard_stop" | "degrade";

export interface SourceHealthResult {
  healthy: boolean;
  latencyMs: number;
  error: string | null;
  checkedAt: string; // ISO timestamp
}

export interface SourceDefinition {
  /** Unique identifier for this source */
  id: string;
  /** Human-readable name */
  displayName: string;
  /** Short description of what this source verifies */
  description: string;
  /** Base URL for the source API */
  apiBaseUrl: string;
  /** Fields/claim types this source can verify */
  schema: string[];
  /** What happens when this source is unreachable */
  failureMode: FailureMode;
  /** Whether this source is approved for production use */
  approved: boolean;
  /** ISO date when the source was approved (null if pending) */
  approvedAt: string | null;
  /** Run a live health check against this source */
  healthCheckFn: () => Promise<{ healthy: boolean; latencyMs: number; error: string | null }>;
}

// ─── Source definitions ────────────────────────────────────────────────────────

export const SOURCE_WHITELIST: SourceDefinition[] = [
  {
    id: "rcsb_pdb",
    displayName: "RCSB Protein Data Bank (PDB)",
    description:
      "Verifies molecular structure claims: resolution, experimental method, " +
      "organism, ligands, and PDB ID existence. The reference source for structural biology.",
    apiBaseUrl: "https://data.rcsb.org/rest/v1",
    schema: ["pdb_id", "resolution", "experimental_method", "organism", "ligand", "protein_name"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2024-01-01",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          "https://data.rcsb.org/rest/v1/core/entry/1LYZ",
          { signal: AbortSignal.timeout(8_000) }
        );
        const latencyMs = Date.now() - start;
        if (!res.ok) return { healthy: false, latencyMs, error: `HTTP ${res.status}` };
        const data = await res.json() as Record<string, unknown>;
        const ok = !!(data?.entry_id ?? data?.rcsb_id);
        return { healthy: ok, latencyMs, error: ok ? null : "Unexpected response shape" };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  },

  {
    id: "pubmed",
    displayName: "PubMed E-utilities (NCBI)",
    description:
      "Verifies publication existence, author affiliations, and abstract content " +
      "for biomedical literature claims.",
    apiBaseUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
    schema: ["pmid", "doi", "publication_title", "author", "journal", "year"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2024-01-01",
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=11748933&retmode=json",
          { signal: AbortSignal.timeout(8_000) }
        );
        const latencyMs = Date.now() - start;
        if (!res.ok) return { healthy: false, latencyMs, error: `HTTP ${res.status}` };
        const data = await res.json() as Record<string, unknown>;
        const ok = !!(data?.result);
        return { healthy: ok, latencyMs, error: ok ? null : "Unexpected response shape" };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  },

  {
    id: "uniprot",
    displayName: "UniProt Knowledge Base (UniProtKB)",
    description:
      "Verifies protein identity claims: protein names, gene names, organism associations, " +
      "and functional annotations. Prioritises Swiss-Prot reviewed entries.",
    apiBaseUrl: "https://rest.uniprot.org/uniprotkb",
    schema: ["protein_name", "gene_name", "organism", "function", "uniprot_accession"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2025-06-07",
    healthCheckFn: checkUniProtHealth,
  },

  {
    id: "clinicaltrials_gov",
    displayName: "ClinicalTrials.gov (REST API v2)",
    description:
      "Verifies clinical trial claims: trial registration (NCT IDs), trial status, " +
      "interventions, phases, and enrollment counts.",
    apiBaseUrl: "https://clinicaltrials.gov/api/v2",
    schema: ["trial_id", "trial_status", "intervention", "trial_phase", "enrollment"],
    failureMode: "degrade",
    approved: true,
    approvedAt: "2025-06-07",
    healthCheckFn: checkClinicalTrialsHealth,
  },

  // ── Pending sources (not yet approved) ────────────────────────────────────

  {
    id: "openfda",
    displayName: "OpenFDA (FDA Adverse Events & Drug Labels)",
    description:
      "Will verify adverse event claims and drug label information for pharmaceutical claims. " +
      "Opens pharma verification vertical.",
    apiBaseUrl: "https://api.fda.gov",
    schema: ["adverse_event", "drug_label", "drug_name", "indication"],
    failureMode: "degrade",
    approved: false,
    approvedAt: null,
    healthCheckFn: async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          "https://api.fda.gov/drug/event.json?limit=1",
          { signal: AbortSignal.timeout(8_000) }
        );
        const latencyMs = Date.now() - start;
        return { healthy: res.ok, latencyMs, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err) {
        return { healthy: false, latencyMs: Date.now() - start, error: String(err) };
      }
    },
  },

  {
    id: "efsa_openfoodtox",
    displayName: "EFSA OpenFoodTox (Toxicological Data)",
    description:
      "Will verify toxicological claims and safety thresholds for food and feed substances. " +
      "Opens food safety verification vertical.",
    apiBaseUrl: "https://efsa.onlinelibrary.wiley.com/doi/10.2903/sp.efsa.2017.EN-1168",
    schema: ["substance_name", "tdi", "adi", "noael", "hazard_characterisation"],
    failureMode: "hard_stop",
    approved: false,
    approvedAt: null,
    healthCheckFn: async () => ({
      healthy: false,
      latencyMs: 0,
      error: "EFSA OpenFoodTox API integration not yet implemented",
    }),
  },
];

// ─── Registry helpers ──────────────────────────────────────────────────────────

export function getApprovedSources(): SourceDefinition[] {
  return SOURCE_WHITELIST.filter((s) => s.approved);
}

export function getPendingSources(): SourceDefinition[] {
  return SOURCE_WHITELIST.filter((s) => !s.approved);
}

export function getSourceById(id: string): SourceDefinition | undefined {
  return SOURCE_WHITELIST.find((s) => s.id === id);
}

export async function runHealthCheck(sourceId: string): Promise<SourceHealthResult | null> {
  const source = getSourceById(sourceId);
  if (!source) return null;
  const result = await source.healthCheckFn();
  return { ...result, checkedAt: new Date().toISOString() };
}

export async function runAllHealthChecks(): Promise<Record<string, SourceHealthResult>> {
  const results: Record<string, SourceHealthResult> = {};
  await Promise.allSettled(
    SOURCE_WHITELIST.map(async (source) => {
      try {
        const result = await source.healthCheckFn();
        results[source.id] = { ...result, checkedAt: new Date().toISOString() };
      } catch (err) {
        results[source.id] = {
          healthy: false,
          latencyMs: 0,
          error: String(err),
          checkedAt: new Date().toISOString(),
        };
      }
    })
  );
  return results;
}
