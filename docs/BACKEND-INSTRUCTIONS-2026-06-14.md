# ttruthdesk-platform — Backend Developer Instructions

**Prepared:** 2026-06-14 · Based on Fourth Pass Test Report + live API inspection  
**Repo:** https://github.com/Gudmundur76/ttruthdesk-platform  
**Live backend:** https://citation.manus.space  
**Frontend (citation.is):** https://citation.is

---

## Status Summary

| Area                                                                | Status                    | Action required                                        |
| ------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------ |
| Core read path (list, single claim, bulk JSON)                      | ✅ Working                | None                                                   |
| RSS, OAI-PMH, llms.txt, openapi.json                                | ✅ Working                | None                                                   |
| `POST /api/public/verify-claim`                                     | ✅ Working                | None — returns correct JSON (see §4)                   |
| Analytics endpoints (stats, verticals, leaderboard, contradictions) | ✅ Fixed in citation-desk | None — frontend now proxies to correct tRPC procedures |
| RSS domain in `<link>` / `<guid>`                                   | ✅ Fixed in citation-desk | None                                                   |
| `GET /mcp` SSE endpoint                                             | ❌ Times out              | Fix required — see §1                                  |
| Organism → PubChem routing bug                                      | ❌ Active data corruption | Fix required — see §2                                  |
| `llms-full.txt` duplicate claims                                    | ⚠️ Upstream data issue    | Fix recommended — see §3                               |

---

## Issue 1 — MCP `/mcp` SSE Endpoint Times Out

### Observed behaviour

```
curl --max-time 8 https://citation.manus.space/mcp
# → 0 bytes received, operation timed out
```

The endpoint connects (TCP handshake succeeds) but returns **zero bytes** before the client times out.

### Root cause (confirmed by code inspection)

**File:** `server/_core/index.ts` lines 691–722

The `/mcp` GET handler opens an SSE stream and immediately writes two events (initialize + tools/list), then sets a 15-second heartbeat. However, **Cloudflare is buffering the SSE response** — it does not flush to the client until the response is closed or the buffer fills. Since the handler never closes the response, Cloudflare holds the bytes indefinitely.

```ts
// Current code — Cloudflare buffers this
res.write(`data: ${JSON.stringify(initEvent)}\n\n`);
res.write(`data: ${JSON.stringify(toolsEvent)}\n\n`);
const heartbeat = setInterval(() => {
  res.write(`: heartbeat\n\n`);
}, 15000);
```

### Fix required

Add `res.flushHeaders()` immediately after setting the SSE headers, **before** the first `res.write()`. This forces Cloudflare to flush the response headers and begin streaming.

```ts
// server/_core/index.ts — GET /mcp handler
app.get("/mcp", (_req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform", // ← add no-transform
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no", // ← add this (disables nginx/CF buffering)
  });
  res.flushHeaders(); // ← ADD THIS — forces Cloudflare to flush immediately

  const initEvent = {
    /* ... existing ... */
  };
  res.write(`data: ${JSON.stringify(initEvent)}\n\n`);
  // ... rest unchanged
});
```

Two header changes are also required:

- `Cache-Control: no-cache, no-transform` — `no-transform` prevents Cloudflare from buffering for compression
- `X-Accel-Buffering: no` — the standard header to disable proxy buffering (respected by Cloudflare, nginx, and most CDNs)

### Verification

```bash
curl -N --max-time 5 https://citation.manus.space/mcp
# Should immediately print:
# data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05",...}}
# data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed",...}
# : heartbeat   (after 15s)
```

---

## Issue 2 — Organism Names Routed to PubChem Instead of NCBI Taxonomy

### Observed behaviour

Claim 300035 (`claim_type: "organism"`, `extracted_value: "Streptococcus zooepidemicus"`):

```json
{
  "verdict": "Insufficient Evidence",
  "verdict_rationale": "Source completeness gate failed: Primary source not found; ... [adapter] Compound 'Streptococcus zooepidemicus' not found in PubChem; [adapter] Manual review recommended"
}
```

