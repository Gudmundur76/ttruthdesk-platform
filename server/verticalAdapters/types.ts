/**
 * verticalAdapters/types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared types and registry for vertical domain adapters.
 * Kept separate from index.ts to avoid circular imports.
 */

export interface EvidenceResult {
  found: boolean;
  sourceId: string | null;
  sourceUrl: string | null;
  evidenceRaw: Record<string, unknown> | null;
  confidenceScore: number;       // 0.0–1.0
  confidenceFlags: string[];
}

export interface VerticalAdapter {
  domainKey: string;
  displayName: string;
  description: string;
  claimExtractorPrompt: string;
  lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult>;
  discoverySearchTerms: string[];
}

// ─── Registry (singleton map) ─────────────────────────────────────────────────
export const registry = new Map<string, VerticalAdapter>();

export function registerVertical(adapter: VerticalAdapter): void {
  registry.set(adapter.domainKey, adapter);
}

export function getVertical(domainKey: string): VerticalAdapter | undefined {
  return registry.get(domainKey);
}

export function listVerticals(): VerticalAdapter[] {
  return Array.from(registry.values());
}
