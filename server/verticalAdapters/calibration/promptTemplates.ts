/**
 * promptTemplates.ts
 * G1/G2/G3 prompt rewrite templates. FR-CAL-05, FR-CAL-06, FR-CAL-07.
 */

// ─── G1: Generate extraction prompt for under-extracting adapters ─────────────
export const G1_EXTRACTION_TEMPLATE = `You are a scientific claim extractor. Your task is to identify
SPECIFIC, VERIFIABLE claims from the following text.

A verifiable claim MUST:
1. Name a specific entity (protein ID, PDB code, drug name, law number, economic indicator)
2. Include a specific value (resolution in angstroms, percentage, date, count)
3. Make a testable assertion that can be confirmed or refuted against a database

Extract each claim as a JSON array. Each item must have:
- "claimText": the exact claim as a complete sentence
- "claimType": one of "structural", "clinical", "economic", "legal", "environmental"
- "confidence": a number 0.0-1.0

Return: [{"claimText": "...", "claimType": "...", "confidence": 0.0}]

TEXT:
{text}`;

/**
 * Generate a G1 extraction prompt for a given text.
 * Used when an adapter has avgPrecision < 0.3 (under-extracting).
 */
export function generateG1Prompt(text: string): string {
  return G1_EXTRACTION_TEMPLATE.replace("{text}", text);
}

// ─── G2: Constrain over-extracting adapters ───────────────────────────────────
export const G2_CLAIM_SENTENCE_CONSTRAINT = `
CONSTRAINT — Only extract a claim if ALL of the following are true:
1. It contains a specific named entity (not "a protein" but "p53 (UniProt P04637)")
2. It contains a specific measurable value (not "high resolution" but "2.1 angstroms")
3. It is independently verifiable against a public database or registry
4. It is NOT a general statement about a field or methodology

Return: [{"claimText": "...", "claimType": "...", "confidence": 0.0}]`;

/**
 * Rewrite a G2 prompt by appending the constraint block.
 * Removes any existing Return:/Extract as JSON instructions first.
 */
export function rewriteG2Prompt(originalPrompt: string): string {
  const cleaned = originalPrompt
    .replace(/\nReturn:[\s\S]*$/, "")
    .replace(/\nExtract as JSON[\s\S]*$/, "")
    .trimEnd();
  return `${cleaned}\n${G2_CLAIM_SENTENCE_CONSTRAINT}`;
}

// ─── G3: Enhance vague prompts with verification criteria ─────────────────────
export const G3_VERIFICATION_CRITERIA_BLOCK = `
VERIFICATION CRITERIA — A claim is ONLY verifiable if:
1. It names a specific entity (protein "P53", drug "Metformin", law "18 U.S.C. 1001", indicator "NY.GDP.MKTP.CD")
2. It includes a specific value ("2.1 angstroms", "5-10%", "2024", "$25.4 trillion")
3. It makes a testable assertion (X causes Y, X is greater than Y, X occurred on date Y)

DO NOT extract:
- Opinions or value judgments
- General descriptions of fields or methodologies
- Statements without specific entities or values`;

/**
 * Enhance a G3 prompt by appending the verification criteria block.
 * Used when an adapter has supportedRate < 0.15 (extracting unverifiable claims).
 */
export function enhanceG3Prompt(originalPrompt: string): string {
  return `${originalPrompt.trimEnd()}\n${G3_VERIFICATION_CRITERIA_BLOCK}`;
}
