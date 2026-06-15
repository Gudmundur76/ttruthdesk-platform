# Sprint 25 — Phase 1: BioMCP Benchmark & Latency Report

*Date: 15 June 2026 | Measured from sandbox (EU West)*

## Summary

The current PubMed query averages **~2,100ms** per claim. The Perplexity Computer target is **sub-500ms** total MCP roundtrip. The gap is 4x. The bottleneck is the Europe PMC search endpoint with a 12-second timeout and no parallelism.

## BioMCP vs citation.is Differentiation

| Capability | BioMCP (genomoncology/biomcp) | citation.is |
|---|---|---|
| PubMed retrieval | ✅ Fetches articles | ✅ Fetches articles |
| ClinicalTrials.gov | ✅ | ✅ |
| MyVariant.info | ✅ | ❌ (not needed for claims) |
| **Claim verdict** | ❌ Returns data only | ✅ Supported / Contradicted / Insufficient Evidence |
| **Confidence score** | ❌ | ✅ 0.0–1.0 float |
| **SPO triple** | ❌ | ✅ Subject-Predicate-Object |
| **Provenance chain** | ❌ | ✅ PMID + sentence |
| **NL decomposition** | ❌ | ✅ (Sprint 25 — this sprint) |
| **MCP server** | ✅ | ✅ |

**Key distinction:** BioMCP is a **retrieval tool**. citation.is is a **verification oracle**. BioMCP answers "what does PubMed say about X?" — we answer "is claim X supported by PubMed?"

## Latency Bottleneck Analysis

| Step | Current Time | Target | Fix |
|---|---|---|---|
| Europe PMC search | ~2,100ms | <300ms | Switch to NCBI E-utilities esearch+efetch with 5s timeout |
| SPO extraction | ~0ms (heuristic) | <50ms | Already fast — LLM path adds 2-8s, use heuristic first |
| Relevance filter | ~1ms | <5ms | Already fast |
| Confidence scoring | ~1ms | <5ms | Already fast |
| **Total (current)** | **~2,100ms** | **<500ms** | |

## Optimization Strategy

1. **Replace Europe PMC with NCBI E-utilities** — direct PubMed API, faster, more reliable
2. **Parallel multi-claim routing** — `Promise.all()` across decomposed claims
3. **Heuristic-first SPO** — use regex heuristic by default, LLM only for complex questions
4. **Reduce `retmax`** — fetch 3 papers instead of 5 for latency-sensitive paths
5. **Aggressive timeout** — 5s instead of 12s; fail fast and return partial results
