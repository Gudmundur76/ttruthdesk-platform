/**
 * verticalAdapters/evidenceSynthesizer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared LLM-backed evidence synthesis layer for all vertical adapters.
 *
 * Each vertical adapter collects raw evidence (PubMed RCT counts, PubChem
 * compound data, UniProt protein identity, FDA adverse events). This module
 * takes that raw evidence and uses an LLM to produce a structured synthesis:
 * a confidence score, a verdict rationale, and specific flags.
 *
 * This closes the "8 verticals, 2 fully wired" tension by giving every
 * vertical the same deep LLM interpretation layer that structuralBiology has.
 */
import { invokeLLM } from "../_core/llm";
import type { EvidenceResult } from "./types";

export interface RawEvidence {
  /** The original claim text */
  claimText: string;
  /** The extracted value from the claim (e.g. "25g/day", "PMID:12345678") */
  extractedValue: string | null;
  /** Domain key of the vertical (e.g. "protein_supplement") */
  domainKey: string;
  /** Human-readable domain name */
  domainName: string;
  /** Number of PubMed RCTs found */
  rctCount: number;
  /** Top PubMed IDs */
  topPmids: string[];
  /** PubChem compound ID if found */
  pubchemCid: number | null;
  /** Compound/protein name resolved */
  compoundName: string | null;
  /** UniProt entry found */
  uniprotFound: boolean;
  /** UniProt flags */
  uniprotFlags: string[];
  /** FDA adverse event count if relevant */
  fdaAdverseCount?: number;
  /** Pre-heuristic confidence score from the adapter */
  baseScore: number;
  /** Pre-heuristic flags from the adapter */
  baseFlags: string[];
}

export interface SynthesisResult {
  confidenceScore: number;
  confidenceFlags: string[];
  verdictRationale: string;
  synthesisModel: string;
}

const SYNTHESIS_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "evidence_synthesis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        confidenceScore: {
          type: "number",
          description: "0.0–1.0 confidence that the claim is supported by the evidence",
        },
        confidenceFlags: {
          type: "array",
          items: { type: "string" },
          description: "2–5 specific flags explaining the confidence score",
        },
        verdictRationale: {
          type: "string",
          description: "1–3 sentence rationale for the confidence score, citing specific evidence",
        },
      },
      required: ["confidenceScore", "confidenceFlags", "verdictRationale"],
      additionalProperties: false,
    },
  },
};

/**
 * Synthesise evidence using an LLM.
 *
 * Falls back to the base heuristic score if the LLM call fails, so the
 * adapter always returns a result even when the LLM is unavailable.
 */
export async function synthesiseEvidence(raw: RawEvidence): Promise<SynthesisResult> {
  const evidenceSummary = [
    `Domain: ${raw.domainName}`,
    `Claim: "${raw.claimText}"`,
    raw.extractedValue ? `Extracted value: ${raw.extractedValue}` : null,
    `PubMed RCTs found: ${raw.rctCount}`,
    raw.topPmids.length > 0 ? `Top PMIDs: ${raw.topPmids.slice(0, 5).join(", ")}` : null,
    raw.pubchemCid ? `PubChem CID: ${raw.pubchemCid} (${raw.compoundName})` : null,
    raw.uniprotFound ? `UniProt: confirmed (${raw.uniprotFlags.join("; ")})` : "UniProt: not found",
    raw.fdaAdverseCount !== undefined
      ? `FDA adverse events: ${raw.fdaAdverseCount}`
      : null,
    `Pre-synthesis confidence: ${raw.baseScore.toFixed(2)}`,
    `Pre-synthesis flags: ${raw.baseFlags.join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a scientific evidence evaluator specialising in nutrition, biochemistry, " +
            "and clinical research. Given a claim and its supporting evidence, produce a " +
            "structured confidence assessment. Be precise, cite specific evidence, and flag " +
            "any methodological concerns (e.g. small sample sizes, industry funding, lack of " +
            "replication). Your confidenceScore must be between 0.0 and 1.0.",
        },
        {
          role: "user",
          content: `Evaluate the following claim and its evidence:\n\n${evidenceSummary}`,
        },
      ],
      response_format: SYNTHESIS_SCHEMA,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty LLM response");

    const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content)) as {
      confidenceScore: number;
      confidenceFlags: string[];
      verdictRationale: string;
    };

    // Validate and clamp
    const score = Math.max(0, Math.min(1, Number(parsed.confidenceScore) || raw.baseScore));
    const flags = Array.isArray(parsed.confidenceFlags)
      ? parsed.confidenceFlags.slice(0, 6)
      : raw.baseFlags;
    // Strip any leaked prompt engineering instructions from the rationale
    const sanitiseRationale = (text: string): string =>
      text
        .replace(/\[Audit note:[^\]]*\]/gi, "")
        .replace(/\[INST\][\s\S]*?\[\/INST\]/gi, "")
        .replace(/<\|system\|>[\s\S]*?<\|end\|>/gi, "")
        .replace(/^(System:|Human:|Assistant:|User:)\s*/gim, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    const rawRationale =
      typeof parsed.verdictRationale === "string" && parsed.verdictRationale.length > 0
        ? parsed.verdictRationale
        : "Evidence synthesis unavailable.";
    const rationale = sanitiseRationale(rawRationale) || "Evidence synthesis unavailable.";

    return {
      confidenceScore: score,
      confidenceFlags: ["[LLM-synthesised]", ...flags],
      verdictRationale: rationale,
      synthesisModel: (response.model as string) ?? "unknown",
    };
  } catch {
    // Graceful fallback — return the heuristic result
    return {
      confidenceScore: raw.baseScore,
      confidenceFlags: ["[heuristic-fallback]", ...raw.baseFlags],
      verdictRationale: "LLM synthesis unavailable; heuristic score used.",
      synthesisModel: "heuristic",
    };
  }
}

/**
 * Merge a SynthesisResult into an EvidenceResult.
 * Preserves all existing fields; replaces confidenceScore and confidenceFlags.
 */
export function applySynthesis(base: EvidenceResult, synthesis: SynthesisResult): EvidenceResult {
  return {
    ...base,
    confidenceScore: synthesis.confidenceScore,
    confidenceFlags: synthesis.confidenceFlags,
    evidenceRaw: {
      ...(base.evidenceRaw ?? {}),
      verdictRationale: synthesis.verdictRationale,
      synthesisModel: synthesis.synthesisModel,
    },
  };
}
