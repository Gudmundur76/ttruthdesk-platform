/**
 * agentFeedback.test.ts — Phase 120
 *
 * Ralph Wiggum RED → GREEN tests for:
 *   - validateSubmitClaim()  — input guards for new claim submission
 *   - validateFlagStale()    — input guards for stale-claim flagging
 *   - validateReportContradiction() — input guards for contradiction reports
 *   - buildFeedbackAck()     — acknowledgement response shaper
 *   - FEEDBACK_TOOLS_MANIFEST — MCP tool descriptors (3 tools)
 */

import { describe, it, expect } from "vitest";
import {
  validateSubmitClaim,
  validateFlagStale,
  validateReportContradiction,
  buildFeedbackAck,
  FEEDBACK_TOOLS_MANIFEST,
  type SubmitClaimInput,
  type FlagStaleInput,
  type ReportContradictionInput,
} from "./agentFeedback";

// ─── validateSubmitClaim ──────────────────────────────────────────────────────
describe("validateSubmitClaim", () => {
  const valid: SubmitClaimInput = {
    claimText: "Aspirin reduces fever in adults",
    domain: "medicine",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678",
    agentId: "claude-opus-4",
  };

  it("accepts a valid submit_claim input", () => {
    const r = validateSubmitClaim(valid);
    expect(r.valid).toBe(true);
  });

  it("rejects missing claimText", () => {
    const r = validateSubmitClaim({ ...valid, claimText: "" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/claimText/i);
  });

  it("rejects claimText longer than 1000 chars", () => {
    const r = validateSubmitClaim({ ...valid, claimText: "x".repeat(1001) });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/1000/);
  });

  it("accepts missing optional fields (domain, sourceUrl, agentId)", () => {
    const r = validateSubmitClaim({ claimText: "Aspirin reduces fever" });
    expect(r.valid).toBe(true);
  });

  it("rejects an invalid sourceUrl (not http/https)", () => {
    const r = validateSubmitClaim({ ...valid, sourceUrl: "ftp://example.com" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/sourceUrl/i);
  });

  it("rejects agentId longer than 128 chars", () => {
    const r = validateSubmitClaim({ ...valid, agentId: "a".repeat(129) });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/agentId/i);
  });
});

