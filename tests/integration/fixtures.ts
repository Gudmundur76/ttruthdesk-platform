/**
 * tests/integration/fixtures.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared test data for Phase 116 integration tests.
 *
 * All fixtures are static strings — no DB reads, no network calls.
 * They represent realistic inputs that exercise the real pipeline without
 * requiring specific DB state (the pipeline degrades gracefully to
 * "insufficient_evidence" when the DB is empty).
 */

/** A well-formed scientific claim containing a PDB DOI-style identifier */
export const CLAIM_PDB =
  "PDB entry 1ABC reports a resolution of 2.1 Å for human lysozyme";

/** A claim with an embedded DOI for OpenCitations enrichment path */
export const CLAIM_WITH_DOI =
  "According to 10.1093/nar/gkac1052, the PDB holds over 200,000 structures";

/** Prefixed with __mock__ so the test server returns pre-canned SSE events
 *  immediately without making real LLM/PubMed calls. NODE_ENV=test only. */
export const CLAIM_MOCK = "__mock__PDB entry 1ABC resolution claim";

/** A broad scientific question that exercises the question-to-claim path */
export const QUESTION_VALID = "What is the resolution of PDB entry 1HHO?";

/** A question that is exactly 1000 characters (boundary condition) */
export const QUESTION_MAX_LENGTH = "A".repeat(1000);

/** A question that is 1001 characters (over the limit) */
export const QUESTION_OVER_LIMIT = "A".repeat(1001);

/** A claim ID (positive integer) that is guaranteed not to exist in the DB */
export const CLAIM_ID_NONEXISTENT = 999999;

/** A sourceId that maps to a known registered source */
export const SOURCE_ID_KNOWN = "pubmed";

/** A sourceId that does not exist */
export const SOURCE_ID_UNKNOWN = "nonexistent_source_xyz";

/** The JSON-RPC 2.0 request ID used in all MCP calls */
export const RPC_ID = 1;

/** MCP tool names */
export const MCP_TOOLS = {
  VERIFY_CLAIM: "verify_claim",
  SEARCH_CLAIMS: "search_claims",
  GET_CLAIM: "get_claim",
  GET_SOURCE_VERSION: "get_source_version",
  ASK_QUESTION: "ask_question",
  VERIFY_CLAIM_AT_DATE: "verify_claim_at_date",
  VERIFY_CLAIMS_BATCH: "verify_claims_batch",
  SUBMIT_CLAIM: "submit_claim",
  FLAG_STALE: "flag_stale",
  REPORT_CONTRADICTION: "report_contradiction",
  GET_PROVENANCE: "get_provenance",
  FIND_SIMILAR: "find_similar",
} as const;

/** Expected JSON-RPC error codes */
export const MCP_ERROR_CODES = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  NOT_FOUND: -32001,
  RATE_LIMITED: -32002,
} as const;

/** Expected SSE event types from the streaming endpoint */
export const SSE_EVENT_TYPES = [
  "stage:extraction",
  "stage:evidence",
  "stage:verdict",
  "final",
] as const;
