/**
 * mcpServerLocal.ts — MCP Tools Using Local Model
 *
 * Provides the same MCP tool interface as mcpServer.ts but routes claim
 * verification through the local distilled model instead of the orchestrated
 * pipeline.
 *
 * PRD_SKILLOPT_AGENT2MODEL §3.3 — MCP local model integration.
 *
 * Tools exposed:
 *   verify_claim_local        — single claim, local model
 *   verify_claims_batch_local — batch verification, local model
 *   model_capabilities        — check local model availability and domains
 *
 * These tools are registered alongside the existing mcpServer.ts tools.
 * The router in verificationRouter.ts decides which tool to invoke.
 */

import { getLocalClaimVerifier } from "./claimVerifier";
import { logger } from "../logger";

const log = logger("inference/mcpServerLocal");

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface McpToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  latencyMs?: number;
}

// ─── Tool: verify_claim_local ─────────────────────────────────────────────────

/**
 * Verify a single claim using the local distilled model.
 *
 * Input:
 *   claimText (string, required) — the claim to verify
 *   domain    (string, optional) — domain hint (structural_biology, clinical, etc.)
 *
 * Output:
 *   LocalVerificationResult — verdict, confidence, rationale, latencyMs, source
 */
export async function toolVerifyClaimLocal(
  params: Record<string, unknown>
): Promise<McpToolResult> {
  const claimText = params.claimText;
  const domain = typeof params.domain === "string" ? params.domain : undefined;

  if (typeof claimText !== "string" || claimText.trim().length === 0) {
    return {
      success: false,
      error: "claimText is required and must be a non-empty string",
    };
  }

  if (claimText.length > 2000) {
    return {
      success: false,
      error: "claimText exceeds maximum length of 2000 characters",
    };
  }

  log.info(`[MCP-Local] verify_claim_local: "${claimText.slice(0, 60)}..."`);

  const verifier = getLocalClaimVerifier();
  const result = await verifier.verify(claimText, domain);

  return {
    success: true,
    data: result,
    latencyMs: result.latencyMs,
  };
}

// ─── Tool: verify_claims_batch_local ─────────────────────────────────────────

/**
 * Verify multiple claims using the local distilled model.
 *
 * Input:
 *   claims (array, required) — array of { claimText, domain? }
 *
 * Output:
 *   Array of LocalVerificationResult
 */
export async function toolVerifyClaimsBatchLocal(
  params: Record<string, unknown>
): Promise<McpToolResult> {
  const claims = params.claims;

  if (!Array.isArray(claims)) {
    return { success: false, error: "claims must be an array" };
  }

  if (claims.length === 0) {
    return { success: true, data: [] };
  }

  if (claims.length > 50) {
    return { success: false, error: "Maximum 50 claims per batch request" };
  }

  // Validate each claim
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i] as Record<string, unknown>;
    if (
      typeof claim.claimText !== "string" ||
      claim.claimText.trim().length === 0
    ) {
      return {
        success: false,
        error: `claims[${i}].claimText is required and must be a non-empty string`,
      };
    }
  }

  log.info(`[MCP-Local] verify_claims_batch_local: ${claims.length} claims`);

  const verifier = getLocalClaimVerifier();
  const startMs = Date.now();

  const results = await Promise.all(
    (claims as Array<{ claimText: string; domain?: string }>).map(c =>
      verifier.verify(c.claimText, c.domain)
    )
  );

  return {
    success: true,
    data: results,
    latencyMs: Date.now() - startMs,
  };
}

// ─── Tool: model_capabilities ─────────────────────────────────────────────────

/**
 * Check local model availability and supported domains.
 *
 * Input: (none)
 *
 * Output:
 *   LocalVerifierCapabilities — domains, available, modelId, modelSizeMb
 */
export async function toolModelCapabilities(
  _params: Record<string, unknown>
): Promise<McpToolResult> {
  const verifier = getLocalClaimVerifier();
  const capabilities = await verifier.getCapabilities();

  return {
    success: true,
    data: capabilities,
  };
}

// ─── Tool Registry ────────────────────────────────────────────────────────────

export const LOCAL_MCP_TOOLS = {
  verify_claim_local: toolVerifyClaimLocal,
  verify_claims_batch_local: toolVerifyClaimsBatchLocal,
  model_capabilities: toolModelCapabilities,
} as const;

export type LocalMcpToolName = keyof typeof LOCAL_MCP_TOOLS;

/**
 * Dispatch a local MCP tool call by name.
 * Returns an error result for unknown tool names.
 */
export async function dispatchLocalMcpTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<McpToolResult> {
  const tool = LOCAL_MCP_TOOLS[toolName as LocalMcpToolName];

  if (!tool) {
    log.warn(`[MCP-Local] Unknown tool: ${toolName}`);
    return {
      success: false,
      error: `Unknown local MCP tool: ${toolName}. Available: ${Object.keys(LOCAL_MCP_TOOLS).join(", ")}`,
    };
  }

  return tool(params);
}