// ─── validateFlagStale ────────────────────────────────────────────────────────
describe("validateFlagStale", () => {
  const valid: FlagStaleInput = {
    claimHash: "abc123def456abcd",
    reason: "Superseded by 2024 meta-analysis",
    agentId: "claude-opus-4",
    newSourceUrl: "https://pubmed.ncbi.nlm.nih.gov/99999999",
  };

  it("accepts a valid flag_stale input", () => {
    const r = validateFlagStale(valid);
    expect(r.valid).toBe(true);
  });

  it("rejects missing claimHash", () => {
    const r = validateFlagStale({ ...valid, claimHash: "" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/claimHash/i);
  });

  it("rejects claimHash that is not 16 hex chars", () => {
    const r = validateFlagStale({ ...valid, claimHash: "tooshort" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/16.*hex/i);
  });

  it("rejects missing reason", () => {
    const r = validateFlagStale({ ...valid, reason: "" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/reason/i);
  });

  it("rejects reason longer than 500 chars", () => {
    const r = validateFlagStale({ ...valid, reason: "x".repeat(501) });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/500/);
  });

  it("accepts missing optional fields (agentId, newSourceUrl)", () => {
    const r = validateFlagStale({ claimHash: "abc123def456abcd", reason: "Outdated" });
    expect(r.valid).toBe(true);
  });

  it("rejects an invalid newSourceUrl", () => {
    const r = validateFlagStale({ ...valid, newSourceUrl: "not-a-url" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/newSourceUrl/i);
  });
});

// ─── validateReportContradiction ─────────────────────────────────────────────
describe("validateReportContradiction", () => {
  const valid: ReportContradictionInput = {
    claimHashA: "abc123def456abcd",
    claimHashB: "deadbeef12345678",
    explanation: "Claim A says X causes Y; Claim B says X does not cause Y",
    agentId: "claude-opus-4",
  };

  it("accepts a valid report_contradiction input", () => {
    const r = validateReportContradiction(valid);
    expect(r.valid).toBe(true);
  });

  it("rejects missing claimHashA", () => {
    const r = validateReportContradiction({ ...valid, claimHashA: "" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/claimHashA/i);
  });

  it("rejects missing claimHashB", () => {
    const r = validateReportContradiction({ ...valid, claimHashB: "" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/claimHashB/i);
  });

  it("rejects identical claimHashA and claimHashB", () => {
    const r = validateReportContradiction({ ...valid, claimHashB: valid.claimHashA });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/same/i);
  });

  it("rejects missing explanation", () => {
    const r = validateReportContradiction({ ...valid, explanation: "" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/explanation/i);
  });

  it("rejects explanation longer than 2000 chars", () => {
    const r = validateReportContradiction({ ...valid, explanation: "x".repeat(2001) });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/2000/);
  });

  it("accepts missing optional agentId", () => {
    const r = validateReportContradiction({ ...valid, agentId: undefined });
    expect(r.valid).toBe(true);
  });
});

// ─── buildFeedbackAck ─────────────────────────────────────────────────────────
describe("buildFeedbackAck", () => {
  it("returns a valid ack with feedbackId, action, and receivedAt", () => {
    const ack = buildFeedbackAck("submit_claim", "claim-abc123");
    expect(ack.feedbackId).toMatch(/^fb_[0-9a-f]{12}$/);
    expect(ack.action).toBe("submit_claim");
    expect(ack.referenceId).toBe("claim-abc123");
    expect(typeof ack.receivedAt).toBe("string");
    expect(ack.status).toBe("queued");
  });

  it("generates a unique feedbackId each call", () => {
    const a = buildFeedbackAck("flag_stale", "hash-a");
    const b = buildFeedbackAck("flag_stale", "hash-b");
    expect(a.feedbackId).not.toBe(b.feedbackId);
  });

  it("accepts all three action types", () => {
    const actions = ["submit_claim", "flag_stale", "report_contradiction"] as const;
    actions.forEach(action => {
      const ack = buildFeedbackAck(action, "ref-123");
      expect(ack.action).toBe(action);
    });
  });
});

// ─── FEEDBACK_TOOLS_MANIFEST ──────────────────────────────────────────────────
describe("FEEDBACK_TOOLS_MANIFEST", () => {
  it("exports exactly 3 tool descriptors", () => {
    expect(FEEDBACK_TOOLS_MANIFEST).toHaveLength(3);
  });

  it("tool names are submit_claim, flag_stale, report_contradiction", () => {
    const names = FEEDBACK_TOOLS_MANIFEST.map(t => t.name);
    expect(names).toContain("submit_claim");
    expect(names).toContain("flag_stale");
    expect(names).toContain("report_contradiction");
  });

  it("each tool has a non-empty description and inputSchema", () => {
    FEEDBACK_TOOLS_MANIFEST.forEach(t => {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema).toBeDefined();
      expect((t.inputSchema as Record<string, unknown>)["type"]).toBe("object");
    });
  });

  it("submit_claim requires claimText", () => {
    const tool = FEEDBACK_TOOLS_MANIFEST.find(t => t.name === "submit_claim")!;
    const required = (tool.inputSchema as Record<string, unknown>)["required"] as string[];
    expect(required).toContain("claimText");
  });

  it("flag_stale requires claimHash and reason", () => {
    const tool = FEEDBACK_TOOLS_MANIFEST.find(t => t.name === "flag_stale")!;
    const required = (tool.inputSchema as Record<string, unknown>)["required"] as string[];
    expect(required).toContain("claimHash");
    expect(required).toContain("reason");
  });

  it("report_contradiction requires claimHashA, claimHashB, and explanation", () => {
    const tool = FEEDBACK_TOOLS_MANIFEST.find(t => t.name === "report_contradiction")!;
    const required = (tool.inputSchema as Record<string, unknown>)["required"] as string[];
    expect(required).toContain("claimHashA");
    expect(required).toContain("claimHashB");
    expect(required).toContain("explanation");
  });
});
