# Citation Integrity Assessment — SIA Task

This directory contains the SIA (Self-Improving AI) task definition for **citation integrity assessment** — the core evaluation task of the Protein Truth Desk platform.

The task trains and benchmarks an AI agent to classify the citation state of scientific claims: whether the evidence asserted to support a claim actually does so, and to what degree.

---

## Task Overview

| Property             | Value                                                                             |
| -------------------- | --------------------------------------------------------------------------------- |
| Task ID              | `citation-integrity`                                                              |
| Domain               | Protein biology, pharmacology, genomics                                           |
| Output format        | `submission.jsonl`                                                                |
| Primary metric       | Combined score (state accuracy 0.6 + passage precision 0.25 + misrep recall 0.15) |
| Public dataset       | 200 claim-source pairs                                                            |
| Private held-out set | 100 claim-source pairs                                                            |

---

## Directory Structure

```
citation-integrity/
├── data/
│   ├── public/
│   │   ├── task.md                    ← Task description (SIA Meta-Agent reads this)
│   │   ├── claims.jsonl               ← 200 public claim-source pairs (generated)
│   │   └── evaluate.py                ← Evaluator script
│   └── private/
│       └── ground_truth.jsonl         ← 100 held-out ground truth records (generated)
├── reference/
│   ├── reference_target_agent.py      ← Seed agent (SIA improves this)
│   └── SAMPLE_TASK_DESCRIPTIONS.md    ← Examples for Meta-Agent context
├── generate_dataset.mjs               ← Exports data from platform database
└── README.md
```

---

## Setup

### Step 1: Generate the dataset from the platform database

```bash
cd sia-tasks/citation-integrity
node generate_dataset.mjs
```

This exports claim-source pairs from the platform's MySQL database into the SIA task format. Requires `DATABASE_URL` in environment (same as the platform server).

### Step 2: Install SIA

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install 'sia-agent[claude]'
export ANTHROPIC_API_KEY="..."
```

### Step 3: Run the self-improvement loop

```bash
sia run --task_dir ./sia-tasks/citation-integrity --max_gen 5 --run_id 1
```

Watch generations improve in the live dashboard at `http://127.0.0.1:8000`.

---

## What SIA Improves

SIA's Feedback Agent will improve the reference target agent across generations by:

1. **Passage extraction precision** — returning the minimum verbatim quote rather than the full abstract
2. **Confidence calibration** — scoring ambiguous cases at 0.5–0.65 rather than defaulting to high confidence
3. **Scope boundary detection** — identifying when hedging language ("suggests", "may", "in this cohort") is removed in the claim
4. **Contested vs. implied distinction** — correctly distinguishing partial-source cases from no-source cases
5. **Misrepresentation pattern precision** — distinguishing `strength_overclaim` from `scope_overclaim`

---

## Integration with the Platform

The improved target agent from each generation can be evaluated against the platform's production verdict engine. The generation with the highest combined score represents the best available citation integrity classifier for that dataset.

To integrate an improved generation back into the platform:

1. Review `runs/run_1/gen_N/target_agent.py` — the improved agent code
2. Extract the improved classification prompts and passage extraction logic
3. Update `server/pdbAdapter.ts` with the improved prompts
4. Run `pnpm test` to verify no regressions
5. Commit with phase tag `feat(sia): integrate gen_N improvements`

---

## Evaluation Metrics

| Metric                      | Weight | Description                                                       |
| --------------------------- | ------ | ----------------------------------------------------------------- |
| Citation state accuracy     | 0.60   | Exact match on `verified / contested / implied / beyond_evidence` |
| Passage alignment precision | 0.25   | Whether `source_passage` contains the ground-truth passage        |
| Misrepresentation recall    | 0.15   | Correct identification of the misrepresentation pattern           |

**Combined score** = `0.6 × state_accuracy + 0.25 × passage_precision + 0.15 × misrep_recall`

A combined score above 0.75 represents production-quality citation integrity assessment. The reference agent baseline is expected to score approximately 0.45–0.55 on generation 1.

---

## Governing Principle

Every improvement SIA makes to the target agent is evaluated against one question: **does this make the agent a more accurate citation integrity classifier?**

Improvements that increase the combined score are adopted. Improvements that only make the agent code more elegant without improving the score are noted but not integrated into the platform.
