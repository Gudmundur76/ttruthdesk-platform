# @citation-is/mcp-server

**The scientific grounding layer for AI systems.**

`citation.is` provides verified scientific claim lookup and real-time verification from PubMed, UniProt, PubChem, PDB, and PMC Open Access. This package exposes those capabilities as an MCP (Model Context Protocol) server, making citation.is instantly usable by Claude Desktop, Cursor, LangChain, LlamaIndex, and any MCP-compatible AI agent.

## Quick Start

### Claude Desktop (one-line setup)

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "citation-is": {
      "command": "npx",
      "args": ["-y", "@citation-is/mcp-server"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "citation-is": {
      "command": "npx",
      "args": ["-y", "@citation-is/mcp-server"]
    }
  }
}
```

### HTTP (direct MCP endpoint)

```
POST https://citation.is/mcp
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_claims",
    "arguments": { "query": "BRCA1 BARD1 interaction" }
  }
}
```

### Python (LangChain)

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

async with MultiServerMCPClient({
    "citation_is": {
        "url": "https://citation.is/mcp",
        "transport": "streamable_http"
    }
}) as client:
    tools = client.get_tools()
    result = await tools[0].ainvoke({"query": "creatine muscle strength"})
```

### TypeScript (LlamaIndex)

```typescript
import { MCPToolSpec } from "llamaindex";

const citationTools = new MCPToolSpec({
  serverUrl: "https://citation.is/mcp",
});
const tools = await citationTools.toToolList();
```

## Available Tools

| Tool            | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| `search_claims` | Search verified claims by keyword, topic, or domain                |
| `verify_claim`  | Verify a specific scientific claim against authoritative databases |
| `get_claim`     | Retrieve a specific claim by ID                                    |

## Authentication

No authentication required for read tools (`search_claims`, `verify_claim`, `get_claim`). Write tools require a Bearer token — see [citation.is/developers](https://citation.is/developers).

## License

Data: CC BY 4.0. Package: MIT.

## Links

- [citation.is](https://citation.is)
- [Developer documentation](https://citation.is/developers)
- [MCP tool card](https://citation.is/.well-known/mcp.json)
- [AI instructions](https://citation.is/llms.txt)
