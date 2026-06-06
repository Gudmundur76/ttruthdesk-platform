/**
 * frictionEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * FrictionEngine Pre-Submission Interrogation Layer
 *
 * Before a user submits a document for full audit, this service runs a fast
 * (< 5 second) preflight scan that surfaces:
 *
 *   1. How many claims are extractable
 *   2. How many are verifiable against known databases
 *   3. How many smuggle assumptions not supported by the methods
 *   4. How many contradict known structures
 *
 * This is the FrictionEngine "Intent Inference + Assumption Mapping" phase
 * applied to scientific documents. The user sees:
 *
 *   "Your text contains 23 claims. 12 are verifiable against databases.
 *    8 assume conclusions not in the methods. 3 contradict known PDB structures.
 *    Submit for full audit?"
 *
 * The preflight does NOT run the full verdict pipeline — it uses a lightweight
 * LLM pass to classify claims by type and estimate verifiability.
 *
 * Exports:
 *   runPreflightScan(text)  → PreflightResult
 */

import { invokeMultiLLM } from "./_core/multiLLM";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClaimCategory =
  | "database_verifiable"   // Can be checked against PDB, UniProt, OpenFDA, etc.
  | "assumption_smuggled"   // Assumes a conclusion not supported by the methods
  | "likely_contradicted"   // Likely to contradict known structures/data
  | "out_of_scope"          // Cannot be verified with available databases
  | "opinion_or_narrative"; // Not a factual claim — narrative or interpretation

export interface PreflightClaim {
  text: string;
  category: ClaimCategory;
  assumptionExposed: string | null; // The hidden premise, if any
  falsificationTest: string | null; // "What would disprove this?" — Falsification Gate
}

