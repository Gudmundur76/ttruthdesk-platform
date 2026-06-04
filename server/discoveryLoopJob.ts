/**
 * discoveryLoopJob.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/scheduled/discovery-loop
 *
 * Autonomous multi-source seeding loop. Called by the Manus heartbeat scheduler.
 * Runs the discovery agent across all registered verticals, deduplicates against
 * already-ingested papers, applies quality gates, and submits new candidates to
 * the audit pipeline.
 *
 * Quality gate: papers whose title+abstract contain fewer than 2 verifiable
 * claim signals are skipped (low signal density). This keeps the graph clean.
 */

import type { Request, Response } from "express";
import { runDiscoveryAgent } from "./discoveryAgent";
import { listVerticals } from "./verticalAdapters/index";
import {
  upsertAutoIngestedPaper,
  updateAutoIngestedPaperStatus,
  getAutoIngestedPaperByPmid,
  createDocument,
} from "./db";
import { runAnalysisPipeline } from "./analysisPipeline";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";

// ─── Claim signal density check ───────────────────────────────────────────────

export const CLAIM_SIGNALS = [
  // ── Structural biology ──────────────────────────────────────────────────────
  /\bPDB\b/i,
  /\b[1-9][A-Z0-9]{3}\b/,           // PDB ID pattern e.g. 1ABC
  /\bcrystal structure\b/i,
  /\bcryo-?EM\b/i,
  /\bX-ray\b/i,
  /\bresolution\b.*\bÅ\b/i,
  /\bAlphaFold\b/i,
  /\bRoseTTAFold\b/i,
  /\bprotein structure\b/i,
  /\bstructure determination\b/i,
  /\bactive site\b/i,
  /\bbinding site\b/i,
  /\bbinding affinity\b/i,
  /\bIC50\b/i,
  /\bKd\b/,
  /\bKi\b/,
  /\bEC50\b/i,
  /\bmolecular docking\b/i,
  /\bhomology model\b/i,
  /\bprotein folding\b/i,
  /\bconformation\b/i,
  /\bprotein-protein interaction\b/i,
  /\bligand binding\b/i,
  /\bcatalytic mechanism\b/i,
  /\bkinase\b/i,
  /\bprotease\b/i,
  /\breceptor\b/i,
  /\bsignal transduction\b/i,
  // ── Salmon / aquaculture / marine biotech ───────────────────────────────────
  /\bomega-3\b/i,
  /\bastaxanthin\b/i,
  /\bcollagen\b/i,
  /\bEPA\b/,
  /\bDHA\b/,
  /\bmarine peptide\b/i,
  /\bSalmo salar\b/i,
  /\bAtlantic salmon\b/i,
  /\baquaculture\b/i,
  /\bfish oil\b/i,
  /\bsalmonid\b/i,
  /\bfeed conversion\b/i,
  /\bmicrobiome\b/i,
  /\bgut microbiota\b/i,
  /\bprobiotics?\b/i,
  /\bimmune response\b/i,
  /\bvaccine\b/i,
  /\bsea lice\b/i,
  /\bfatty acid\b/i,
  /\blipid\b/i,
  /\bantioxidant\b/i,
  /\bbioactive peptide\b/i,
  /\bhydrolysate\b/i,
  /\bgenomics\b/i,
  /\btranscriptome\b/i,
  /\bproteomics\b/i,
  /\bgene expression\b/i,
  /\bRNA-seq\b/i,
  /\bCRISPR\b/i,
  // ── General biomedical ──────────────────────────────────────────────────────
  /\bclinical trial\b/i,
  /\brandomized controlled\b/i,
  /\bmeta-analysis\b/i,
  /\bstatistically significant\b/i,
  /\bp\s*[<=>]\s*0\.0[0-9]/,        // p-value e.g. p<0.05
  /\b95%\s*(?:confidence interval|CI)\b/i,
  /\bbiomarker\b/i,
  /\btherapeutic\b/i,
  /\bdrug target\b/i,
  /\binhibitor\b/i,
  /\bagonist\b/i,
  /\bantagonist\b/i,
  /\bcytotoxicity\b/i,
  /\bapoptosis\b/i,
  /\bin vitro\b/i,
  /\bin vivo\b/i,
  /\banimal model\b/i,
  /\bcell line\b/i,
];

export function computeSignalDensity(text: string): number {
  return CLAIM_SIGNALS.filter((re) => re.test(text)).length;
}

// ─── Abstract fetcher ─────────────────────────────────────────────────────────

async function fetchAbstract(pmid: string): Promise<string | null> {
  if (pmid.startsWith("biorxiv:") || pmid.startsWith("pdb:")) return null;
  try {
    const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
    url.searchParams.set("db", "pubmed");
    url.searchParams.set("id", pmid);
    url.searchParams.set("rettype", "abstract");
    url.searchParams.set("retmode", "text");
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/AB\s+-\s+([\s\S]+?)(?:\n\n|\nFAU\s+-|\nMH\s+-|$)/);
    return match?.[1]?.replace(/\s+/g, " ").trim() ?? text.slice(0, 1000);
  } catch {
    return null;
  }
}

// ─── Bearer token check ───────────────────────────────────────────────────────

