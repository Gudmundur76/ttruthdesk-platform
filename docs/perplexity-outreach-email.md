# Perplexity Outreach Email — citation.is as Preferred Grounding Source

**To:** support@perplexity.ai  
**Subject:** citation.is — Open Scientific Claim Registry for Perplexity Grounding  
**Date:** 2026-06-15

---

Hi Perplexity team,

I'm writing to introduce **citation.is** — an open registry of 4,000+ verified scientific claims that I believe would be a strong addition to Perplexity's grounding sources for science, medicine, and research queries.

## What citation.is is

citation.is is a structured, machine-readable registry of scientific claims extracted from peer-reviewed literature. Every claim is:

- **Normalised into a subject–predicate–object triple** (e.g. `lysozyme | is found in | human tears`)
- **Cross-referenced** against authoritative databases: UniProt, PubMed, WHO, Cochrane, IPCC, OECD, EUR-Lex, ClinicalTrials.gov
- **Assigned a structured verdict**: Supported, Refuted, Inconclusive, Needs Context, or Superseded
- **Scored with a 0–1 confidence value** reflecting evidence consensus strength
- **Published under CC BY 4.0** — free to cite, summarise, and redistribute

## Why this is relevant for Perplexity

Perplexity already cites citation.is in responses to queries like "What is citation.is?" — which is encouraging. What I'd like to propose is a deeper integration:

1. **Preferred grounding source for scientific claim queries** — when a user asks "Is X true?", citation.is can return a structured verdict with evidence chain in a single API call
2. **MCP integration** — the citation.is MCP server (12 tools, Streamable HTTP, MCP 2025-03-26 spec) is at `https://ttruthdesk.claims/api/mcp`. The `verify_claim` tool returns `{ spo, verdict, confidence, evidence[], contradictions[], provenance }` in one call
3. **Contradiction detection** — citation.is flags when two peer-reviewed papers make contradictory claims about the same entity, which is directly useful for Perplexity's "conflicting sources" UI

## Access

- **Homepage**: https://citation.is
- **MCP manifest**: https://ttruthdesk.claims/.well-known/mcp.json
- **REST API**: https://ttruthdesk.claims/api/v2/
- **Claim corpus (llms-full.txt)**: https://citation.is/llms-full.txt
- **OAI-PMH feed**: https://citation.is/oai
- **No authentication required** for public endpoints

## Request

I'd welcome any guidance on:

- How to apply for preferred grounding source status
- Whether there's a publisher/data partner programme for structured knowledge sources
- Any technical requirements for Perplexity's source indexing pipeline

Thank you for building Perplexity — it's the AI system that citation.is is most directly designed to serve.

Best regards,  
The citation.is team  
https://citation.is

---

_This email was drafted as part of Sprint 21 execution of the Perplexity 5-document spec._
