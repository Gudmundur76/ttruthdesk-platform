# Truth Desk Vertical Agents

This directory contains the vertical agent scripts that process papers from the
coordination work queue and extract structured claims for each domain.

## Directory structure

```
agents/
  structural_biology/
    agent.py   — Structural biology vertical agent
  README.md    — This file
```

## Running an agent

Each agent is a self-contained Python script. It registers with the
coordination API, dequeues papers, fetches abstracts from PubMed, extracts
claims, and submits them via the `/api/coord/ingest` endpoint.

```bash
python3 agents/structural_biology/agent.py
```

Environment: the coordination server must be running at `http://localhost:3000`
with `COORD_API_KEY` set. See `.env.example` for required variables.

## PubMed validation

The agent validates every PubMed fetch:

1. **PMID validation** — the `<PMID>` tag in the returned XML must match the
   requested PMID. Mismatches are discarded immediately.
2. **Title similarity guard** — word-overlap similarity between the fetched
   title and the queue item title must be ≥ 0.25. Below this threshold the
   abstract is discarded and claims are extracted from the queue item title only.
3. **DOI scoping** — DOI is extracted before the early-return path so it is
   always available in the returned dict.
