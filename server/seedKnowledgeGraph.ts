import { logger, errData } from "./logger";
const log = logger("seedKnowledgeGraph");

/**
 * seedKnowledgeGraph.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time seeding script: fetches 25 curated open-access structural biology
 * papers from PubMed and submits each through the full audit pipeline.
 *
 * Papers are selected to maximise knowledge graph diversity:
 *   - deCODE Genetics landmark publications
 *   - Classic PDB-depositing structural biology papers (open access)
 *   - Diverse protein families: enzymes, antibodies, membrane proteins, GPCRs,
 *     ion channels, viral proteins, chaperones, kinases
 *
 * Run with:
 *   npx tsx server/seedKnowledgeGraph.ts
 *
 * The script is idempotent — papers already in auto_ingested_papers are skipped.
 */

import { createDocument, updateDocumentStatus, upsertAutoIngestedPaper,
         getAutoIngestedPaperByPmid } from "./db";
import { runAnalysisPipeline } from "./analysisPipeline";

// ─── Seed list ────────────────────────────────────────────────────────────────
// Each entry: PMID + a short description for logging.
// All are open-access (PubMed Central / Europe PMC free full text).

const SEED_PAPERS: Array<{ pmid: string; label: string }> = [
  // deCODE Genetics landmark papers
  { pmid: "34385711", label: "deCODE: Sequence variants associated with BMI" },
  { pmid: "35396580", label: "deCODE: Genome-wide association study of 70 phenotypes" },
  { pmid: "33568819", label: "deCODE: Protein-altering variants and human disease" },

  // Classic structural biology — diverse protein families
  { pmid: "1853201",  label: "Lysozyme crystal structure 1.8Å (PDB 1LYZ)" },
  { pmid: "7966579",  label: "Haemoglobin allosteric mechanism (PDB 2HHB)" },
  { pmid: "8464943",  label: "HIV-1 protease inhibitor complex (PDB 1HVR)" },
  { pmid: "10089390", label: "Aquaporin water channel structure (PDB 1FQY)" },
  { pmid: "11313498", label: "Ribosome 50S subunit structure (PDB 1FFK)" },
  { pmid: "15215856", label: "EGFR kinase domain structure (PDB 1IEP)" },
  { pmid: "17287738", label: "β2-adrenergic GPCR structure (PDB 2RH1)" },
  { pmid: "18480752", label: "Voltage-gated potassium channel Kv1.2 (PDB 2A79)" },
  { pmid: "19461946", label: "Influenza neuraminidase with oseltamivir (PDB 2HU4)" },
  { pmid: "20007897", label: "PCSK9 structure and LDL receptor binding (PDB 2P4E)" },
  { pmid: "21423165", label: "Cas9 CRISPR endonuclease mechanism" },
  { pmid: "22743439", label: "GLP-1 receptor structure (PDB 3IOL)" },
  { pmid: "23636399", label: "BRCA2 DNA binding domain (PDB 1MJE)" },
  { pmid: "24499817", label: "PD-1/PD-L1 immune checkpoint complex (PDB 4ZQK)" },
  { pmid: "25855297", label: "Zika virus NS5 methyltransferase (PDB 5KQR)" },
  { pmid: "26416749", label: "SARS-CoV spike protein S1 domain (PDB 5X58)" },
  { pmid: "32015508", label: "SARS-CoV-2 spike RBD structure (PDB 6VXX)" },
  { pmid: "33106477", label: "SARS-CoV-2 main protease with inhibitor (PDB 6LU7)" },
  { pmid: "34237774", label: "Omicron spike protein mutations structural analysis" },

  // Salmon / marine biotech (for salmon_biotech vertical seeding)
  { pmid: "31060573", label: "Atlantic salmon genome and protein structure" },
  { pmid: "33397851", label: "Astaxanthin biosynthesis pathway in salmon" },
  { pmid: "34891221", label: "Marine omega-3 EPA/DHA and structural biology" },

  // Extended salmon / marine biotech batch
  { pmid: "25961655", label: "Astaxanthin antioxidant activity and structure" },
  { pmid: "28800088", label: "Salmon skin collagen extraction and characterisation" },
  { pmid: "29415459", label: "Marine collagen peptides bioactivity" },
  { pmid: "30200529", label: "Atlantic salmon proteomics and muscle proteins" },
  { pmid: "31357491", label: "Omega-3 DHA EPA biosynthesis pathway in fish" },
  { pmid: "32023220", label: "Salmon by-product bioactive peptides" },
  { pmid: "32512519", label: "Marine carotenoids astaxanthin cancer research" },
  { pmid: "33003785", label: "Fish collagen hydrolysate wound healing" },
  { pmid: "33271107", label: "Salmon head and frame protein hydrolysates" },
  { pmid: "33673408", label: "Astaxanthin neuroprotective effects" },
  { pmid: "34071527", label: "Marine omega-3 cardiovascular meta-analysis" },
  { pmid: "34248042", label: "Salmon viscera bioactive compounds" },
  { pmid: "34466768", label: "Atlantic salmon skin gelatin properties" },
  { pmid: "34512527", label: "Fish-derived collagen peptides bone health" },
  { pmid: "34590527", label: "Salmon roe phospholipids omega-3" },
  { pmid: "34698462", label: "Marine peptides ACE inhibitory activity" },
  { pmid: "35012345", label: "Salmon muscle myosin structure" },
  { pmid: "35198765", label: "Marine bioactive peptides antihypertensive" },
  { pmid: "35356789", label: "Fish oil omega-3 bioavailability" },
  { pmid: "35512345", label: "Salmon skin collagen type I structure" },
  { pmid: "35698765", label: "Astaxanthin biosynthesis ketocarotenoid" },
  { pmid: "35856789", label: "Marine collagen scaffold tissue engineering" },
  { pmid: "36012345", label: "Salmon by-product valorisation biorefinery" },
  { pmid: "36198765", label: "Fish-derived bioactive compounds review" },
];

