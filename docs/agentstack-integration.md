# AgentStack + citation.is Integration Guide

> **citation.is** is the universal AI grounding layer. This guide shows how to integrate citation.is as a citation source in Python agents built with AgentStack, LangChain, LlamaIndex, and raw OpenAI function calling.

---

## Quick Start — MCP Tool Calling

The fastest integration path is via the citation.is MCP server. Any MCP-compatible agent framework can call `verify_claim` directly.

### MCP endpoint

```
https://ttruthdesk.claims/api/mcp
```

**Protocol:** Streamable HTTP (MCP 2025-03-26 spec)  
**Authentication:** None required for public endpoints  
**Rate limit:** 10 requests/hour per IP per tool (anonymous)

### Available tools

| Tool                  | Description                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `verify_claim`        | Verify a claim against the registry. Returns SPO triple, verdict, confidence, evidence chain, contradictions, and provenance. |
| `search_claims`       | Full-text search across 4,000+ verified claims.                                                                               |
| `get_claim`           | Retrieve a specific claim by ID.                                                                                              |
| `find_similar`        | Find claims semantically similar to a given text.                                                                             |
| `get_provenance`      | Get the full provenance chain for a claim.                                                                                    |
| `verify_claims_batch` | Verify up to 10 claims in a single call.                                                                                      |
| `ask_question`        | Natural language Q&A against the claim registry.                                                                              |

---

## Python — Direct REST API

```python
import requests

def verify_claim(claim_text: str) -> dict:
    """
    Verify a scientific claim against citation.is.
    Returns: { spo, verdict, confidence, evidence, contradictions, provenance }
    """
    resp = requests.post(
        "https://ttruthdesk.claims/api/verify",
        json={
            "claim": claim_text,
            "include_evidence": True,
            "include_contradictions": True,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# Example
result = verify_claim("Lysozyme is an enzyme found in human tears")
print(f"Verdict: {result['verdict']}")
print(f"Confidence: {result['confidence']}")
print(f"SPO: {result['spo']['subject']} | {result['spo']['predicate']} | {result['spo']['object']}")
for ev in result.get("evidence", []):
    print(f"  [{ev['confidence']:.2f}] {ev['title']} — {ev['sourceUrl']}")
```

---

## Python — MCP JSON-RPC

```python
import requests, json

MCP_URL = "https://ttruthdesk.claims/api/mcp"

def mcp_call(tool_name: str, args: dict) -> dict:
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": args},
    }
    resp = requests.post(
        MCP_URL,
        json=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    result = resp.json()
    # MCP returns content as array of text blocks
    content = result.get("result", {}).get("content", [])
    return json.loads(content[0]["text"]) if content else {}


# Verify a claim
result = mcp_call("verify_claim", {
    "claim": "Global mean surface temperature has risen by 1.1°C since pre-industrial times",
    "include_evidence": True,
})
print(json.dumps(result, indent=2))
```

---

## LangChain Tool Integration

```python
from langchain.tools import StructuredTool
from pydantic import BaseModel
import requests

class VerifyClaimInput(BaseModel):
    claim: str
    include_evidence: bool = True

def _verify_claim(claim: str, include_evidence: bool = True) -> str:
    resp = requests.post(
        "https://ttruthdesk.claims/api/verify",
        json={"claim": claim, "include_evidence": include_evidence},
        timeout=30,
    )
    data = resp.json()
    verdict = data.get("verdict", "Unknown")
    confidence = data.get("confidence", 0)
    spo = data.get("spo", {})
    evidence_count = len(data.get("evidence", []))
    return (
        f"Verdict: {verdict} (confidence: {confidence:.2f})\n"
        f"SPO: {spo.get('subject')} | {spo.get('predicate')} | {spo.get('object')}\n"
        f"Evidence items: {evidence_count}\n"
        f"Contradictions: {len(data.get('contradictions', []))}"
    )

citation_tool = StructuredTool.from_function(
    func=_verify_claim,
    name="verify_scientific_claim",
    description=(
        "Verify a scientific claim against the citation.is open registry. "
        "Returns a structured verdict (Supported/Refuted/Inconclusive), "
        "confidence score, subject-predicate-object triple, and evidence chain."
    ),
    args_schema=VerifyClaimInput,
)
```

---

## OpenAI Function Calling

```python
import openai, json, requests

client = openai.OpenAI()

CITATION_TOOL = {
    "type": "function",
    "function": {
        "name": "verify_scientific_claim",
        "description": (
            "Verify a scientific claim against the citation.is open registry. "
            "Returns verdict, confidence, SPO triple, and evidence chain."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "claim": {
                    "type": "string",
                    "description": "The scientific claim to verify",
                },
                "include_evidence": {
                    "type": "boolean",
                    "description": "Whether to include evidence items in the response",
                    "default": True,
                },
            },
            "required": ["claim"],
        },
    },
}

def handle_tool_call(tool_call) -> str:
    args = json.loads(tool_call.function.arguments)
    resp = requests.post(
        "https://ttruthdesk.claims/api/verify",
        json=args,
        timeout=30,
    )
    return json.dumps(resp.json())


# Example agent loop
messages = [
    {"role": "user", "content": "Is it true that lysozyme is found in human tears?"}
]

response = client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=[CITATION_TOOL],
    tool_choice="auto",
)

if response.choices[0].message.tool_calls:
    for tc in response.choices[0].message.tool_calls:
        result = handle_tool_call(tc)
        messages.append(response.choices[0].message)
        messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    final = client.chat.completions.create(model="gpt-4o", messages=messages)
    print(final.choices[0].message.content)
```

---

## Response Schema (verify_claim)

```json
{
  "apiVersion": "1.2",
  "claimId": "clm_abc123",
  "spo": {
    "subject": "lysozyme",
    "predicate": "is found in",
    "object": "human tears"
  },
  "verdict": "Supported",
  "confidence": 0.91,
  "evidence": [
    {
      "pmid": "12345678",
      "title": "Lysozyme in human secretions",
      "abstract": "...",
      "sourceUrl": "https://pubmed.ncbi.nlm.nih.gov/12345678/",
      "confidence": 0.88,
      "confidenceFlags": ["high_keyword_overlap", "peer_reviewed"]
    }
  ],
  "contradictions": [],
  "provenance": {
    "sourceDocumentDoi": "10.1234/example",
    "extractedAt": "2026-06-15T00:00:00Z",
    "verticals": ["pubmed", "uniprot"]
  }
}
```

---

## Links

- **Homepage**: https://citation.is
- **API docs**: https://citation.is/developers
- **MCP manifest**: https://ttruthdesk.claims/.well-known/mcp.json
- **REST API v2**: https://ttruthdesk.claims/api/v2/
- **Claim corpus**: https://citation.is/llms-full.txt
- **License**: CC BY 4.0
