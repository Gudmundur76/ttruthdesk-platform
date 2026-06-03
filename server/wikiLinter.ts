/**
 * wikiLinter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Karpathy-style lint cycle for the Truth Desk knowledge graph.
 *
 * Runs periodically (via POST /api/scheduled/wiki-lint heartbeat) to:
 *   1. Find PDB ID entities that have multiple resolution/method claims across
 *      different documents.
 *   2. Fetch the wiki page for each conflicting entity from S3.
 *   3. Ask the LLM to check for contradictions between claims on the page.
 *   4. Write "contradicts" edges to the graph_relations table.
 *   5. Return a summary of contradictions found.
 *
 * This is the cross-document contradiction engine described in the architecture
 * document. A paper uploaded today can be flagged as contradicting a paper
 * uploaded six months ago — automatically, without human review.
 */

import { invokeLLM } from "./_core/llm";
import {
  getGraphEntitiesByType,
  getContradictionRelations,
  upsertGraphRelation,
  getGraphEntityByTypeAndName,
  getAllGraphEntities,
} from "./db";
import { getClaimsByDocument } from "./db";
import { fetchWikiPage } from "./wikiCompiler";
import type { GraphEntity } from "../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LintContradiction {
  claimA: string;
  claimB: string;
  explanation: string;
  confidenceScore: number;
}

interface LintResult {
  entityId: number;
  entityName: string;
  contradictions: LintContradiction[];
}

export interface WikiLintReport {
  processedEntities: number;
  contradictionsFound: number;
  newEdgesCreated: number;
  results: LintResult[];
  processedAt: string;
}

// ─── LLM lint pass ────────────────────────────────────────────────────────────

async function lintWikiPage(
  entityName: string,
  wikiContent: string
): Promise<LintContradiction[]> {
  if (!wikiContent || wikiContent.trim().length < 50) return [];

  const systemPrompt = `You are a scientific fact-checking linter for Truth Desk, a molecular biology claims verification platform.

Review the wiki page for "${entityName}" and identify any contradictions between claims from different documents.

A contradiction is when two claims about the same property (e.g., resolution, method, organism) are mutually inconsistent.

Return a JSON object with this exact schema:
{
  "contradictions": [
    {
      "claimA": "exact quote of first claim",
      "claimB": "exact quote of second claim",
      "explanation": "brief explanation of why these contradict",
      "confidenceScore": 0.0-1.0
    }
  ]
}

If no contradictions are found, return { "contradictions": [] }.
Only flag genuine contradictions, not minor differences in wording.`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Wiki page for "${entityName}":\n\n${wikiContent.slice(0, 4000)}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "lint_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              contradictions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    claimA: { type: "string" },
                    claimB: { type: "string" },
                    explanation: { type: "string" },
                    confidenceScore: { type: "number" },
                  },
                  required: ["claimA", "claimB", "explanation", "confidenceScore"],
                  additionalProperties: false,
                },
              },
            },
            required: ["contradictions"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return [];
    const parsed = JSON.parse(content) as { contradictions: LintContradiction[] };
    return parsed.contradictions ?? [];
  } catch (err) {
    console.error(`[WikiLinter] LLM lint error for "${entityName}":`, err);
    return [];
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runWikiLint(): Promise<WikiLintReport> {
  const processedAt = new Date().toISOString();
  const results: LintResult[] = [];
  let newEdgesCreated = 0;

  // Focus on PDB ID entities first — these have the most structured claims
  const pdbEntities = await getGraphEntitiesByType("pdb_id", 100);
  const proteinEntities = await getGraphEntitiesByType("protein", 100);
  const entitiesToLint = [...pdbEntities, ...proteinEntities];

  console.log(
    `[WikiLinter] Linting ${entitiesToLint.length} entities for contradictions`
  );

  for (const entity of entitiesToLint) {
    if (!entity.wikiPagePath) continue;

    const wikiContent = await fetchWikiPage(entity.wikiPagePath);
    if (!wikiContent) continue;

    const contradictions = await lintWikiPage(entity.canonicalName, wikiContent);
    if (contradictions.length === 0) continue;

    results.push({
      entityId: entity.id,
      entityName: entity.canonicalName,
      contradictions,
    });

    // Write self-contradiction edges (entity → entity with relationType "contradicts")
    for (const c of contradictions) {
      try {
        await upsertGraphRelation({
          sourceEntityId: entity.id,
          targetEntityId: entity.id,
          relationType: "contradicts",
          evidenceDocumentId: entity.firstSeenDocumentId ?? undefined,
          confidenceScore: c.confidenceScore,
        });
        newEdgesCreated++;
      } catch (err) {
        // Duplicate edge — already exists, ignore
        console.debug(`[WikiLinter] Edge already exists for entity #${entity.id}`);
      }
    }
  }

  const report: WikiLintReport = {
    processedEntities: entitiesToLint.length,
    contradictionsFound: results.reduce((n, r) => n + r.contradictions.length, 0),
    newEdgesCreated,
    results,
    processedAt,
  };

  console.log(
    `[WikiLinter] Lint complete: ${report.processedEntities} entities, ` +
      `${report.contradictionsFound} contradictions, ${report.newEdgesCreated} new edges`
  );

  return report;
}