export interface PreflightResult {
  totalClaims: number;
  databaseVerifiable: number;
  assumptionSmuggled: number;
  likelyContradicted: number;
  outOfScope: number;
  opinionOrNarrative: number;
  claims: PreflightClaim[];
  /** Human-readable summary for the confirmation dialog */
  summary: string;
  /** Whether the document is worth submitting for full audit */
  recommendSubmit: boolean;
  /** Reason for the recommendation */
  recommendReason: string;
  durationMs: number;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const FRICTION_SYSTEM_PROMPT = `You are the FrictionEngine pre-submission interrogator for Truth Desk, a scientific claim verification platform.

Your task is to rapidly scan a scientific document and classify every factual claim it makes into one of five categories:

1. "database_verifiable" — The claim can be checked against a structured database (PDB, UniProt, PubMed, OpenFDA, USDA, etc.). Example: "PDB 1LYZ was solved at 1.8Å resolution by X-ray crystallography."

2. "assumption_smuggled" — The claim assumes a conclusion that is NOT supported by the methods section or available evidence. Example: "This protein is the primary driver of disease X" (when the paper only shows correlation).

3. "likely_contradicted" — The claim is likely to contradict known database records. Example: "PDB 1LYZ has resolution 1.8Å" when the actual PDB record shows 2.0Å.

4. "out_of_scope" — The claim cannot be verified with available scientific databases. Example: "This therapy will be approved by regulators."

5. "opinion_or_narrative" — Not a factual claim. Narrative, interpretation, or opinion. Example: "This is a landmark study."

For each claim, also identify:
- assumptionExposed: The hidden premise the claim smuggles (e.g., "This assumes the protein was expressed in E. coli"), or null if none.
- falsificationTest: What evidence would disprove this claim (e.g., "PDB record showing different resolution"), or null if not applicable.

Return a JSON object with this exact schema:
{
  "claims": [
    {
      "text": "exact claim text",
      "category": "database_verifiable|assumption_smuggled|likely_contradicted|out_of_scope|opinion_or_narrative",
      "assumptionExposed": "string or null",
      "falsificationTest": "string or null"
    }
  ]
}

Be conservative — only extract claims that are specific and factual. Ignore vague statements. Return at most 30 claims.`;

// ─── Core function ────────────────────────────────────────────────────────────

export async function runPreflightScan(text: string): Promise<PreflightResult> {
  const start = Date.now();

  // Truncate to avoid token limits — preflight is a fast scan
  const truncated = text.length > 8000
    ? text.substring(0, 8000) + "\n[Document truncated for preflight scan]"
    : text;

  let claims: PreflightClaim[] = [];

  try {
    const response = await invokeMultiLLM(
      {
        messages: [
          { role: "system", content: FRICTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Run the FrictionEngine preflight scan on this document:\n\n${truncated}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "preflight_claims",
            strict: false,
            schema: {
              type: "object",
              properties: {
                claims: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string" },
                      category: {
                        type: "string",
                        enum: [
                          "database_verifiable",
                          "assumption_smuggled",
                          "likely_contradicted",
                          "out_of_scope",
                          "opinion_or_narrative",
                        ],
                      },
                      assumptionExposed: { type: "string" },
                      falsificationTest: { type: "string" },
                    },
                    required: ["text", "category"],
                  },
                },
              },
              required: ["claims"],
            },
          },
        },
        temperature: 0.1,
        max_tokens: 2048,
      },
      "draft"
    );

    const content = response.choices?.[0]?.message?.content as string | undefined;
    if (content) {
      const parsed = JSON.parse(content);
      claims = (parsed.claims ?? []) as PreflightClaim[];
    }
  } catch (err) {
    console.error("[FrictionEngine] Preflight scan LLM error:", err);
    // Return a minimal result on failure — don't block submission
    return {
      totalClaims: 0,
      databaseVerifiable: 0,
      assumptionSmuggled: 0,
      likelyContradicted: 0,
      outOfScope: 0,
      opinionOrNarrative: 0,
      claims: [],
      summary: "Preflight scan unavailable. You can still submit for full audit.",
      recommendSubmit: true,
      recommendReason: "Preflight scan failed — proceeding without pre-screening.",
      durationMs: Date.now() - start,
    };
  }

  // ─── Tally by category ───────────────────────────────────────────────────
  const counts = {
    database_verifiable: 0,
    assumption_smuggled: 0,
    likely_contradicted: 0,
    out_of_scope: 0,
    opinion_or_narrative: 0,
  };
  for (const c of claims) {
    if (c.category in counts) counts[c.category as keyof typeof counts]++;
  }

  const total = claims.length;
  const verifiable = counts.database_verifiable;
  const smuggled = counts.assumption_smuggled;
  const contradicted = counts.likely_contradicted;

  // ─── Build human-readable summary ────────────────────────────────────────
  const parts: string[] = [];
  if (total === 0) {
    parts.push("No verifiable claims detected.");
  } else {
    parts.push(`${total} claim${total !== 1 ? "s" : ""} detected.`);
    if (verifiable > 0) parts.push(`${verifiable} verifiable against scientific databases.`);
    if (smuggled > 0) parts.push(`${smuggled} smuggle${smuggled !== 1 ? "" : "s"} assumptions not in the methods.`);
    if (contradicted > 0) parts.push(`${contradicted} likely contradict${contradicted !== 1 ? "" : "s"} known database records.`);
  }
  const summary = parts.join(" ");

  // ─── Recommendation logic ─────────────────────────────────────────────────
  let recommendSubmit = true;
  let recommendReason = "This document contains verifiable claims worth auditing.";

  if (total === 0) {
    recommendSubmit = false;
    recommendReason = "No verifiable claims found. Full audit may return empty results.";
  } else if (verifiable === 0 && smuggled === 0 && contradicted === 0) {
    recommendSubmit = false;
    recommendReason = "All claims are out of scope or narrative. Full audit may return empty results.";
  } else if (contradicted > 0) {
    recommendSubmit = true;
    recommendReason = `${contradicted} claim${contradicted !== 1 ? "s" : ""} likely contradict known database records — full audit recommended.`;
  } else if (smuggled > 0) {
    recommendSubmit = true;
    recommendReason = `${smuggled} claim${smuggled !== 1 ? "s" : ""} carry hidden assumptions — full audit will expose them.`;
  }

  return {
    totalClaims: total,
    databaseVerifiable: verifiable,
    assumptionSmuggled: smuggled,
    likelyContradicted: contradicted,
    outOfScope: counts.out_of_scope,
    opinionOrNarrative: counts.opinion_or_narrative,
    claims,
    summary,
    recommendSubmit,
    recommendReason,
    durationMs: Date.now() - start,
  };
}
