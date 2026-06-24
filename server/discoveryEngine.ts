/**
 * discoveryEngine.ts — Auto-Discovery Engine
 *
 * Autonomously discovers, probes, and registers scientific data sources for a
 * given vertical. Generates TypeScript adapter stubs that can be dropped into
 * the verification pipeline.
 *
 * Pipeline:
 *  Phase 1: match   — filter the built-in registry for the requested vertical
 *  Phase 2: probe   — HTTP health-check each candidate source
 *  Phase 3: codegen — generate a TypeScript adapter stub via LLM
 *  Phase 4: register — persist approved sources to source_registry_entries
 */

import { getDb } from "./db";
import { discoveryRuns, sourceRegistryEntries } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { invokeLLM } from "./_core/llm";

// ─── Built-in source registry (15+ databases) ────────────────────────────────

export interface BuiltInSource {
  sourceId: string;
  displayName: string;
  baseUrl: string;
  category:
    | "protein_structure"
    | "sequence"
    | "literature"
    | "clinical"
    | "chemistry"
    | "genomics"
    | "nutrition"
    | "regulatory"
    | "other";
  verticals: string[];
  probeEndpoint: string;
  rateLimitRpm?: number;
  schemaDescription: string;
}

export const BUILT_IN_SOURCES: BuiltInSource[] = [
  // ── Structural biology ────────────────────────────────────────────────────
  {
    sourceId: "rcsb_pdb",
    displayName: "RCSB Protein Data Bank",
    baseUrl: "https://data.rcsb.org",
    category: "protein_structure",
    verticals: ["structural_biology", "salmon_biotech", "uniprot", "hiv_protease"],
    probeEndpoint: "https://data.rcsb.org/rest/v1/core/entry/1LYZ",
    rateLimitRpm: 60,
    schemaDescription: "REST API for 3D molecular structures. GET /rest/v1/core/entry/{pdbId} returns resolution, method, organism, authors.",
  },
  {
    sourceId: "pdbe",
    displayName: "PDBe (EMBL-EBI)",
    baseUrl: "https://www.ebi.ac.uk/pdbe",
    category: "protein_structure",
    verticals: ["structural_biology", "hiv_protease"],
    probeEndpoint: "https://www.ebi.ac.uk/pdbe/api/pdb/entry/summary/1lyz",
    rateLimitRpm: 60,
    schemaDescription: "REST API for PDB entries. GET /pdbe/api/pdb/entry/summary/{pdbId} returns title, resolution, method.",
  },
  // ── Sequence / function ───────────────────────────────────────────────────
  {
    sourceId: "uniprot",
    displayName: "UniProt",
    baseUrl: "https://rest.uniprot.org",
    category: "sequence",
    verticals: ["structural_biology", "salmon_biotech", "uniprot", "plant_based_protein"],
    probeEndpoint: "https://rest.uniprot.org/uniprotkb/P00698.json",
    rateLimitRpm: 100,
    schemaDescription: "REST API for protein sequences and function. GET /uniprotkb/{accession}.json returns sequence, organism, function, GO terms.",
  },
  {
    sourceId: "interpro",
    displayName: "InterPro",
    baseUrl: "https://www.ebi.ac.uk/interpro",
    category: "sequence",
    verticals: ["structural_biology", "uniprot"],
    probeEndpoint: "https://www.ebi.ac.uk/interpro/api/protein/UniProt/P00698/?format=json",
    rateLimitRpm: 30,
    schemaDescription: "REST API for protein family and domain classification. GET /api/protein/UniProt/{accession}/?format=json",
  },
  // ── Literature ────────────────────────────────────────────────────────────
  {
    sourceId: "pubmed",
    displayName: "PubMed (NCBI)",
    baseUrl: "https://eutils.ncbi.nlm.nih.gov",
    category: "literature",
    verticals: ["structural_biology", "salmon_biotech", "protein_supplement", "creatine_ergogenics", "gut_microbiome", "collagen_peptides", "plant_based_protein", "sports_nutrition_rct", "clinical_trials", "hiv_protease"],
    probeEndpoint: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=lysozyme&retmax=1&retmode=json",
    rateLimitRpm: 10,
    schemaDescription: "E-utilities API for PubMed literature search. esearch.fcgi?db=pubmed&term={query}&retmode=json",
  },
  {
    sourceId: "pmc",
    displayName: "PubMed Central (PMC)",
    baseUrl: "https://www.ncbi.nlm.nih.gov/pmc",
    category: "literature",
    verticals: ["structural_biology", "salmon_biotech", "sports_nutrition_rct", "gut_microbiome", "hiv_protease"],
    probeEndpoint: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=protein+structure&retmax=1&retmode=json",
    rateLimitRpm: 10,
    schemaDescription: "PMC Open Access full-text articles. esearch.fcgi?db=pmc&term={query}&retmode=json",
  },
  {
    sourceId: "europe_pmc",
    displayName: "Europe PMC",
    baseUrl: "https://www.ebi.ac.uk/europepmc",
    category: "literature",
    verticals: ["structural_biology", "salmon_biotech", "clinical_trials"],
    probeEndpoint: "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=lysozyme&format=json&pageSize=1",
    rateLimitRpm: 30,
    schemaDescription: "REST API for life science literature. GET /webservices/rest/search?query={term}&format=json",
  },
  // ── Chemistry ─────────────────────────────────────────────────────────────
  {
    sourceId: "pubchem",
    displayName: "PubChem",
    baseUrl: "https://pubchem.ncbi.nlm.nih.gov",
    category: "chemistry",
    verticals: ["protein_supplement", "creatine_ergogenics", "gut_microbiome", "collagen_peptides", "plant_based_protein"],
    probeEndpoint: "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/creatine/JSON",
    rateLimitRpm: 60,
    schemaDescription: "REST API for chemical compounds. GET /rest/pug/compound/name/{name}/JSON returns CID, molecular weight, synonyms.",
  },
  {
    sourceId: "chembl",
    displayName: "ChEMBL",
    baseUrl: "https://www.ebi.ac.uk/chembl",
    category: "chemistry",
    verticals: ["protein_supplement", "creatine_ergogenics", "hiv_protease"],
    probeEndpoint: "https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL1200584.json",
    rateLimitRpm: 30,
    schemaDescription: "REST API for bioactive molecules. GET /api/data/molecule/{chemblId}.json returns bioactivity, targets.",
  },
  // ── Clinical ──────────────────────────────────────────────────────────────
  {
    sourceId: "clinicaltrials",
    displayName: "ClinicalTrials.gov",
    baseUrl: "https://clinicaltrials.gov",
    category: "clinical",
    verticals: ["clinical_trials", "creatine_ergogenics", "gut_microbiome", "collagen_peptides", "sports_nutrition_rct"],
    probeEndpoint: "https://clinicaltrials.gov/api/v2/studies?query.term=creatine&pageSize=1&format=json",
    rateLimitRpm: 60,
    schemaDescription: "REST API v2 for clinical trials. GET /api/v2/studies?query.term={term}&format=json",
  },
  {
    sourceId: "openfda",
    displayName: "OpenFDA",
    baseUrl: "https://api.fda.gov",
    category: "regulatory",
    verticals: ["clinical_trials", "protein_supplement"],
    probeEndpoint: "https://api.fda.gov/drug/label.json?search=creatine&limit=1",
    rateLimitRpm: 240,
    schemaDescription: "REST API for FDA drug labels, adverse events. GET /drug/label.json?search={term}&limit={n}",
  },
  // ── Genomics ──────────────────────────────────────────────────────────────
  {
    sourceId: "ensembl",
    displayName: "Ensembl",
    baseUrl: "https://rest.ensembl.org",
    category: "genomics",
    verticals: ["salmon_biotech", "structural_biology"],
    probeEndpoint: "https://rest.ensembl.org/lookup/symbol/homo_sapiens/BRCA2?content-type=application/json",
    rateLimitRpm: 15,
    schemaDescription: "REST API for genome annotations. GET /lookup/symbol/{species}/{gene}?content-type=application/json",
  },
  {
    sourceId: "ncbi_gene",
    displayName: "NCBI Gene",
    baseUrl: "https://eutils.ncbi.nlm.nih.gov",
    category: "genomics",
    verticals: ["salmon_biotech", "structural_biology"],
    probeEndpoint: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gene&term=BRCA2[gene]+homo+sapiens[organism]&retmode=json",
    rateLimitRpm: 10,
    schemaDescription: "E-utilities API for gene records. esearch.fcgi?db=gene&term={gene}[gene]+{organism}[organism]&retmode=json",
  },
  // ── Nutrition ─────────────────────────────────────────────────────────────
  {
    sourceId: "usda_fdc",
    displayName: "USDA FoodData Central",
    baseUrl: "https://api.nal.usda.gov",
    category: "nutrition",
    verticals: ["protein_supplement", "plant_based_protein", "collagen_peptides"],
    probeEndpoint: "https://api.nal.usda.gov/fdc/v1/foods/search?query=whey+protein&pageSize=1&api_key=DEMO_KEY",
    rateLimitRpm: 30,
    schemaDescription: "REST API for food nutrient data. GET /fdc/v1/foods/search?query={term}&api_key={key}",
  },
  {
    sourceId: "openfoodfacts",
    displayName: "Open Food Facts",
    baseUrl: "https://world.openfoodfacts.org",
    category: "nutrition",
    verticals: ["protein_supplement", "plant_based_protein"],
    probeEndpoint: "https://world.openfoodfacts.org/cgi/search.pl?search_terms=whey+protein&search_simple=1&action=process&json=1&page_size=1",
    rateLimitRpm: 30,
    schemaDescription: "REST API for food product data. GET /cgi/search.pl?search_terms={term}&json=1",
  },
  // ── Salmon-specific ───────────────────────────────────────────────────────
  {
    sourceId: "aquadocs",
    displayName: "AquaDocs",
    baseUrl: "https://aquadocs.org",
    category: "literature",
    verticals: ["salmon_biotech"],
    probeEndpoint: "https://aquadocs.org/oai/request?verb=Identify",
    rateLimitRpm: 10,
    schemaDescription: "OAI-PMH repository for aquatic science literature. verb=ListRecords&metadataPrefix=oai_dc&set=salmon",
  },
];