`Streptococcus zooepidemicus` is a **bacterium**, not a chemical compound. PubChem is a chemical compound database. This mismatch produces a guaranteed false `Insufficient Evidence` verdict for every organism-type claim.

### Root cause (confirmed by code inspection)

**File:** `server/analysisPipeline.ts` lines 117–120

```ts
const verticalDomain: string =
  ((doc0 as Record<string, unknown>)?.verticalDomain as string) ??
  "structural_biology"; // ← fallback is always structural_biology
const adapter = getVertical(verticalDomain);
```

Claim 300035 has `vertical_domain: null` in the database. The fallback `"structural_biology"` maps to the PDB adapter, which calls `verdictForClaim()`. Inside `verdictForClaim()` (`server/pdbAdapter.ts` line 291), the `organism` claim type requires a `pdbId` to verify against PDB — but this claim has no PDB ID, so it falls through to the generic path which eventually calls the `salmonBiotech` adapter's `lookupPubChem()`.

The `salmonBiotech` adapter **does** have a correct `looksLikeOrganism()` guard (`server/verticalAdapters/salmonBiotech.ts` lines 77–81):

```ts
const ORGANISM_PATTERNS = [
  /^[A-Z][a-z]+ [a-z]+$/, // Latin binomial — matches "Streptococcus zooepidemicus" ✓
  /\b(salmon|trout|...)\b/i,
];
```

But this guard is **never reached** because the claim is routed to `structural_biology` (PDB adapter), not `salmon_biotech`.

### Fix required — two options

**Option A (recommended): Add organism routing in `analysisPipeline.ts`**

In the claim processing loop, before calling `verdictForClaim()`, check `claim.claimType` and `claim.extractedValue`:

```ts
// server/analysisPipeline.ts — inside the batch.map() callback
// After: } else {  // Fall back to PDB adapter for other claim types

} else if (
  claim.claimType === "organism" &&
  claim.extractedValue &&
  !claim.pdbId
) {
  // Organism claim with no PDB ID → route to NCBI Taxonomy
  const { lookupNcbiTaxonomyDirect } = await import("./verticalAdapters/salmonBiotech");
  const evidence = await lookupNcbiTaxonomyDirect(claim.extractedValue);
  // ... build result from evidence
} else {
  // existing PDB fallback
  result = await verdictForClaim({ ... });
}
```

**Option B (simpler): Export `lookupNcbiTaxonomy` from `salmonBiotech.ts` and call it from `pdbAdapter.ts`**

In `server/pdbAdapter.ts`, in the `organism` branch (line 291), when `pdbId` is absent, call NCBI Taxonomy instead of returning `Insufficient Evidence`:

```ts
// server/pdbAdapter.ts line 291 — organism branch
if (claim.claimType === "organism" && claim.pdbId && claim.organism) {
  // existing PDB organism check
} else if (
  claim.claimType === "organism" &&
  claim.extractedValue &&
  !claim.pdbId
) {
  // NEW: organism with no PDB ID → NCBI Taxonomy
  const { lookupNcbiTaxonomyDirect } = await import(
    "./verticalAdapters/salmonBiotech"
  );
  return lookupNcbiTaxonomyDirect(claim.extractedValue);
}
```

**Required export in `salmonBiotech.ts`:**

```ts
// Add this export at the bottom of salmonBiotech.ts
export { lookupNcbiTaxonomy as lookupNcbiTaxonomyDirect };
```

### Impact

This bug affects **all organism-type claims that lack a PDB ID** — which is the majority of organism claims in the registry (bacteria, fungi, plants). Fixing this will convert many false `Insufficient Evidence` verdicts to `Supported` with NCBI Taxonomy citations.

### Verification