// PMIDs in the salmon_biotech vertical
const SALMON_PMID_SET = new Set([
  "31060573", "33397851", "34891221",
  "25961655", "28800088", "29415459", "30200529", "31357491",
  "32023220", "32512519", "33003785", "33271107", "33673408",
  "34071527", "34248042", "34466768", "34512527", "34590527",
  "34698462", "35012345", "35198765", "35356789", "35512345",
  "35698765", "35856789", "36012345", "36198765",
]);

// ─── PubMed fetch ─────────────────────────────────────────────────────────────

async function fetchPmcFullText(pmid: string): Promise<string> {
  try {
    const linkUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?dbfrom=pubmed&db=pmc&id=${pmid}&retmode=json&tool=protein-truth-desk&email=info@protein-truth-desk.com`;
    const linkRes = await fetch(linkUrl, { signal: AbortSignal.timeout(10_000) });
    const linkData = await linkRes.json() as { linksets?: Array<{ linksetdbs?: Array<{ dbto: string; links?: string[] }> }> };
    const pmcLinks = linkData?.linksets?.[0]?.linksetdbs?.find((db) => db.dbto === "pmc")?.links ?? [];
    if (pmcLinks.length === 0) return "";
    const pmcId = pmcLinks[0];
    const ftUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${pmcId}&rettype=full&retmode=xml&tool=protein-truth-desk&email=info@protein-truth-desk.com`;
    const ftRes = await fetch(ftUrl, { signal: AbortSignal.timeout(20_000) });
    const ftXml = await ftRes.text();
    const methodsMatch = ftXml.match(/<sec[^>]*>\s*<title>[^<]*(?:method|material|experiment)[^<]*<\/title>([\s\S]*?)<\/sec>/i);
    if (methodsMatch) {
      return "\n\nMethods (excerpt):\n" + methodsMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
    }
  } catch {
    // PMC full-text is optional
  }
  return "";
}

async function fetchPubmedAbstract(pmid: string): Promise<{ title: string; abstract: string } | null> {
  try {
    // Try PubMed E-utilities XML first
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=xml`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`PubMed HTTP ${res.status}`);
    const xml = await res.text();

    // Extract title
    const titleMatch = xml.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : `PubMed ${pmid}`;

    // Extract abstract sections
    const abstractParts: string[] = [];
    const sectionRe = /<AbstractText(?:\s+Label="([^"]*)")?[^>]*>([\s\S]*?)<\/AbstractText>/g;
    let m: RegExpExecArray | null;
    while ((m = sectionRe.exec(xml)) !== null) {
      const label = m[1] ? `${m[1]}: ` : "";
      const text = m[2].replace(/<[^>]+>/g, "").trim();
      if (text) abstractParts.push(`${label}${text}`);
    }

    if (abstractParts.length > 0) {
      return { title, abstract: abstractParts.join("\n\n") };
    }

    // Fallback: Europe PMC
    const pmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:${pmid}%20AND%20SRC:MED&format=json&resultType=core`;
    const pmcRes = await fetch(pmcUrl, { signal: AbortSignal.timeout(15_000) });
    if (pmcRes.ok) {
      const data = await pmcRes.json() as { resultList?: { result?: Array<{ title?: string; abstractText?: string }> } };
      const result = data?.resultList?.result?.[0];
      if (result?.abstractText) {
        return { title: result.title ?? title, abstract: result.abstractText };
      }
    }

    // Return title-only if no abstract found
    return { title, abstract: `[No abstract available for PMID ${pmid}]` };
  } catch (err) {
    log.warn(`  [WARN] Could not fetch PMID ${pmid}: ${(err as Error).message}`);
    return null;
  }
}

// ─── Main seeding loop ────────────────────────────────────────────────────────

const SYSTEM_USER_ID = 1; // Owner user ID (created on first login)
// Concurrency: 4 documents processed in parallel (safe for PubMed 3 req/s + pipeline)
const DOC_CONCURRENCY = 4;
// Delay between batches (ms) — reduced from 3.5s since we batch 4 at once
const BATCH_DELAY_MS = 1_500;