// ─── Probe function ───────────────────────────────────────────────────────────

export interface ProbeResult {
  sourceId: string;
  isHealthy: boolean;
  statusCode?: number;
  latencyMs?: number;
  errorMessage?: string;
}

export async function probeSource(source: BuiltInSource): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const res = await fetch(source.probeEndpoint, {
      method: "GET",
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "TruthDesk-Discovery/1.0" },
    });
    return {
      sourceId: source.sourceId,
      isHealthy: res.ok,
      statusCode: res.status,
      latencyMs: Date.now() - start,
    };
  } catch (e: unknown) {
    return {
      sourceId: source.sourceId,
      isHealthy: false,
      latencyMs: Date.now() - start,
      errorMessage: String(e).slice(0, 200),
    };
  }
}

// ─── Adapter stub codegen ─────────────────────────────────────────────────────

export async function generateAdapterStub(source: BuiltInSource): Promise<string> {
  const prompt = `Generate a TypeScript adapter stub for the following scientific data source.
The adapter should export a single async function \`fetch${toPascalCase(source.sourceId)}(query: string): Promise<SourceResult[]>\`.
SourceResult has: { id: string; title: string; snippet: string; url: string; confidence: number }.

Source details:
- Name: ${source.displayName}
- Base URL: ${source.baseUrl}
- Category: ${source.category}
- Schema: ${source.schemaDescription}
- Probe endpoint: ${source.probeEndpoint}

Requirements:
1. Use native fetch() — no external HTTP libraries
2. Handle rate limiting with exponential backoff (max 3 retries)
3. Return empty array on error (never throw)
4. Add a 1-sentence JSDoc comment
5. Keep it under 60 lines

Output ONLY the TypeScript code, no markdown fences.`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a TypeScript code generator. Output only valid TypeScript code." },
        { role: "user", content: prompt },
      ],
    });
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    return `// Auto-generated stub for ${source.displayName}\nexport async function fetch${toPascalCase(source.sourceId)}(_query: string) { return []; }`;
  } catch {
    return `// Auto-generated stub for ${source.displayName}\nexport async function fetch${toPascalCase(source.sourceId)}(_query: string) { return []; }`;
  }
}

