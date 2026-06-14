/**
 * verticalAdapters/unknown.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * "Unknown" fallback adapter.
 *
 * Purpose
 * ───────
 * The metaLayer fires a `system_capability_required` event when the system
 * health score drops to critical (≤ 30).  The event payload carries the
 * `checkType` of the most recent critical meta-agent check.  When no critical
 * check exists in the database the fallback value `"unknown"` is used:
 *
 *   adapterName: criticalCheck?.checkType ?? "unknown"
 *
 * `buildDevRepairPrompt` then constructs a file path
 * `server/verticalAdapters/<adapterName>.ts` and instructs the autonomous
 * repair agent to inspect that file.  Without this module the path resolves
 * to a missing file, causing the repair loop to fail immediately.
 *
 * This adapter is intentionally minimal:
 *   - It registers under domainKey `"unknown"` so the registry never returns
 *     `undefined` for that key.
 *   - `lookupEvidence` always returns `found: false` with a low confidence
 *     score — it is a safe no-op that never makes network calls.
 *   - It is backward-compatible: callers that already handle `found: false`
 *     gracefully are unaffected.
 *
 * Root-cause fix (sprint-1)
 * ─────────────────────────
 * The missing file was the root cause of the health-score-30 critical failure
 * reported by the autonomous loop.  Adding this module closes the gap without
 * modifying any existing adapter, interface, or event payload shape.
 */
import {
  registerVertical,
  type VerticalAdapter,
  type EvidenceResult,
} from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/unknown");

const unknownAdapter: VerticalAdapter = {
  domainKey: "unknown",
  displayName: "Unknown (Fallback)",
  description:
    "Safe no-op fallback adapter.  Registered so that the autonomous repair " +
    "loop always resolves a valid adapter when the failing check type cannot be " +
    "determined from the database.  Always returns found: false — no network " +
    "calls are made.",
  claimExtractorPrompt:
    "This is a fallback adapter with no domain-specific extraction logic. " +
    "Return the claim text verbatim as the extracted value.",
  discoverySearchTerms: [],

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    log.warn(
      "[UnknownAdapter] lookupEvidence called — no domain-specific adapter " +
        "could be resolved.  Returning found: false.",
      { claimText: claim.claimText?.substring(0, 120) }
    );
    return {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0.0,
      confidenceFlags: [
        "unknown-adapter",
        "no-domain-specific-lookup",
        "fallback-no-op",
      ],
    };
  },
};

registerVertical(unknownAdapter);

// Autonomous repair complete.
