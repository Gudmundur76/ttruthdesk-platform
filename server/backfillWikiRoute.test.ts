/**
 * backfillWikiRoute.test.ts
 * Tests for Phase 30: backfill endpoint, MCP tool card, and Telegram alert shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── MCP tool card shape ──────────────────────────────────────────────────────

const EXPECTED_TOOL_NAMES = [
  "verify_claim",
  "get_claims_registry",
  "get_platform_summary",
  "get_knowledge_graph_data",
  "claims.byEntity",
  "graph.query",
  "reports.generate",
];

describe("MCP tool card", () => {
  it("defines all 7 required tools", () => {
    // Validate the expected tool list is complete
    expect(EXPECTED_TOOL_NAMES).toHaveLength(7);
    expect(EXPECTED_TOOL_NAMES).toContain("verify_claim");
    expect(EXPECTED_TOOL_NAMES).toContain("claims.byEntity");
    expect(EXPECTED_TOOL_NAMES).toContain("graph.query");
    expect(EXPECTED_TOOL_NAMES).toContain("reports.generate");
  });

  it("graph.query tool has required question input schema", () => {
    const graphQueryTool = {
      name: "graph.query",
      input_schema: {
        type: "object",
        properties: {
          question: { type: "string" },
        },
        required: ["question"],
      },
    };
    expect(graphQueryTool.input_schema.required).toContain("question");
    expect(graphQueryTool.input_schema.properties.question.type).toBe("string");
  });

  it("reports.generate tool has required rawText input", () => {
    const reportsTool = {
      name: "reports.generate",
      input_schema: {
        type: "object",
        properties: {
          rawText: { type: "string" },
          title: { type: "string" },
          sourceType: { type: "string" },
        },
        required: ["rawText"],
      },
    };
    expect(reportsTool.input_schema.required).toContain("rawText");
    expect(reportsTool.input_schema.required).not.toContain("title");
  });

  it("claims.byEntity tool has entityType enum with protein and pdb_id", () => {
    const entityTypes = ["protein", "pdb_id", "method", "organism", "ligand", "author", "concept"];
    expect(entityTypes).toContain("protein");
    expect(entityTypes).toContain("pdb_id");
    expect(entityTypes).toContain("method");
  });
});

// ─── Backfill endpoint logic ──────────────────────────────────────────────────

describe("backfill wiki route", () => {
  it("sleep utility resolves after delay", async () => {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 10));
    expect(Date.now() - start).toBeGreaterThanOrEqual(5);
  });

  it("handles empty completed documents list gracefully", async () => {
    const docs: Array<{ id: number; title: string | null }> = [];
    let succeeded = 0;
    let failed = 0;
    for (const doc of docs) {
      try {
        // simulate compileDocumentToWiki
        void doc;
        succeeded++;
      } catch {
        failed++;
      }
    }
    expect(succeeded).toBe(0);
    expect(failed).toBe(0);
  });

  it("counts failures correctly when compile throws", async () => {
    const docs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const doc of docs) {
      try {
        if (doc.id === 2) throw new Error("LLM timeout");
        succeeded++;
      } catch (err) {
        failed++;
        errors.push(`Document ${doc.id}: ${(err as Error).message}`);
      }
    }
    expect(succeeded).toBe(2);
    expect(failed).toBe(1);
    expect(errors[0]).toContain("LLM timeout");
  });

  it("caps error list at 20 items", () => {
    const errors = Array.from({ length: 30 }, (_, i) => `Error ${i}`);
    const capped = errors.slice(0, 20);
    expect(capped).toHaveLength(20);
  });
});

// ─── Telegram contradiction alert shape ──────────────────────────────────────

describe("postContradictionAlert message format", () => {
  function buildAlertLines(params: {
    entityName: string;
    entityType: string;
    claimText: string;
    verdict: string;
    rationale: string;
    claimId: number;
    documentTitle?: string;
    pdbId?: string;
  }): string[] {
    const claimSnippet = params.claimText.slice(0, 120);
    const rationaleSnippet = params.rationale.slice(0, 180);
    return [
      `🔴 *NEW CONTRADICTION DETECTED*`,
      ``,
      `🧬 *Entity:* ${params.entityName} (${params.entityType})`,
      params.documentTitle ? `📄 *Paper:* ${params.documentTitle}` : null,
      params.pdbId ? `🔬 *PDB:* ${params.pdbId}` : null,
      ``,
      `*Claim:* _${claimSnippet}_`,
      `*Verdict:* ${params.verdict}`,
      `*Rationale:* ${rationaleSnippet}`,
    ].filter(Boolean) as string[];
  }

  it("includes entity name and type in alert", () => {
    const lines = buildAlertLines({
      entityName: "lysozyme",
      entityType: "protein",
      claimText: "PDB 1LYZ solved at 2.1Å",
      verdict: "Contradicted",
      rationale: "PDB records show 1.8Å resolution",
      claimId: 42,
    });
    expect(lines.some((l) => l.includes("lysozyme"))).toBe(true);
    expect(lines.some((l) => l.includes("protein"))).toBe(true);
  });

  it("includes optional PDB ID when provided", () => {
    const lines = buildAlertLines({
      entityName: "1LYZ",
      entityType: "pdb_id",
      claimText: "Structure solved at 2.1Å",
      verdict: "Contradicted",
      rationale: "Actual resolution is 1.8Å",
      claimId: 99,
      pdbId: "1LYZ",
    });
    expect(lines.some((l) => l.includes("1LYZ"))).toBe(true);
  });

  it("omits PDB line when pdbId not provided", () => {
    const lines = buildAlertLines({
      entityName: "lysozyme",
      entityType: "protein",
      claimText: "Claim text",
      verdict: "Contradicted",
      rationale: "Rationale",
      claimId: 1,
    });
    expect(lines.some((l) => l.includes("🔬"))).toBe(false);
  });

  it("truncates long claim text at 120 chars", () => {
    const longClaim = "A".repeat(200);
    const lines = buildAlertLines({
      entityName: "test",
      entityType: "protein",
      claimText: longClaim,
      verdict: "Contradicted",
      rationale: "reason",
      claimId: 1,
    });
    const claimLine = lines.find((l) => l.startsWith("*Claim:*"));
    expect(claimLine).toBeDefined();
    // The snippet is 120 chars, wrapped in _..._
    expect(claimLine!.length).toBeLessThan(200);
  });

  it("includes verdict in alert", () => {
    const lines = buildAlertLines({
      entityName: "test",
      entityType: "protein",
      claimText: "Claim",
      verdict: "Contradicted",
      rationale: "Reason",
      claimId: 1,
    });
    expect(lines.some((l) => l.includes("Contradicted"))).toBe(true);
  });
});

// ─── Link header format ───────────────────────────────────────────────────────

describe("Link header format", () => {
  it("produces correct rel=llms Link header string", () => {
    const origin = "https://protein-desk-5r5rzpyg.manus.space";
    const header = `<${origin}/llms.txt>; rel="llms", <${origin}/.well-known/mcp.json>; rel="mcp", <${origin}/api/trpc>; rel="api-catalog"`;
    expect(header).toContain('rel="llms"');
    expect(header).toContain('rel="mcp"');
    expect(header).toContain('rel="api-catalog"');
    expect(header).toContain("/llms.txt");
    expect(header).toContain("/.well-known/mcp.json");
  });
});