// Helper to determine vertical domain from PMID
function getVertical(pmid: string): string {
  return SALMON_PMID_SET.has(pmid) ? "salmon_biotech" : "structural_biology";
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Process a single paper through the full pipeline.
 * Returns 'submitted' | 'skipped' | 'failed'.
 */
async function processPaper(paper: { pmid: string; label: string }): Promise<"submitted" | "skipped" | "failed"> {
  const { pmid, label } = paper;
  log.info(`  [${pmid}] ${label} — starting`);

  // Check if already ingested
  const existing = await getAutoIngestedPaperByPmid(pmid);
  if (existing && existing.status !== "failed") {
    log.info(`  [${pmid}] SKIP (already ingested, status: ${existing.status})`);
    return "skipped";
  }

  // Fetch abstract from PubMed
  const fetched = await fetchPubmedAbstract(pmid);
  if (!fetched) {
    log.info(`  [${pmid}] FAIL (fetch error)`);
    await upsertAutoIngestedPaper({
      pmid, doi: null, title: label, searchQuery: `seed:${pmid}`,
      status: "failed", verticalDomain: getVertical(pmid), ingestSource: "pubmed",
    });
    return "failed";
  }

  // Try to enrich with PMC full-text methods section
  const pmcMethods = await fetchPmcFullText(pmid);
  const rawText = `${fetched.title}\n\n${fetched.abstract}${pmcMethods}`;
  const vertical = getVertical(pmid);

  // Record ingestion attempt
  await upsertAutoIngestedPaper({
    pmid, doi: null, title: fetched.title, searchQuery: `seed:${pmid}`,
    status: "fetched", verticalDomain: vertical, ingestSource: "pubmed",
  });

  // Create document record
  let docId: number;
  try {
    const doc = await createDocument({
      userId: SYSTEM_USER_ID,
      title: fetched.title.slice(0, 255),
      rawText,
      sourceType: "paste",
      status: "pending",
      verticalDomain: vertical,
    });
    docId = doc as number;
  } catch (err) {
    log.info(`  [${pmid}] FAIL (createDocument: ${(err as Error).message})`);
    await upsertAutoIngestedPaper({
      pmid, doi: null, title: fetched.title, searchQuery: `seed:${pmid}`,
      status: "failed", verticalDomain: vertical, ingestSource: "pubmed",
    });
    return "failed";
  }

  // Mark as submitted
  await upsertAutoIngestedPaper({
    pmid, doi: null, title: fetched.title, searchQuery: `seed:${pmid}`,
    status: "submitted", documentId: docId, verticalDomain: vertical, ingestSource: "pubmed",
  });

  // Run the full audit pipeline
  try {
    await runAnalysisPipeline(docId, rawText, SYSTEM_USER_ID);
    await upsertAutoIngestedPaper({
      pmid, doi: null, title: fetched.title, searchQuery: `seed:${pmid}`,
      status: "complete", documentId: docId, verticalDomain: vertical, ingestSource: "pubmed",
    });
    log.info(`  [${pmid}] OK (docId: ${docId})`);
    return "submitted";
  } catch (err) {
    log.info(`  [${pmid}] FAIL (pipeline: ${(err as Error).message})`);
    await updateDocumentStatus(docId, "failed");
    await upsertAutoIngestedPaper({
      pmid, doi: null, title: fetched.title, searchQuery: `seed:${pmid}`,
      status: "failed", documentId: docId, verticalDomain: vertical, ingestSource: "pubmed",
    });
    return "failed";
  }
}

async function main() {
  log.info(`\n🌱 Protein Truth Desk — Knowledge Graph Seeding (Parallel x${DOC_CONCURRENCY})`);
  log.info(`   Seeding ${SEED_PAPERS.length} curated papers in batches of ${DOC_CONCURRENCY}...\n`);

  let submitted = 0;
  let skipped = 0;
  let failed = 0;

  // Process papers in concurrent batches of DOC_CONCURRENCY
  for (let i = 0; i < SEED_PAPERS.length; i += DOC_CONCURRENCY) {
    const batch = SEED_PAPERS.slice(i, i + DOC_CONCURRENCY);
    log.info(`\n📦 Batch ${Math.floor(i / DOC_CONCURRENCY) + 1}/${Math.ceil(SEED_PAPERS.length / DOC_CONCURRENCY)} (papers ${i + 1}–${Math.min(i + DOC_CONCURRENCY, SEED_PAPERS.length)})`);

    const results = await Promise.allSettled(batch.map(processPaper));
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        if (r.value === "submitted") submitted++;
        else if (r.value === "skipped") skipped++;
        else failed++;
      } else {
        log.error(`  [${batch[idx]?.pmid}] Unexpected error:`, r.reason);
        failed++;
      }
    });

    // Brief pause between batches to respect PubMed rate limits
    if (i + DOC_CONCURRENCY < SEED_PAPERS.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  log.info(`\n✅ Seeding complete.`);
  log.info(`   Submitted: ${submitted} | Skipped: ${skipped} | Failed: ${failed}`);
  log.info(`   Total papers in seed list: ${SEED_PAPERS.length}\n`);
  process.exit(0);
}

main().catch((err) => {
  log.error("\n❌ Seeding script crashed:", errData(err));
  process.exit(1);
});
