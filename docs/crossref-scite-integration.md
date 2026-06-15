# Crossref + Scite Integration Plan

Sprint 20 File 4 action item: document the Crossref and Scite.ai integration plan
to enrich citation evidence with citation counts, retraction notices, and supporting/
contrasting citation signals.

---

## Why Crossref + Scite?

The current evidence pipeline fetches PubMed abstracts and runs keyword-overlap
confidence scoring. Two critical signals are missing:

1. **Citation count / impact** — a claim supported by a paper cited 2,000 times
   should score higher than one from an uncited preprint.
2. **Supporting vs. contrasting citations** — Scite.ai classifies each citing paper
   as "supporting", "contrasting", or "mentioning". This is the closest thing to
   peer-reviewed contradiction detection at scale.

---

## Crossref Integration

### What it provides

- DOI resolution and metadata (title, authors, journal, year, citation count)
- Retraction notices (via Crossref Event Data + Retraction Watch feed)
- Open access status (via Unpaywall integration)

### API

- **Endpoint:** `https://api.crossref.org/works/{doi}`
- **Rate limit:** 50 req/s (polite pool with `mailto:` header)
- **Auth:** None required (polite pool)
- **Cost:** Free

### Integration plan

```typescript
// server/verticalAdapters/crossRef.ts (already exists — needs enrichment)
// Add to fetchCrossrefMetadata():
//   1. citation_count: works.is-referenced-by-count
//   2. retracted: check works.update-to[].type === 'retraction'
//   3. open_access: works.link[].content-type === 'text/html'
```

**New field on EvidenceResult:**

```typescript
interface EvidenceResult {
  // ... existing fields ...
  citationCount?: number; // from Crossref is-referenced-by-count
  isRetracted?: boolean; // from Crossref update-to retraction notice
  openAccess?: boolean; // from Crossref link content-type
}
```

**Confidence score adjustment:**

- `citationCount > 100` → multiply item confidence by 1.2 (cap at 1.0)
- `citationCount > 1000` → multiply by 1.4
- `isRetracted === true` → set item confidence to 0.0, add `retracted: true` flag

---

## Scite.ai Integration

### What it provides

- Per-paper citation classification: supporting / contrasting / mentioning
- Smart citations: which specific claims in a paper are supported or contradicted
- Retraction and correction notices

### API

- **Endpoint:** `https://api.scite.ai/papers/{doi}/tallies`
- **Rate limit:** 100 req/min (free tier)
- **Auth:** Bearer token (free API key at https://scite.ai/api-access)
- **Cost:** Free tier available; paid for bulk

### Integration plan

```typescript
// New file: server/verticalAdapters/sciteEnricher.ts
// Fetches tally for a DOI and returns:
//   { supporting: number, contrasting: number, mentioning: number }
//
// Called from buildEvidenceWithExcerpts() after PubMed fetch:
//   if (doi) {
//     const tally = await fetchSciteTally(doi)
//     item.supportingCitations = tally.supporting
//     item.contrastingCitations = tally.contrasting
//     if (tally.contrasting > tally.supporting) {
//       item.confidenceScore = Math.max(0.1, item.confidenceScore - 0.2)
//     }
//   }
```

**New fields on EvidenceResult:**

```typescript
interface EvidenceResult {
  // ... existing fields ...
  supportingCitations?: number; // from Scite tally
  contrastingCitations?: number; // from Scite tally — drives contradiction detection
  sciteTally?: { supporting: number; contrasting: number; mentioning: number };
}
```

**MCP tool impact:**

- `verify_claim` response will include `sciteTally` per evidence item
- `get_provenance` will include `contrastingCitations` count in the provenance chain
- `search_claims` will support `?min_supporting_citations=N` filter

---

## Implementation Phases

| Phase       | Action                                                                   | Effort  |
| ----------- | ------------------------------------------------------------------------ | ------- |
| **Phase A** | Add `citationCount` + `isRetracted` from Crossref to EvidenceResult      | 1 day   |
| **Phase B** | Adjust confidence score based on citation count and retraction status    | 0.5 day |
| **Phase C** | Create `sciteEnricher.ts` with Scite tally fetch + caching               | 1 day   |
| **Phase D** | Wire Scite tally into `buildEvidenceWithExcerpts()`                      | 0.5 day |
| **Phase E** | Expose `sciteTally` in MCP `verify_claim` and `get_provenance` responses | 0.5 day |
| **Phase F** | Add `?min_supporting_citations=N` filter to `search_claims` MCP tool     | 0.5 day |

**Total estimated effort:** 4 days

---

## Environment Variables Required

```bash
# .env additions
SCITE_API_KEY=<your-scite-api-key>           # from https://scite.ai/api-access
CROSSREF_MAILTO=<your-email>                  # polite pool identifier
```

---

## Notes

- Crossref adapter (`crossRef.ts`) already exists and is registered. Phase A
  extends it rather than creating a new file.
- Scite.ai is a new dependency. The `sciteEnricher.ts` file should be a standalone
  enricher (not a vertical adapter) since it enriches existing evidence rather than
  discovering new papers.
- Both integrations should be **optional** — if the API key is missing or the
  request fails, the pipeline falls back gracefully to the existing scoring.
- Cache Scite tallies in the DB (`evidenceCache` table) with a 7-day TTL to avoid
  hitting rate limits during batch verification.
