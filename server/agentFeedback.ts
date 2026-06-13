/**
 * agentFeedback.ts — Phase 120
 *
 * Bidirectional agent feedback loop.
 *
 * Provides three MCP tools that allow agents to contribute back to the
 * citation.is knowledge graph:
 *
 *   submit_claim         — Agent submits a new claim for ingestion
 *   flag_stale           — Agent flags an existing claim as outdated
 *   report_contradiction — Agent reports two claims that contradict each other
 *
 * All feedback is acknowledged immediately with a feedbackId and queued for
 * async processing. No synchronous DB write is required in the hot path.
 *
 * Design principles:
 *   - Validation is pure and synchronous (no I/O)
 *   - buildFeedbackAck() generates a unique feedbackId using crypto.randomBytes
 *   - The actual DB write / queue dispatch is handled by the MCP tool handler
 *     in mcpServer.ts (not in this module) to keep concerns separated
 */

import { randomBytes } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubmitClaimInput {
  claimText: string;
  domain?: string;
  sourceUrl?: string;
  agentId?: string;
}

export interface FlagStaleInput {
  claimHash: string;
  reason: string;
  agentId?: string;
  newSourceUrl?: string;
}

export interface ReportContradictionInput {
  claimHashA: string;
  claimHashB: string;
  explanation: string;
  agentId?: string;
}

export type FeedbackAction = "submit_claim" | "flag_stale" | "report_contradiction";

