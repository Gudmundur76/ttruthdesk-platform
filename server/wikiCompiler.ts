/**
 * wikiCompiler.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Karpathy-style wiki compilation step.
 *
 * After runAnalysisPipeline completes, this module:
 *   1. Extracts unique entities from the document's claims (PDB IDs, protein
 *      names, methods, organisms, ligands).
 *   2. For each entity, reads the existing wiki page from S3 (or starts fresh).
 *   3. Calls the LLM to merge the new claims into the wiki page (append-only,
 *      never deletes old claims, flags contradictions).
 *   4. Writes the updated wiki page back to S3.
 *   5. Upserts graph entity rows and creates typed relation edges.
 *
 * The wiki pages are stored in S3 under `wiki/{entityType}_{slug}.md`.
 * They are served to the frontend via the tRPC `wiki.getPage` procedure.
 */

import { storagePut, storageGetSignedUrl } from "./storage";
import { invokeLLM } from "./_core/llm";
import {
  getClaimsByDocument,
  getDocumentById,
  upsertGraphEntity,
  upsertGraphRelation,
  getGraphEntityByTypeAndName,
} from "./db";
import type { GraphEntity } from "../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedEntity {
  entityType: GraphEntity["entityType"];
  canonicalName: string;
  relationType: "cites" | "uses_method" | "expressed_in" | "binds";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

function wikiKey(entityType: string, canonicalName: string): string {
  return `wiki/${entityType}_${slugify(canonicalName)}.md`;
}

async function fetchWikiPage(s3Key: string): Promise<string> {
  try {
    const url = await storageGetSignedUrl(s3Key);
    const res = await fetch(url);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Extract unique entities from a document's claims.
 * Returns deduplicated list of (entityType, canonicalName, relationType).
 */
function extractEntitiesFromClaims(
  claims: Awaited<ReturnType<typeof getClaimsByDocument>>
): ExtractedEntity[] {
  const seen = new Set<string>();
  const entities: ExtractedEntity[] = [];

  function add(
    entityType: GraphEntity["entityType"],
    name: string | null | undefined,
    relationType: ExtractedEntity["relationType"]
  ) {
    if (!name || name.trim().length === 0) return;
    const key = `${entityType}::${name.trim().toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ entityType, canonicalName: name.trim(), relationType });
  }

  for (const c of claims) {
    add("pdb_id", c.pdbId, "cites");
    add("protein", c.proteinName, "cites");
    add("method", c.experimentalMethod, "uses_method");
    add("organism", c.organism, "expressed_in");
    add("ligand", c.ligand, "binds");
  }

  return entities;
}

// ─── LLM wiki compiler ────────────────────────────────────────────────────────

async function compileWikiPage(
  entityType: string,
  entityName: string,
  existingPage: string,
  newClaims: Awaited<ReturnType<typeof getClaimsByDocument>>,
  documentId: number,
  documentTitle: string
): Promise<string> {
  const relevantClaims = newClaims.filter((c) => {
    if (entityType === "pdb_id") return c.pdbId === entityName;
    if (entityType === "protein") return c.proteinName === entityName;
    if (entityType === "method") return c.experimentalMethod === entityName;
    if (entityType === "organism") return c.organism === entityName;
    if (entityType === "ligand") return c.ligand === entityName;
    return false;
  });

  if (relevantClaims.length === 0) return existingPage;

  const claimsSummary = relevantClaims
    .map(
      (c) =>
        `- ${c.claimText} [verdict: ${c.verdict ?? "pending"}, confidence: ${c.confidenceScore ?? "?"}]`
    )
    .join("\n");

  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt = `You are a scientific wiki compiler for Truth Desk, a molecular biology claims verification platform.
Your task: update the wiki page for the entity "${entityName}" (type: ${entityType}) by integrating new claims from Document #${documentId} ("${documentTitle}").

Rules:
- Maintain GitHub-flavored Markdown format.
- Use wikilinks like [[Entity: Name]] for cross-references.
- NEVER delete old claims — always append with dates.
- Flag contradictions explicitly in a "## Contradictions Detected" section.
- Keep the "## Claims Audit Log" as a Markdown table with columns: Document | Claim | Verdict | Date.
- Keep the page concise — max 600 words.
- If no existing page is provided, create a new one with appropriate sections.`;

  const userPrompt = existingPage
    ? `Existing wiki page:\n${existingPage}\n\nNew claims from Doc #${documentId} (${today}):\n${claimsSummary}\n\nUpdate the wiki page.`
    : `No existing page. Create a new wiki page for "${entityName}" (${entityType}) with these claims from Doc #${documentId} (${today}):\n${claimsSummary}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }
  } catch (err) {
    console.error("[WikiCompiler] LLM error:", err);
  }

  // Fallback: append claims as plain text if LLM fails
  const fallback = existingPage
    ? `${existingPage}\n\n### Doc #${documentId} (${today})\n${claimsSummary}`
    : `# ${entityType}: ${entityName}\n\n### Doc #${documentId} (${today})\n${claimsSummary}`;
  return fallback;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function compileDocumentToWiki(documentId: number): Promise<void> {
  try {
    const doc = await getDocumentById(documentId);
    if (!doc) {
      console.warn(`[WikiCompiler] Document #${documentId} not found`);
      return;
    }

    const claims = await getClaimsByDocument(documentId);
    if (!claims.length) {
      console.log(`[WikiCompiler] No claims for doc #${documentId} — skipping`);
      return;
    }

    const entities = extractEntitiesFromClaims(claims);
    console.log(
      `[WikiCompiler] Doc #${documentId}: ${entities.length} unique entities to compile`
    );

    // Upsert "document" entity for this doc itself
    const docEntity = await upsertGraphEntity({
      entityType: "document",
      canonicalName: `Doc #${documentId}: ${doc.title.slice(0, 80)}`,
      firstSeenDocumentId: documentId,
      metadata: { documentId, title: doc.title },
    });

    for (const entity of entities) {
      const s3Key = wikiKey(entity.entityType, entity.canonicalName);

      // 1. Fetch existing wiki page
      const existingPage = await fetchWikiPage(s3Key);

      // 2. Compile updated page via LLM
      const updatedPage = await compileWikiPage(
        entity.entityType,
        entity.canonicalName,
        existingPage,
        claims,
        documentId,
        doc.title
      );

      // 3. Write back to S3
      await storagePut(s3Key, Buffer.from(updatedPage, "utf-8"), "text/markdown");

      // 4. Upsert graph entity
      const graphEntity = await upsertGraphEntity({
        entityType: entity.entityType,
        canonicalName: entity.canonicalName,
        wikiPagePath: s3Key,
        firstSeenDocumentId: documentId,
      });

      // 5. Create typed relation: document → entity
      if (docEntity && graphEntity) {
        await upsertGraphRelation({
          sourceEntityId: docEntity.id,
          targetEntityId: graphEntity.id,
          relationType: entity.relationType,
          evidenceDocumentId: documentId,
          confidenceScore: 0.9,
        });
      }
    }

    console.log(
      `[WikiCompiler] Doc #${documentId}: wiki compilation complete (${entities.length} entities)`
    );
  } catch (err) {
    // Non-fatal — pipeline should not fail if wiki compilation fails
    console.error(`[WikiCompiler] Error compiling doc #${documentId}:`, err);
  }
}

// ─── Exported helpers for wikiLinter ─────────────────────────────────────────

export { fetchWikiPage, wikiKey, slugify };
