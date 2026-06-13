/**
 * verticalAdapters/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Public entry point for the vertical adapter system.
 * Re-exports types and registry from types.ts, then imports adapter
 * implementations so they self-register on module load.
 */

export {
  registerVertical,
  getVertical,
  listVerticals,
  registry,
  type EvidenceResult,
  type VerticalAdapter,
} from "./types";

// Import adapters after registry is initialised — they call registerVertical()
// on module load. Order matters: structural_biology first (reference impl).

// ── Domain-specific vertical adapters (biomedical) ───────────────────────────
import "./structuralBiology";
import "./salmonBiotech";
import "./proteinSupplement";
import "./creatineErgogenics";
import "./gutMicrobiome";
import "./collagenPeptides";
import "./plantBasedProtein";
import "./sportsNutritionRct";
import "./uniprotVertical";
import "./clinicalTrialsVertical";

// ── Domain-agnostic adapters (approved 2026-06-13) ───────────────────────────
// These make the engine verifiable across ALL academic disciplines.
import "./crossRef";          // 130M+ DOIs — universal citation registry
import "./openAlex";          // 250M+ works — comprehensive scholarly index
import "./semanticScholar";   // 200M+ papers — semantic search + citation graph
import "./genericSource";     // URL/DOI fallback — must be last (lowest priority)