function isAuthorised(req: Request): boolean {
  if (!ENV.forgeApiKey) return true; // no key configured = open
  const auth = req.headers["authorization"] ?? "";
  return auth === `Bearer ${ENV.forgeApiKey}`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

// System user ID for auto-ingested documents (owner account)
// We use OWNER_OPEN_ID from env to find the owner's user record.
const SYSTEM_USER_ID = 1; // fallback; real ID resolved at runtime from env

export async function handleDiscoveryLoop(req: Request, res: Response): Promise<void> {
  if (!isAuthorised(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const startedAt = Date.now();
  const stats = {
    discovered: 0,
    alreadyIngested: 0,
    lowSignal: 0,
    submitted: 0,
    failed: 0,
  };

  try {
    const verticals = listVerticals();
    console.log(`[DiscoveryLoop] Running with ${verticals.length} verticals`);

    // Run multi-source discovery
    const discovery = await runDiscoveryAgent({
      pubmedMaxPerQuery: 6,
      bioRxivMaxPerCategory: 4,
      pdbMaxResults: 6,
    });
    stats.discovered = discovery.deduplicatedCount;
    console.log(
      `[DiscoveryLoop] Discovered ${discovery.deduplicatedCount} candidates ` +
      `(${discovery.totalFetched} raw, sources: ${JSON.stringify(discovery.sourceBreakdown)})`
    );

    if (discovery.candidates.length === 0) {
      res.json({ ok: true, stats, durationMs: Date.now() - startedAt });
      return;
    }

    // Deduplicate against already-ingested papers
    const newCandidates = [];
    for (const candidate of discovery.candidates) {
      const existing = await getAutoIngestedPaperByPmid(candidate.pmid);
      if (existing) {
        stats.alreadyIngested++;
      } else {
        newCandidates.push(candidate);
      }
    }
    console.log(`[DiscoveryLoop] ${newCandidates.length} new candidates after dedup`);

    // Process each new candidate
    for (const candidate of newCandidates) {
      try {
        // Fetch abstract if not already present
        const abstractText = candidate.abstractText ?? await fetchAbstract(candidate.pmid);

        // Quality gate: signal density check
        const textToScore = `${candidate.title} ${abstractText ?? ""}`;
        const density = computeSignalDensity(textToScore);
        if (density < 2) {
          stats.lowSignal++;
          console.log(
            `[DiscoveryLoop] Skipping low-signal: "${candidate.title.slice(0, 60)}" (density=${density})`
          );
          // Record so we don't re-fetch
          await upsertAutoIngestedPaper({
            pmid: candidate.pmid,
            doi: candidate.doi,
            title: candidate.title,
            authors: candidate.authors,
            journal: candidate.journal,
            pubYear: candidate.pubYear,
            searchQuery: candidate.searchQuery,
            status: "failed",
            errorMessage: `Low signal density: ${density}/2 required`,
            isPublic: false,
            verticalDomain: "structural_biology",
            ingestSource: candidate.ingestSource,
          });
          continue;
        }

        // Record as fetched
        await upsertAutoIngestedPaper({
          pmid: candidate.pmid,
          doi: candidate.doi,
          title: candidate.title,
          authors: candidate.authors,
          journal: candidate.journal,
          pubYear: candidate.pubYear,
          searchQuery: candidate.searchQuery,
          status: "fetched",
          isPublic: true,
          verticalDomain: "structural_biology",
          ingestSource: candidate.ingestSource,
        });

        // Build raw text for the audit pipeline
        const rawText = [
          `Title: ${candidate.title}`,
          candidate.authors ? `Authors: ${candidate.authors}` : null,
          candidate.journal ? `Journal: ${candidate.journal}` : null,
          candidate.pubYear ? `Year: ${candidate.pubYear}` : null,
          candidate.doi ? `DOI: ${candidate.doi}` : null,
          abstractText ? `\nAbstract:\n${abstractText}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        // Insert document record
        const docResult = await createDocument({
          userId: SYSTEM_USER_ID,
          title: candidate.title.slice(0, 512),
          sourceType: "paste",
          rawText,
          status: "pending",
          claimCount: 0,
          verticalDomain: "structural_biology",
        });
        const documentId = (docResult as unknown as { insertId: number }).insertId;

        // Mark as submitted
        await updateAutoIngestedPaperStatus(candidate.pmid, "submitted", { documentId });

        // Fire-and-forget: run the full audit pipeline asynchronously
        const pmidKey = candidate.pmid;
        setImmediate(() => {
          runAnalysisPipeline(documentId, rawText, SYSTEM_USER_ID)
            .then(() => updateAutoIngestedPaperStatus(pmidKey, "complete"))
            .catch((err: unknown) =>
              updateAutoIngestedPaperStatus(pmidKey, "failed", { errorMessage: String(err) })
            );
        });

        stats.submitted++;
        console.log(
          `[DiscoveryLoop] Submitted: "${candidate.title.slice(0, 60)}" (${candidate.ingestSource})`
        );
      } catch (err) {
        stats.failed++;
        console.error(`[DiscoveryLoop] Failed candidate ${candidate.pmid}:`, err);
      }
    }

    // Notify owner with summary if anything was submitted
    if (stats.submitted > 0) {
      try {
        await notifyOwner({
          title: `Discovery Loop: ${stats.submitted} new papers submitted`,
          content: [
            `Discovered: ${stats.discovered} candidates`,
            `Already ingested: ${stats.alreadyIngested}`,
            `Low signal (skipped): ${stats.lowSignal}`,
            `Submitted to pipeline: ${stats.submitted}`,
            `Failed: ${stats.failed}`,
            `Duration: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
          ].join("\n"),
        });
      } catch {
        // notification failure is non-fatal
      }
    }

    res.json({
      ok: true,
      stats,
      sourceBreakdown: discovery.sourceBreakdown,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[DiscoveryLoop] Fatal error:", err);
    res.status(500).json({ ok: false, error: String(err), stats });
  }
}
