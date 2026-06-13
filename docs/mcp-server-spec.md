# citation.is MCP Server — Specification

> *This document defines the MCP (Model Context Protocol) server that exposes citation.is capabilities to AI agents. It is the technical realisation of the philosophy in PHILOSOPHY.md.*

---

## Purpose

The MCP server is the primary interface between AI agents and the citation.is truth infrastructure. It transforms the backend's claim verification, search, and evidence retrieval capabilities into structured tools that any MCP-compatible agent can call during generation — not after.

---

## Tools

### `verify_claim`

Submit a natural language claim and receive a structured verdict with evidence.

```typescript
// Input
{
  claim: string;           // The claim to verify (max 1000 chars)
  domain?: string;         // Optional domain hint: "biotech", "climate", "law", etc.
  confidence_threshold?: number; // Minimum confidence to return (default: 0.0)
}

// Output
{
  verdict: "supported" | "refuted" | "inconclusive" | "needs_context" | "superseded";
  confidence: number;      // 0.0 – 1.0
  summary: string;         // One-sentence explanation
  evidence: Array<{
    sourceId: string;      // DOI, PubMed ID, UniProt accession, etc.
    sourceUrl: string;
    excerpt: string | null;
    confidenceScore: number;
    database: string;      // "pubmed", "uniprot", "opencitations", etc.
  }>;
  claimId: string;         // Stable ID for this claim in the registry
  processedAt: string;     // ISO 8601 timestamp
  loopTriggered: boolean;  // true if autonomous loop was triggered for more evidence
}
```

**Design rationale:** The verdict is a truth value, not a summary. The evidence array provides traceable provenance. `loopTriggered` tells the agent whether to expect an updated verdict later.

---

### `search_claims`

Full-text search over the verified claim registry with structured filters.

```typescript
// Input
{
  query: string;           // Full-text search query
  verdict?: "supported" | "refuted" | "inconclusive" | "needs_context" | "superseded";
  domain?: string;
  after?: string;          // ISO 8601 date — claims processed after this date
  before?: string;         // ISO 8601 date
  min_confidence?: number; // Filter by minimum confidence score
  limit?: number;          // Default 10, max 50
  offset?: number;
}

// Output
{
  total: number;
  claims: Array<{
    claimId: string;
    claimText: string;
    verdict: string;
    confidence: number;
    domain: string | null;
    processedAt: string;
    evidenceCount: number;
    primarySourceId: string | null;
  }>;
}
```

**Design rationale:** Enables meta-analysis. An agent can ask "find all refuted claims about salmon biotech post-2020" and receive structured results for further reasoning.

---

### `get_claim`

Retrieve the full record for a specific claim by ID.

```typescript
// Input
{ claimId: string; }

// Output — full claim record with all evidence
```

---

### `get_source_version`

Check whether a source has been updated or retracted since a claim was verified.

```typescript
// Input
{
  sourceId: string;        // DOI, PubMed ID, etc.
}

// Output
{
  sourceId: string;
  currentVersionHash: string;
  lastChecked: string;
  changeType: "none" | "minor" | "major" | "retraction" | null;
  affectedClaimCount: number;
  versionLabel: string | null;
}
```

**Design rationale:** Closes the temporal gap. An agent can check whether a source it is about to cite has been retracted or corrected since the claim was last verified.

---

### `ask_question`

Submit a natural language question. The system derives a verifiable claim, runs it through the pipeline, and returns a structured answer.

```typescript
// Input
{
  question: string;        // Max 1000 chars
  origin?: string;         // Caller's origin for rate limiting
}

// Output
{
  question: string;
  derivedClaim: string;
  verdict: string;
  confidence: number;
  rationale: string;
  sources: Array<{ id: string; url: string; title: string | null; }>;
  loopTriggered: boolean;
}
```

**Design rationale:** Bridges natural language to structured verification. An agent does not need to reformulate its question as a claim — the system does it.

---

## Rate Limits

| Caller type | Limit |
|---|---|
| Anonymous (IP-based) | 10 requests/hour per tool |
| API key holder | Unlimited |
| MCP registered agent | Unlimited (with valid token) |

---

## Error Codes

All errors follow the MCP standard error shape:

```typescript
{
  code: number;    // MCP error code
  message: string; // Human-readable
  data?: {
    field?: string;
    reason?: string;
  };
}
```

| Code | Meaning |
|---|---|
| -32600 | Invalid request |
| -32602 | Invalid params (e.g. claim too long) |
| -32603 | Internal error (pipeline failure) |
| -32000 | Rate limit exceeded |
| -32001 | Claim not found |

---

## Implementation Status

| Tool | Backend procedure | Status |
|---|---|---|
| `verify_claim` | `trpc.claims.verify` | ✅ Implemented (Phase 108) |
| `search_claims` | `trpc.claims.search` | ✅ Implemented |
| `get_claim` | `trpc.claims.get` | ✅ Implemented |
| `get_source_version` | `trpc.sources.getVersion` | ✅ Implemented (Phase 109) |
| `ask_question` | `POST /api/public/answer` | ✅ Implemented (Phase 110) |
| MCP server wrapper | `server/mcpServer.ts` | 🔲 Phase 112 |

---

## Phase 112 Scope

Build `server/mcpServer.ts` — a FastMCP-compatible server that:

1. Wraps each tool above as an MCP `Tool` with full JSON Schema input validation
2. Authenticates via Bearer token (maps to `api_keys` table)
3. Enforces rate limits via the existing in-memory rate limiter
4. Registers at `GET /api/mcp` (capabilities) and `POST /api/mcp` (tool calls)
5. Returns structured MCP responses with proper error codes
6. Is testable via `manus-mcp-cli` from the sandbox

This is the layer that makes citation.is usable by Claude, GPT, Gemini, and any other MCP-compatible agent without any custom integration work.
