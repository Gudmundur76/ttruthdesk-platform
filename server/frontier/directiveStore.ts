/**
 * DirectiveStore — in-memory store for L2 → L3 directives.
 *
 * Directives are published by the Self-Prompt layer (L2) via the event bus
 * and consumed by the Frontier Engine (L3) at the start of each cycle.
 * Each directive is single-use: it is cleared after the cycle that applies it.
 *
 * FR-L3-23 through FR-L3-28
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** The four directive types supported by the Frontier Engine (FR-L3-24) */
export type DirectiveType =
  | "focus_gap"
  | "skip_mapping"
  | "prioritize_hypotheses"
  | "deep_dive_entity";

export interface FrontierDirective {
  /** Unique identifier for this directive */
  directiveId: string;
  /** Type of directive */
  type: DirectiveType;
  /**
   * PRD_BACKEND_V2 alias for `type` — always equals `type`.
   * Kept for interface compatibility with the PRD-specified TypeScript contract.
   */
  directiveType: DirectiveType;
  /** Gap ID to focus on (for focus_gap directives) */
  targetGapId?: string;
  /** Entity ID to deep-dive on (for deep_dive_entity directives) */
  targetEntityId?: string;
  /** TTL in seconds (default 1800 = 30 min per FR-L3-25). Directive expires at createdAt + ttlSeconds */
  ttlSeconds: number;
  /** When this directive was created */
  createdAt: Date;
}

/**
 * The resolved effect of applying all active directives for a cycle.
 * Multiple directives compose additively (FR-L3-26).
 */
export interface DirectiveEffect {
  /** Whether Stage 1 (gap mapping) should be skipped */
  skippedMapping: boolean;
  /** Gap IDs that must be included in the top-N pursuit selection */
  focusGapIds: string[];
  /** Entity ID for deep-dive mode, or null if not in deep-dive */
  deepDiveEntityId: string | null;
  /** Additional hypotheses to generate beyond MAX_HYPOTHESES_PER_CYCLE */
  extraHypotheses: number;
  /** Total number of directives applied this cycle */
  directivesApplied: number;
}

// ─── DirectiveStore ───────────────────────────────────────────────────────────

export class DirectiveStore {
  private directives: FrontierDirective[] = [];

  /**
   * Add a new directive to the store.
   * Duplicate directiveIds are ignored.
   */
  add(directive: FrontierDirective): void {
    const exists = this.directives.some(
      d => d.directiveId === directive.directiveId
    );
    if (!exists) {
      this.directives.push(directive);
    }
  }

  /**
   * Return all directives that have not yet expired.
   * Directives with createdAt + ttlSeconds < now() are excluded (FR-L3-25).
   */
  getActive(): FrontierDirective[] {
    const now = Date.now();
    return this.directives.filter(d => {
      const expiresAt = d.createdAt.getTime() + d.ttlSeconds * 1000;
      return expiresAt > now;
    });
  }

  /**
   * Remove all directives from the store.
   * Called after a cycle completes to enforce single-use semantics (FR-L3-28).
   */
  clearConsumed(): void {
    this.directives = [];
  }

  /**
   * Compute the combined effect of all currently active directives.
   * Directives compose additively (FR-L3-26).
   */
  applyDirectives(): DirectiveEffect {
    const active = this.getActive();

    const effect: DirectiveEffect = {
      skippedMapping: false,
      focusGapIds: [],
      deepDiveEntityId: null,
      extraHypotheses: 0,
      directivesApplied: active.length,
    };

    for (const directive of active) {
      switch (directive.type) {
        case "skip_mapping":
          effect.skippedMapping = true;
          break;
        case "focus_gap":
          if (directive.targetGapId) {
            effect.focusGapIds.push(directive.targetGapId);
          }
          break;
        case "prioritize_hypotheses":
          effect.extraHypotheses += 2;
          break;
        case "deep_dive_entity":
          if (directive.targetEntityId) {
            // Last deep_dive_entity directive wins if multiple are present
            effect.deepDiveEntityId = directive.targetEntityId;
          }
          break;
      }
    }

    return effect;
  }

  /** Returns the total number of directives currently in the store (including expired) */
  size(): number {
    return this.directives.length;
  }

  /** Returns the number of active (non-expired) directives */
  activeCount(): number {
    return this.getActive().length;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Module-level singleton — shared across the frontier engine and event handler */
export const directiveStore = new DirectiveStore();