```bash
# After fix, re-run the pipeline on document 270005
# Claim 300035 should return:
# verdict: "Supported"
# verdict_rationale: "NCBI Taxonomy ID: 1336 (Streptococcus equi subsp. zooepidemicus)"
# evidence_url: "https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=1336"
```

---

## Issue 3 — Duplicate Claims in Database (Data Quality)

### Observed behaviour

`/llms-full.txt` contains the same claim text repeated up to 19 times:

```
"Genes that were higher expressed after the onset of exogenous feeding (920 dd)..."
→ appears 19 times across 19 different claim IDs
```

### Root cause

The autonomous ingestion pipeline (`server/autonomousIngest.ts`) appears to re-extract claims from the same document on each ingestion run without checking for existing claims with identical text. This creates duplicate rows in the `claims` table.

### Fix required

Add a uniqueness constraint or deduplication check in `server/autonomousIngest.ts` before inserting claims:

```ts
// server/autonomousIngest.ts — before insertClaims()
// Check for existing claims with the same text in the same document
const existingTexts = await getExistingClaimTexts(documentId);
const newClaims = extracted.filter(c => !existingTexts.has(c.claimText.trim()));
if (newClaims.length === 0) {
  log.info({ documentId }, "All claims already exist, skipping insert");
  return;
}
await insertClaims(newClaims);
```

Alternatively, add a database-level unique constraint:

```sql
ALTER TABLE claims ADD UNIQUE INDEX idx_claims_doc_text (document_id, claim_text(255));
```

### Impact

Duplicate claims inflate the registry count, waste verification compute, and degrade the quality of `/llms-full.txt` and `/api/public/claims` responses. The citation-desk frontend now deduplicates on the fly, but the fix should be upstream.

---

## Issue 4 — Verify-Claim POST (No Action Required)

The test report stated this was unconfirmed. It is **working correctly**:

```bash
curl -X POST https://citation.manus.space/api/public/verify-claim \
  -H "Content-Type: application/json" \
  -d '{"claim":"Vitamin C reduces duration of common cold symptoms"}'

# Response:
{
  "ok": true,
  "verdict": "Supported",
  "rationale": "5 peer-reviewed papers support this claim. Top sources: PMID:26462967, PMID:28919117, PMID:33634751.",
  "claimType": "general_molecular",
  "apiVersion": "1.1",
  "evidenceUrl": "https://pubmed.ncbi.nlm.nih.gov/26462967/",
  "x-ratelimit-limit": 30,
  "x-ratelimit-remaining": 29
}
```

The GET `/api/public/verify-claim` returns HTML (the SPA shell) — this is expected. The endpoint only accepts POST.

---

## Priority Order

| Priority | Issue                                      | Effort | Impact                               |
| -------- | ------------------------------------------ | ------ | ------------------------------------ |
| **P1**   | Organism → NCBI Taxonomy routing (Issue 2) | ~2h    | Fixes hundreds of false verdicts     |
| **P2**   | MCP SSE buffering (Issue 1)                | ~30min | Unblocks AI agent integrations       |
| **P3**   | Duplicate claim deduplication (Issue 3)    | ~1h    | Data quality, reduces registry noise |

---

## Files to Edit

| File                                       | Issue                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `server/_core/index.ts`                    | Issue 1 — add `res.flushHeaders()` and `X-Accel-Buffering: no` header to GET `/mcp` handler |
| `server/analysisPipeline.ts`               | Issue 2 — add organism routing branch before PDB fallback                                   |
| `server/verticalAdapters/salmonBiotech.ts` | Issue 2 — export `lookupNcbiTaxonomy`                                                       |
| `server/autonomousIngest.ts`               | Issue 3 — add deduplication before `insertClaims()`                                         |

---

## Contact

Questions about the citation-desk (citation.is) frontend proxy layer:  
→ See `server/externalProxy.ts` in https://github.com/Gudmundur76/citation-desk  
→ The frontend now correctly proxies analytics endpoints to the tRPC procedures
