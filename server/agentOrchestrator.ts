/**
 * agentOrchestrator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The unified orchestrator that acts as the Manus-style agent.
 *
 * It chains the three core modules:
 *   1. Planner  (questionDecomposer) → breaks question into atomic SPO claims
 *   2. Executor (domainClassifier)   → routes each claim to the correct domain
 *   3. Verifier (ncbiAdapter + pdbAdapter) → fetches live evidence + verdict
 *
 * Exposes a single `runAgent(question)` function returning a structured
 * AgentResponse with sentence-level provenance per claim.
 */

import {
  decomposeQuestion,
  buildPubMedQuery,
  type AtomicClaim,
} from "./questionDecomposer";
import { classifyClaim, type ClassificationResult } from "./domainClassifier";
import { fetchNcbiResults } from "./ncbiAdapter";
import { verdictForClaim } from "./pdbAdapter";
import { logger } from "./logger";

const log = logger("agentOrchestrator");

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AgentEvidence {
  pmid?: string;
  sourceId?: string;
  title: string;
  sentence: string;
  url: string;
}

export interface AgentClaimResult {
  text: string;
  domain: string;
  verdict: string;
  confidence: number;
  evidence: AgentEvidence | null;
}

export interface AgentResponse {
  question: string;
  overallVerdict: string;
  latencyMs: number;
  claims: AgentClaimResult[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function mapNcbiToEvidence(
  results: Awaited<ReturnType<typeof fetchNcbiResults>>
): AgentEvidence | null {
  if (!results || results.length === 0) return null;
  const top = results[0];
  return {
    pmid: top.pmid,
    title: top.title,
    sentence: top.abstractSnippet,
    url: top.citationUrl,
  };
}

/**
 * Determine the primary source ID from a ClassificationResult.
 * Uses the first route's primarySource field.
 */
function getPrimarySource(classification: ClassificationResult): string {
  if (classification.routes.length === 0) return "pubmed";
  return classification.routes[0].sourceId;
}

/**
 * Determine the domain label from a ClassificationResult.
 */
function getDomainLabel(classification: ClassificationResult): string {
  return classification.domain;
}

// ─── Core orchestrator ────────────────────────────────────────────────────────

/**
 * Runs the full three-agent pipeline on a natural language question.
 *
 * @param question - Any natural language question or claim
 * @returns AgentResponse with per-claim verdicts and provenance
 */
export async function runAgent(question: string): Promise<AgentResponse> {
  const start = Date.now();
  log.info("Agent started", { question });

  // 1. PLANNER: Decompose the question into atomic claims
  const decomposed = await decomposeQuestion(question);
  log.info("Planner finished", { claimsCount: decomposed.claims.length });

  // 2 & 3. EXECUTOR & VERIFIER: Process each claim in parallel
  const claimPromises = decomposed.claims.map(
    async (claimObj: AtomicClaim): Promise<AgentClaimResult> => {
      const claimText = claimObj.text;

      // EXECUTOR: Classify domain
      const classification = classifyClaim(claimObj);
      const domain = getDomainLabel(classification);
      const source = getPrimarySource(classification);

      let verdict = "Insufficient Evidence";
      let confidence = 0.1;
      let evidence: AgentEvidence | null = null;

      // VERIFIER: Route to the correct adapter based on Executor's decision
      try {
        if (source === "rcsb_pdb" || source === "uniprot") {
          // PDB path: extract protein name from claim text for lookup
          const pdbResult = await verdictForClaim({
            claimType: "protein_name",
            proteinName: claimText,
          });
          verdict = pdbResult.verdict;
          confidence = verdict === "Supported" ? 0.9 : 0.4;
          if (pdbResult.verdict !== "Insufficient Evidence") {
            evidence = {
              sourceId: "PDB",
              title: "Protein Data Bank",
              sentence: pdbResult.rationale,
              url: pdbResult.evidenceUrl ?? "https://www.rcsb.org/",
            };
          }
        } else {
          // Default path: NCBI PubMed
          const query = buildPubMedQuery(claimObj);
          const results = await fetchNcbiResults(query, claimText, 3);

          if (results.length >= 2) {
            verdict = "Supported";
            confidence = Math.min(0.85 + results.length * 0.02, 0.95);
          } else if (results.length === 1) {
            verdict = "Partially Supported";
            confidence = 0.65;
          }
          evidence = mapNcbiToEvidence(results);
        }
      } catch (err) {
        log.error("Verifier failed for claim", { claimText, err });
      }

      return { text: claimText, domain, verdict, confidence, evidence };
    }
  );

  const processedClaims = await Promise.all(claimPromises);

  // Aggregate overall verdict (most severe wins)
  const hasContradicted = processedClaims.some(
    c => c.verdict === "Contradicted"
  );
  const hasSupported = processedClaims.some(c => c.verdict === "Supported");
  const hasPartial = processedClaims.some(
    c => c.verdict === "Partially Supported"
  );

  let overallVerdict = "Insufficient Evidence";
  if (hasContradicted) overallVerdict = "Contradicted";
  else if (hasSupported) overallVerdict = "Supported";
  else if (hasPartial) overallVerdict = "Partially Supported";

  const latencyMs = Date.now() - start;
  log.info("Agent finished", { latencyMs, overallVerdict });

  return { question, overallVerdict, latencyMs, claims: processedClaims };
}
