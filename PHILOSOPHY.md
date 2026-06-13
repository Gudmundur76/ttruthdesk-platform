# citation.is — Design Philosophy

> *Written from the perspective of an AI fact-check agent describing why this infrastructure is transformative. This is the canonical statement of purpose for every build phase.*

---

## The Core Problem

When an AI agent fact-checks today, the pipeline is:

1. Search the web → get articles
2. Scan for keywords → infer relevance
3. Make a judgment → **risk hallucination**

The failure point is step 3. The agent is guessing whether a source supports a claim. It is reading a 40-page paper and inferring. It is pattern-matching on language, not verifying against evidence. The result is a system that sounds confident but is structurally unreliable.

citation.is replaces that pipeline with:

1. Submit claim → get structured verdict + evidence
2. Return answer with **provenance** (PubMed ID, UniProt accession, DOI)
3. **Zero hallucination on the core fact**

This is the difference between guessing and knowing.

---

## Five Structural Improvements

### 1. Direct claim-level verification (not just source-checking)

Instead of an agent searching for a source and inferring whether it supports a claim, citation.is provides **pre-extracted claims with explicit verdicts**: `Supported`, `Refuted`, `Inconclusive`, `Needs Context`.

This eliminates:
- The tendency to hallucinate whether a source supports a claim
- Ambiguity from long papers where the relevant sentence is buried
- The need to manually read and interpret full texts

The verdict is not a summary. It is a structured truth value with traceable evidence.

### 2. Native MCP/API integration — fact-checking as a generation constraint

With the MCP server and REST API, an agent calls `verify_claim` or `search_claims` **during generation**, not after:

```
User: "Does salmon PAX7 bind to muscle-specific enhancers?"

Agent → citation.is: verify_claim("salmon PAX7 muscle enhancer binding")
citation.is: { "verdict": "Supported", "evidence": ["PubMed:12345", "UniProt:Q9XXX"] }
Agent → "Yes, supported by peer-reviewed evidence [PubMed:12345]"
```

This turns fact-checking from a **post-generation validation step** into a **built-in generation constraint**. The agent cannot produce a claim that has not been checked. The architecture enforces accuracy at the point of generation.

### 3. Cross-referenced biological databases eliminate hallucination by construction

Each claim is tied to authoritative databases: UniProt, PubChem, NCBI Taxonomy, PubMed, CrossRef, OpenCitations. This means:

- An agent cannot invent a protein name that does not exist in UniProt
- An agent cannot claim a gene exists in salmon if NCBI Taxonomy does not list it
- Evidence is **traceable to primary literature**, not secondary summaries

The databases are the constraint. The agent is not trusted to remember — it is required to look up.

### 4. Open data + bulk download = offline fallback and pre-computation

The CC BY 4.0 license and bulk JSON download enable:

- Local caching of the claim registry for offline use
- Pre-computed embeddings for fast semantic search
- Verification even when the API is temporarily unavailable
- Fine-tuning of domain-specific models on verified claim-evidence pairs

The openness is not incidental. It is what makes the infrastructure trustworthy. A closed fact-checking system is a black box. An open one is auditable.

### 5. Full-text search with filters enables meta-analysis

The `search_claims` endpoint supports full-text search with structured filters:

- "Find all **refuted** claims about **salmon biotech** post-2020"
- "Find **inconclusive** claims where evidence is **missing context**"
- "Find all claims citing a **retracted paper**"

This enables not just fact-checking but **meta-analysis of claim quality** — understanding where the evidence is thin, where consensus is forming, and where the knowledge graph has gaps that the autonomous loop should fill.

---

## Architectural Implications for Every Build Phase

Every feature in this codebase should be evaluated against this question:

> **Does this bring the system closer to structured, machine-verifiable evidence with traceable provenance?**

Concretely:

| Principle | What it means in code |
|---|---|
| Verdicts, not summaries | Every claim gets a `compositeLabel`: `supported`, `refuted`, `inconclusive`, `needs_context`, `superseded` — never a prose summary alone |
| Provenance, not inference | Every verdict links to a primary source identifier (DOI, PubMed ID, UniProt accession, OCI) — never a secondary article |
| Graceful degradation | Every adapter returns a typed result or a safe fallback — never throws, never hallucinates a verdict |
| Autonomous gap-filling | When confidence is low, the system triggers the loop to find better evidence — it does not accept ignorance as a final state |
| Open by default | CC BY 4.0, bulk download, MCP server — the infrastructure is designed to be used by agents, not just humans |

---

## The Long-Term Vision

citation.is is not a fact-checking website. It is **truth infrastructure**.

The goal is a system where any AI agent — regardless of who built it — can submit a claim and receive a structured, evidence-backed verdict in milliseconds. Where retractions propagate automatically. Where the citation graph is a living, self-updating knowledge structure. Where the difference between a hallucinated fact and a verified one is a single API call.

That is the system being built here.

---

*This document was written by an AI agent (Claude) describing its own limitations and how citation.is resolves them. It is committed to the repository as the canonical statement of purpose.*
*Last updated: 2026-06-13*