export interface FeedbackAck {
  feedbackId: string;
  action: FeedbackAction;
  referenceId: string;
  receivedAt: string;
  status: "queued";
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HEX16_RE = /^[0-9a-f]{16}$/;
const URL_RE = /^https?:\/\/.+/i;

function isValidHex16(s: string): boolean {
  return HEX16_RE.test(s);
}

function isValidHttpUrl(s: string): boolean {
  return URL_RE.test(s);
}

// ─── validateSubmitClaim ──────────────────────────────────────────────────────

export function validateSubmitClaim(input: Partial<SubmitClaimInput>): ValidationResult {
  const { claimText, sourceUrl, agentId } = input;

  if (!claimText || claimText.trim().length === 0) {
    return { valid: false, error: "claimText must be a non-empty string" };
  }
  if (claimText.length > 1000) {
    return { valid: false, error: "claimText must be at most 1000 characters" };
  }
  if (sourceUrl !== undefined && !isValidHttpUrl(sourceUrl)) {
    return { valid: false, error: "sourceUrl must be a valid http/https URL" };
  }
  if (agentId !== undefined && agentId.length > 128) {
    return { valid: false, error: "agentId must be at most 128 characters" };
  }

  return { valid: true };
}

// ─── validateFlagStale ────────────────────────────────────────────────────────

export function validateFlagStale(input: Partial<FlagStaleInput>): ValidationResult {
  const { claimHash, reason, newSourceUrl, agentId } = input;

  if (!claimHash || claimHash.trim().length === 0) {
    return { valid: false, error: "claimHash must be a non-empty string" };
  }
  if (!isValidHex16(claimHash)) {
    return { valid: false, error: "claimHash must be exactly 16 hex characters" };
  }
  if (!reason || reason.trim().length === 0) {
    return { valid: false, error: "reason must be a non-empty string" };
  }
  if (reason.length > 500) {
    return { valid: false, error: "reason must be at most 500 characters" };
  }
  if (newSourceUrl !== undefined && !isValidHttpUrl(newSourceUrl)) {
    return { valid: false, error: "newSourceUrl must be a valid http/https URL" };
  }
  if (agentId !== undefined && agentId.length > 128) {
    return { valid: false, error: "agentId must be at most 128 characters" };
  }

  return { valid: true };
}

// ─── validateReportContradiction ─────────────────────────────────────────────

export function validateReportContradiction(
  input: Partial<ReportContradictionInput>
): ValidationResult {
  const { claimHashA, claimHashB, explanation, agentId } = input;

  if (!claimHashA || claimHashA.trim().length === 0) {
    return { valid: false, error: "claimHashA must be a non-empty string" };
  }
  if (!isValidHex16(claimHashA)) {
    return { valid: false, error: "claimHashA must be exactly 16 hex characters" };
  }
  if (!claimHashB || claimHashB.trim().length === 0) {
    return { valid: false, error: "claimHashB must be a non-empty string" };
  }
  if (!isValidHex16(claimHashB)) {
    return { valid: false, error: "claimHashB must be exactly 16 hex characters" };
  }
  if (claimHashA === claimHashB) {
    return { valid: false, error: "claimHashA and claimHashB must not be the same hash" };
  }
  if (!explanation || explanation.trim().length === 0) {
    return { valid: false, error: "explanation must be a non-empty string" };
  }
  if (explanation.length > 2000) {
    return { valid: false, error: "explanation must be at most 2000 characters" };
  }
  if (agentId !== undefined && agentId.length > 128) {
    return { valid: false, error: "agentId must be at most 128 characters" };
  }

  return { valid: true };
}

// ─── buildFeedbackAck ─────────────────────────────────────────────────────────

/**
 * Generates a unique acknowledgement for a feedback submission.
 * feedbackId format: "fb_" + 12 random hex chars
 */
export function buildFeedbackAck(action: FeedbackAction, referenceId: string): FeedbackAck {
  return {
    feedbackId: `fb_${randomBytes(6).toString("hex")}`,
    action,
    referenceId,
    receivedAt: new Date().toISOString(),
    status: "queued",
  };
}

// ─── MCP Tool Manifest ────────────────────────────────────────────────────────

export const FEEDBACK_TOOLS_MANIFEST = [
  {
    name: "submit_claim",
    description:
      "Submit a new claim for ingestion into the citation.is knowledge graph. " +
      "The claim will be queued for evidence lookup, verdict assignment, and provenance chain construction. " +
      "Returns a feedbackId for tracking. Use this when you encounter a factual claim that is not yet in the registry.",
    inputSchema: {
      type: "object",
      properties: {
        claimText: {
          type: "string",
          maxLength: 1000,
          description: "The factual claim to submit (max 1000 chars).",
        },
        domain: {
          type: "string",
          description: "Optional domain hint (e.g. 'medicine', 'biology', 'physics').",
        },
        sourceUrl: {
          type: "string",
          description: "Optional http/https URL of the primary source for this claim.",
        },
        agentId: {
          type: "string",
          maxLength: 128,
          description: "Optional identifier of the submitting agent for attribution.",
        },
      },
      required: ["claimText"],
      additionalProperties: false,
    },
  },
  {
    name: "flag_stale",
    description:
      "Flag an existing claim as potentially outdated or superseded by newer evidence. " +
      "Use the claimHash from a previous verify_claim response. The claim will be queued for re-verification. " +
      "Returns a feedbackId for tracking.",
    inputSchema: {
      type: "object",
      properties: {
        claimHash: {
          type: "string",
          pattern: "^[0-9a-f]{16}$",
          description: "The 16-char hex hash of the claim to flag (from verify_claim response).",
        },
        reason: {
          type: "string",
          maxLength: 500,
          description: "Explanation of why the claim may be stale (max 500 chars).",
        },
        newSourceUrl: {
          type: "string",
          description: "Optional http/https URL of a newer source that supersedes the claim.",
        },
        agentId: {
          type: "string",
          maxLength: 128,
          description: "Optional identifier of the flagging agent.",
        },
      },
      required: ["claimHash", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "report_contradiction",
    description:
      "Report that two claims in the registry contradict each other. " +
      "Both claims must be identified by their 16-char hex hashes. " +
      "The contradiction will be queued for review and may trigger re-verification of both claims. " +
      "Returns a feedbackId for tracking.",
    inputSchema: {
      type: "object",
      properties: {
        claimHashA: {
          type: "string",
          pattern: "^[0-9a-f]{16}$",
          description: "Hash of the first claim in the contradiction pair.",
        },
        claimHashB: {
          type: "string",
          pattern: "^[0-9a-f]{16}$",
          description: "Hash of the second claim in the contradiction pair. Must differ from claimHashA.",
        },
        explanation: {
          type: "string",
          maxLength: 2000,
          description: "Explanation of how the two claims contradict each other (max 2000 chars).",
        },
        agentId: {
          type: "string",
          maxLength: 128,
          description: "Optional identifier of the reporting agent.",
        },
      },
      required: ["claimHashA", "claimHashB", "explanation"],
      additionalProperties: false,
    },
  },
] as const;