function toPascalCase(s: string): string {
  return s.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase());
}

// ─── Discovery run orchestrator ───────────────────────────────────────────────

export interface DiscoveryRunLog {
  phase: string;
  message: string;
  ts: number;
}

export async function runDiscovery(opts: {
  runId: number;
  verticalKey: string;
  skipProbe?: boolean;
  skipCodegen?: boolean;
}): Promise<void> {
  const { runId, verticalKey, skipProbe = false, skipCodegen = false } = opts;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const log: DiscoveryRunLog[] = [];
  const addLog = async (phase: string, message: string) => {
    log.push({ phase, message, ts: Date.now() });
    await db
      .update(discoveryRuns)
      .set({ runLog: log, currentPhase: phase })
      .where(eq(discoveryRuns.id, runId));
  };

  try {
    // ── Phase 1: Match ──────────────────────────────────────────────────────
    await addLog("match", `Matching sources for vertical: ${verticalKey}`);
    const matched = BUILT_IN_SOURCES.filter((s) => s.verticals.includes(verticalKey));
    await db
      .update(discoveryRuns)
      .set({ sourcesMatched: matched.length })
      .where(eq(discoveryRuns.id, runId));
    await addLog("match", `Found ${matched.length} candidate sources`);

    // ── Phase 2: Probe ──────────────────────────────────────────────────────
    const probeResults: ProbeResult[] = [];
    if (!skipProbe) {
      await addLog("probe", `Probing ${matched.length} sources…`);
      for (const source of matched) {
        const result = await probeSource(source);
        probeResults.push(result);
        await addLog(
          "probe",
          `${source.displayName}: ${result.isHealthy ? "✓ healthy" : "✗ unhealthy"} (${result.latencyMs}ms)`
        );
      }
      await db
        .update(discoveryRuns)
        .set({ sourcesProbed: probeResults.length })
        .where(eq(discoveryRuns.id, runId));
    } else {
      matched.forEach((s) => probeResults.push({ sourceId: s.sourceId, isHealthy: true }));
    }

    const healthySources = matched.filter((s) =>
      probeResults.find((r) => r.sourceId === s.sourceId)?.isHealthy !== false
    );

    // ── Phase 3: Codegen ────────────────────────────────────────────────────
    const adapterFiles: Array<{ sourceId: string; filename: string; code: string }> = [];
    if (!skipCodegen) {
      await addLog("codegen", `Generating adapters for ${healthySources.length} healthy sources…`);
      for (const source of healthySources) {
        const code = await generateAdapterStub(source);
        adapterFiles.push({
          sourceId: source.sourceId,
          filename: `adapters/${source.sourceId}.ts`,
          code,
        });
        await addLog("codegen", `Generated adapter: adapters/${source.sourceId}.ts`);
      }
      await db
        .update(discoveryRuns)
        .      set({ adaptersGenerated: adapterFiles.length, adapterFiles: adapterFiles.map(f => f.filename) })
        .where(eq(discoveryRuns.id, runId));
    }

    // ── Phase 4: Register ───────────────────────────────────────────────────
    await addLog("register", `Registering ${healthySources.length} sources…`);
    const registeredSourceIds: string[] = [];

    for (const source of healthySources) {
      const probeResult = probeResults.find((r) => r.sourceId === source.sourceId);
      const adapterFile = adapterFiles.find((f) => f.sourceId === source.sourceId);

      try {
        await db
          .insert(sourceRegistryEntries)
          .values({
            sourceId: source.sourceId,
            displayName: source.displayName,
            baseUrl: source.baseUrl,
            category: source.category,
            verticals: source.verticals,
            approvalStatus: "approved",
            isHealthy: probeResult?.isHealthy ?? true,
            lastHealthCheckAt: new Date(),
            lastHealthStatus: probeResult?.statusCode,
            adapterStub: adapterFile?.code,
            discoveryRunId: runId,
            schemaDescription: source.schemaDescription,
            rateLimitRpm: source.rateLimitRpm,
          })
          .onDuplicateKeyUpdate({
            set: {
              isHealthy: probeResult?.isHealthy ?? true,
              lastHealthCheckAt: new Date(),
              lastHealthStatus: probeResult?.statusCode,
              adapterStub: adapterFile?.code,
            },
          });
        registeredSourceIds.push(source.sourceId);
      } catch (e: unknown) {
        await addLog("register", `Failed to register ${source.sourceId}: ${String(e).slice(0, 100)}`);
      }
    }

    await db
      .update(discoveryRuns)
      .set({
        registeredSources: registeredSourceIds,
        status: "complete",
        completedAt: new Date(),
      })
      .where(eq(discoveryRuns.id, runId));

    await addLog("done", `Discovery complete. Registered ${registeredSourceIds.length} sources.`);
  } catch (e: unknown) {
    await db
      .update(discoveryRuns)
      .set({
        status: "failed",
        errorMessage: String(e).slice(0, 500),
        completedAt: new Date(),
      })
      .where(eq(discoveryRuns.id, runId));
    throw e;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

export async function createDiscoveryRun(verticalKey: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .insert(discoveryRuns)
    .values({ verticalKey, status: "running", runLog: [] })
    .$returningId();
  return row.id;
}

export async function getDiscoveryRun(runId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(discoveryRuns)
    .where(eq(discoveryRuns.id, runId));
  return row;
}

export async function getDiscoveryRunsByVertical(verticalKey: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(discoveryRuns)
    .where(eq(discoveryRuns.verticalKey, verticalKey))
    .orderBy(discoveryRuns.startedAt);
}

export async function getRegistryEntriesByVertical(verticalKey: string) {
  const db = await getDb();
  if (!db) return [];
  // Filter by JSON array column — use raw SQL for portability
  const rows = await db.select().from(sourceRegistryEntries);
  return rows.filter((r) => {
    const v = r.verticals as string[] | null;
    return Array.isArray(v) && v.includes(verticalKey);
  });
}

export async function getAllRegistryEntries() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sourceRegistryEntries);
}
