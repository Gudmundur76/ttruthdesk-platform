# Sample Task Descriptions — Citation Integrity Domain

These examples help the Meta-Agent understand the range of citation integrity tasks and the kinds of improvements that matter.

---

## Example 1: Strength Overclaim Detection

**Task:** A pharmaceutical company's marketing material states "Drug X cures Disease Y in 95% of patients." The cited source is a Phase 1 safety trial with 12 participants showing a 95% response rate on a surrogate biomarker endpoint. Classify the citation state and identify the misrepresentation pattern.

**Key challenge:** Distinguishing between a legitimate efficacy claim and a strength overclaim requires understanding the hierarchy of evidence (Phase 1 vs. Phase 3, surrogate vs. clinical endpoints, n=12 vs. n=1200).

---

## Example 2: Scope Overclaim in Genomics

**Task:** A news article claims "Gene variant BRCA2-X increases cancer risk in all women." The cited source studied a specific Ashkenazi Jewish population cohort. Classify the citation state.

**Key challenge:** Population-specific findings are frequently cited as universal. The agent must identify when a source's explicit scope limitations are being ignored.

---

## Example 3: Retraction Propagation

**Task:** A review article cites a 2018 paper to support a claim about protein folding mechanisms. The 2018 paper was retracted in 2021 due to data fabrication. Classify the citation state.

**Key challenge:** The source exists and the passage matches the claim, but the source itself is invalid. The agent must distinguish between the claim-source relationship and the source's validity status.

---

## Example 4: Abstract-Only Citation

**Task:** A meta-analysis cites a paper to support a claim about drug safety. The abstract reports no significant adverse events. The full text reports several serious adverse events in a subgroup analysis that was excluded from the abstract. Classify the citation state.

**Key challenge:** The abstract technically supports the claim, but the full text contradicts it. The agent must use full text when available and flag abstract-only citations when limitations are buried in the full text.

---

## Example 5: Implied Evidence at the Frontier

**Task:** A researcher claims "Protein Z is likely involved in autophagy regulation." No paper directly studies Protein Z and autophagy, but three papers show Protein Z interacts with known autophagy regulators. Classify the citation state.

**Key challenge:** This is a legitimate scientific inference, not a misrepresentation. The agent must correctly classify this as `implied` rather than `beyond_evidence` or `contested`.

---

## Improvement Directions

When improving the reference agent, focus on:

1. **Passage alignment accuracy** — the agent frequently returns the entire abstract instead of the specific sentence that supports or contradicts the claim. Improve the passage extraction to return the minimum verbatim quote that contains the relevant evidence.

2. **Confidence calibration** — the agent tends to assign high confidence (>0.85) even on ambiguous cases. Calibrate confidence so that genuinely ambiguous cases score 0.5–0.65.

3. **Scope boundary detection** — the agent misses scope overclaims when the source uses hedging language ("suggests", "may", "in this cohort") that the claim removes. Add explicit hedging language detection.

4. **Contested vs. implied distinction** — the agent sometimes classifies `implied` cases as `contested`. The distinction is: `contested` requires a source that partially supports the claim; `implied` requires no direct source but connected evidence. Improve this boundary.

5. **Misrepresentation pattern precision** — the agent over-assigns `strength_overclaim` when `scope_overclaim` is more accurate. Add a disambiguation step that checks scope before strength.
