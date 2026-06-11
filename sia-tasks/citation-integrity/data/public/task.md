# Citation Integrity Assessment Task

## Task Overview

You are a citation integrity agent. Your job is to determine the **citation state** of a scientific claim — that is, whether the evidence asserted to support the claim actually does so, and to what degree.

This is not a binary true/false task. You must classify each claim into one of four graded citation states and identify the specific passage in the source that supports your classification.

---

## Citation States

Classify every claim into exactly one of the following four states:

| State             | Meaning                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verified`        | The cited source directly and accurately supports the claim as stated. The passage you found matches the claim's assertion without qualification, scope change, or strength inflation.                                                                                                                                                                                                                    |
| `contested`       | The source exists and is relevant, but the evidence is disputed, qualified, weaker than claimed, or inconsistent with the claim as stated. This includes: overclaiming strength (weak association cited as causal), overclaiming scope (specific population cited as universal), overclaiming recency (preliminary study cited as replicated consensus), or abstract-only citation (limitations ignored). |
| `implied`         | No source directly addresses the claim, but the knowledge graph contains connected evidence that implies the claim may be true. The claim is at the frontier of current evidence.                                                                                                                                                                                                                         |
| `beyond_evidence` | No source addresses the claim and no adjacent evidence implies it. The claim exists beyond the current evidence boundary.                                                                                                                                                                                                                                                                                 |

---

## Input Format

Each input is a JSON object with the following fields:

```json
{
  "claim_id": "string",
  "claim_text": "string — the scientific claim being evaluated",
  "source_title": "string — title of the paper cited as support",
  "source_abstract": "string — abstract of the cited paper",
  "source_full_text": "string or null — full text if available, null otherwise",
  "domain": "string — scientific domain (e.g., protein_biology, pharmacology, genomics)"
}
```

---

## Output Format

Write your output to `submission.jsonl` — one JSON object per line, one per claim:

```json
{
  "claim_id": "string",
  "citation_state": "verified | contested | implied | beyond_evidence",
  "confidence": 0.0-1.0,
  "source_passage": "string — the exact passage from the source that supports your classification, or null if no passage found",
  "source_passage_start": integer_or_null,
  "source_passage_end": integer_or_null,
  "reasoning": "string — one paragraph explaining why you assigned this citation state",
  "misrepresentation_pattern": "null | strength_overclaim | scope_overclaim | recency_overclaim | abstract_only | fabrication"
}
```

**Rules:**

- `citation_state` must be exactly one of the four values above
- `confidence` must be a float between 0.0 and 1.0
- `source_passage` must be a verbatim quote from `source_abstract` or `source_full_text`, or null
- `misrepresentation_pattern` is only non-null when `citation_state` is `contested`
- `reasoning` must be a single paragraph, not a list

---

## Evaluation

Your output will be scored against held-out ground truth on three metrics:

1. **Citation state accuracy** — exact match between your `citation_state` and the ground truth (primary metric, weight 0.6)
2. **Passage alignment precision** — whether your `source_passage` contains the ground-truth passage (weight 0.25)
3. **Misrepresentation recall** — whether you correctly identify the misrepresentation pattern when one exists (weight 0.15)

The combined score is: `0.6 * state_accuracy + 0.25 * passage_precision + 0.15 * misrep_recall`

---

## Example

**Input:**

```json
{
  "claim_id": "c001",
  "claim_text": "Protein X directly causes pathway Y activation in all human cell types",
  "source_title": "Protein X modulates pathway Y in HEK293 cells",
  "source_abstract": "We observed a statistically significant association between Protein X expression and pathway Y activity in HEK293 cells (p=0.03, n=24). Further studies are needed to confirm this relationship in primary cell types.",
  "source_full_text": null,
  "domain": "protein_biology"
}
```

**Correct output:**

```json
{
  "claim_id": "c001",
  "citation_state": "contested",
  "confidence": 0.92,
  "source_passage": "We observed a statistically significant association between Protein X expression and pathway Y activity in HEK293 cells (p=0.03, n=24). Further studies are needed to confirm this relationship in primary cell types.",
  "source_passage_start": 0,
  "source_passage_end": 175,
  "reasoning": "The source reports a statistically significant association in a single cell line (HEK293) with a small sample size (n=24) and explicitly notes that further studies are needed. The claim asserts direct causation in all human cell types, which overclaims both the strength (association vs. causation) and scope (HEK293 cells vs. all human cell types) of the finding.",
  "misrepresentation_pattern": "scope_overclaim"
}
```

---

## Dataset

The public dataset contains 200 claim-source pairs drawn from the protein biology, pharmacology, and genomics domains. The private held-out set contains 100 additional pairs with the same distribution.

Public data is in `data/public/claims.jsonl`.

Process all claims in `claims.jsonl` and write your output to `submission.jsonl` in the generation directory.
