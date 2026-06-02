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
import "./structuralBiology";
import "./salmonBiotech";
