# MCP Server Listings — citation.is

Sprint 20 File 4 action item: list the citation.is MCP server on public registries.

---

## 1. mcpservers.org

**URL:** https://mcpservers.org/submit  
**Status:** Ready to submit (free tier)

| Field             | Value                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server Name       | citation.is                                                                                                                                                                                                  |
| Short Description | Verify scientific claims, search 4,000+ verified verdicts, and ground AI responses with traceable evidence chains. Covers medicine, climate, economics, law, and structural biology via 30+ domain adapters. |
| Link              | https://ttruthdesk.claims/.well-known/mcp.json                                                                                                                                                               |
| Category          | Research                                                                                                                                                                                                     |
| Contact Email     | (use team email)                                                                                                                                                                                             |

**Action required:** Submit the form at https://mcpservers.org/submit using the values above.

---

## 2. punkpeye/awesome-mcp-servers (GitHub)

**URL:** https://github.com/punkpeye/awesome-mcp-servers  
**Status:** PR submitted (see PR branch `add-citation-is-mcp-server`)

Entry to add under **Research** section:

```markdown
- [citation.is](https://ttruthdesk.claims/.well-known/mcp.json) - Verify scientific claims and ground AI responses with traceable evidence. 4,000+ verified verdicts across medicine, climate, economics, law, and structural biology. 12 MCP tools including `verify_claim`, `search_claims`, and `get_provenance`.
```

---

## 3. glama.ai/mcp/servers

**URL:** https://glama.ai/mcp/servers  
**Status:** Ready to submit

Glama auto-discovers MCP servers from `/.well-known/mcp.json`. The manifest at
`https://ttruthdesk.claims/.well-known/mcp.json` is already compliant with the
MCP 2025-03-26 spec and includes all required fields.

**Action required:** Submit URL `https://ttruthdesk.claims` at https://glama.ai/mcp/servers/submit

---

## 4. mcp.so

**URL:** https://mcp.so  
**Status:** Ready to submit

| Field       | Value                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------- |
| Name        | citation.is MCP Server                                                                    |
| Description | Scientific claim verification and evidence grounding for AI agents. REST + MCP transport. |
| Endpoint    | https://ttruthdesk.claims/api/mcp                                                         |
| GitHub      | https://github.com/Gudmundur76/ttruthdesk-platform                                        |

---

## Notes

- The MCP server uses **Streamable HTTP transport** (MCP 2025-03-26 spec)
- Anonymous access: 10 req/hr per IP per tool (no API key required)
- Bearer token: unlimited (obtainable at https://ttruthdesk.claims/developers)
- All 12 tools return structured JSON — no markdown blobs
- `/.well-known/mcp.json` is the canonical discovery endpoint
