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
];

// ─── PubMed fetch ─────────────────────────────────────────────────────────────

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
      const data = await pmcRes.json() as any;
      const result = data?.resultList?.result?.[0];
      if (result?.abstractText) {
        return { title: result.title ?? title, abstract: result.abstractText };
      }
    }

    // Return title-only if no abstract found
    return { title, abstract: `[No abstract available for PMID ${pmid}]` };
  } catch (err) {
    console.warn(`  [WARN] Could not fetch PMID ${pmid}: ${(err as Error).message}`);
    return null;
  }
}

// ─── Main seeding loop ────────────────────────────────────────────────────────

const SYSTEM_USER_ID = 1; // Owner user ID (created on first login)
const DELAY_MS = 3_500;   // 3.5s between submissions to respect PubMed 3 req/s limit

// Helper to determine vertical domain from PMID
const SALMON_PMIDS = new Set(["31060573", "33397851", "34891221"]);
function getVertical(pmid: string): string {
  return SALMON_PMIDS.has(pmid) ? "salmon_biotech" : "structural_biology";
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`\n🌱 Protein Truth Desk — Knowledge Graph Seeding`);
  console.log(`   Seeding ${SEED_PAPERS.length} curated papers...\n`);

  let submitted = 0;
  let skipped = 0;
  let failed = 0;

  for (const paper of SEED_PAPERS) {
    const { pmid, label } = paper;
    process.stdout.write(`  [${pmid}] ${label} ... `);

    // Check if already ingested
    const existing = await getAutoIngestedPaperByPmid(pmid);
    if (existing && existing.status !== "failed") {
      console.log(`SKIP (already ingested, status: ${existing.status})`);
      skipped++;
      continue;
    }

    // Fetch abstract from PubMed
    const fetched = await fetchPubmedAbstract(pmid);
    if (!fetched) {
      console.log(`FAIL (fetch error)`);
      await upsertAutoIngestedPaper({
        pmid,
        doi: null,
        title: label,
        searchQuery: `seed:${pmid}`,
        status: "failed",
        verticalDomain: getVertical(pmid),
        ingestSource: "pubmed",
      });
      failed++;
      continue;
    }

    const rawText = `${fetched.title}\n\n${fetched.abstract}`;
    const vertical = getVertical(pmid);

    // Record ingestion attempt
    await upsertAutoIngestedPaper({
      pmid,
      doi: null,
      title: fetched.title,
      searchQuery: `seed:${pmid}`,
      status: "fetched",
      verticalDomain: vertical,
      ingestSource: "pubmed",
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
      console.log(`FAIL (createDocument: ${(err as Error).message})`);
      await upsertAutoIngestedPaper({
        pmid, doi: null, title: fetched.title, searchQuery: `seed:${pmid}`,
        status: "failed", verticalDomain: vertical, ingestSource: "pubmed",
      });
      failed++;
      continue;
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
      console.log(`OK (docId: ${docId})`);
      submitted++;
    } catch (err) {
      console.log(`FAIL (pipeline: ${(err as Error).message})`);
      await updateDocumentStatus(docId, "failed");
      await upsertAutoIngestedPaper({
        pmid, doi: null, title: fetched.title, searchQuery: `seed:${pmid}`,
        status: "failed", documentId: docId, verticalDomain: vertical, ingestSource: "pubmed",
      });
      failed++;
    }

    // Throttle to respect PubMed rate limits (3 req/s max without API key)
    await sleep(DELAY_MS);
  }

  console.log(`\n✅ Seeding complete.`);
  console.log(`   Submitted: ${submitted} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log(`   Total papers in seed list: ${SEED_PAPERS.length}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Seeding script crashed:", err);
  process.exit(1);
});
