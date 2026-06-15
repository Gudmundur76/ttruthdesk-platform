#!/usr/bin/env node
/**
 * @citation-is/mcp-server
 *
 * MCP server for citation.is — the scientific grounding layer for AI systems.
 * Connects to https://citation.is/mcp and exposes verified scientific claim
 * tools to any MCP-compatible AI agent (Claude Desktop, Cursor, LangChain, etc.)
 *
 * Usage:
 *   npx @citation-is/mcp-server
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "citation-is": {
 *         "command": "npx",
 *         "args": ["-y", "@citation-is/mcp-server"]
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const CITATION_IS_MCP_ENDPOINT = "https://citation.is/mcp";

const server = new Server(
  {
    name: "citation-is",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "search_claims",
    description:
      "Search the citation.is verified scientific claims registry by keyword, topic, organism, protein, or method. Returns matching claims with verdicts (Supported/Contradicted/Ambiguous), confidence scores, evidence sources, and direct report URLs. Use this to ground AI answers in verified scientific literature.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query — e.g. 'BRCA1 BARD1 interaction', 'creatine muscle strength', 'salmon omega-3 bioavailability'",
        },
        vertical: {
          type: "string",
          enum: [
            "structural_biology",
            "salmon_biotech",
            "protein_supplement",
            "creatine_ergogenics",
            "gut_microbiome",
            "collagen_peptides",
            "plant_based_protein",
            "sports_nutrition_rct",
            "uniprot",
            "clinical_trials",
          ],
          description:
            "Optional: restrict search to a specific research domain",
        },
        verdict: {
          type: "string",
          enum: [
            "Supported",
            "Contradicted",
            "Ambiguous",
            "Insufficient Evidence",
            "Out of Scope",
            "Needs Expert Review",
          ],
          description: "Optional: filter by verdict",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of results to return (default 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "verify_claim",
    description:
      "Verify a specific scientific claim against authoritative databases (PubMed, UniProt, PDB, PubChem, PMC Open Access). Returns a structured verdict with confidence score, evidence summary, primary source URL, and rationale. Use this when you need to fact-check a specific scientific statement before including it in an answer.",
    inputSchema: {
      type: "object",
      properties: {
        claim: {
          type: "string",
          description:
            "The scientific claim to verify — e.g. 'BRCA1 forms a heterodimer with BARD1 stabilised by a RING domain interface'",
        },
        vertical: {
          type: "string",
          enum: [
            "structural_biology",
            "salmon_biotech",
            "protein_supplement",
            "creatine_ergogenics",
            "gut_microbiome",
            "collagen_peptides",
            "plant_based_protein",
            "sports_nutrition_rct",
            "uniprot",
            "clinical_trials",
          ],
          description:
            "Optional: restrict verification to a specific research domain",
        },
      },
      required: ["claim"],
    },
  },
  {
    name: "get_claim",
    description:
      "Retrieve a specific verified claim by its ID from the citation.is registry. Returns the full claim record including verdict, confidence score, evidence source, rationale, and all associated metadata.",
    inputSchema: {
      type: "object",
      properties: {
        claim_id: {
          type: "string",
          description: "The unique claim ID from citation.is",
        },
      },
      required: ["claim_id"],
    },
  },
];

// ── List tools handler ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// ── Call tool handler — proxies to citation.is/mcp ───────────────────────────

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params;

  try {
    const response = await fetch(CITATION_IS_MCP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "@citation-is/mcp-server/1.0.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: args,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `citation.is MCP endpoint returned ${response.status}: ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      result?: { content?: unknown };
      error?: { message?: string };
    };

    if (data.error) {
      throw new Error(data.error.message ?? "Unknown error from citation.is");
    }

    return data.result ?? { content: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error calling citation.is: ${message}\n\nFallback: You can query citation.is directly at https://citation.is/mcp`,
        },
      ],
      isError: true,
    };
  }
});

// ── Start server ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    "citation.is MCP server running — connected to https://citation.is/mcp\n"
  );
}

main().catch(error => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});
