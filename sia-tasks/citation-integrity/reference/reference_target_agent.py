"""
Citation Integrity Assessment — Reference Target Agent

This is the seed agent that SIA's Meta-Agent reads and the Feedback Agent improves.
It implements the citation integrity task defined in data/public/task.md.

The agent reads claims from data/public/claims.jsonl and writes its assessments
to submission.jsonl in the generation directory.

Architecture mirrors the platform's production verdict engine:
  - Claim extraction and normalisation
  - Source passage retrieval
  - Citation state classification
  - Misrepresentation pattern detection
  - Confidence scoring

SIA will improve this harness across generations by:
  1. Refining the classification prompts
  2. Improving passage alignment logic
  3. Enhancing misrepresentation pattern detection
  4. Calibrating confidence scores against ground truth
"""

import json
import os
import sys
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TASK_DIR = Path(__file__).parent.parent
PUBLIC_DIR = TASK_DIR / "data" / "public"
CLAIMS_FILE = PUBLIC_DIR / "claims.jsonl"

CITATION_STATES = ["verified", "contested", "implied", "beyond_evidence"]
MISREPRESENTATION_PATTERNS = [
    "strength_overclaim",
    "scope_overclaim",
    "recency_overclaim",
    "abstract_only",
    "fabrication",
]

# ---------------------------------------------------------------------------
# LLM client — uses the same OpenAI-compatible interface as the platform
# ---------------------------------------------------------------------------

def call_llm(system_prompt: str, user_prompt: str, model: str = "claude-3-5-sonnet-20241022") -> str:
    """Call an LLM via the Anthropic API. SIA will improve the prompts here."""
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        message = client.messages.create(
            model=model,
            max_tokens=1024,
            messages=[{"role": "user", "content": f"{system_prompt}\n\n{user_prompt}"}],
        )
        return message.content[0].text
    except Exception as e:
        print(f"[LLM Error] {e}", file=sys.stderr)
        return ""


# ---------------------------------------------------------------------------
# Citation state classifier
# ---------------------------------------------------------------------------

CLASSIFICATION_SYSTEM_PROMPT = """You are a citation integrity classifier. Your job is to determine whether a scientific claim accurately represents what its cited source actually found.

You must classify the claim into exactly one of four citation states:
- verified: The source directly and accurately supports the claim as stated
- contested: The source exists but the evidence is weaker, more qualified, or narrower than the claim asserts
- implied: No source directly addresses the claim, but adjacent evidence implies it may be true
- beyond_evidence: No source addresses the claim and no adjacent evidence implies it

You must also:
1. Identify the exact passage from the source that supports your classification
2. Assign a confidence score between 0.0 and 1.0
3. Identify the misrepresentation pattern if citation_state is "contested":
   - strength_overclaim: weak association cited as causal effect
   - scope_overclaim: specific population findings cited as universal
   - recency_overclaim: preliminary study cited as replicated consensus
   - abstract_only: abstract cited without reading limitations
   - fabrication: source does not contain the claimed finding at all

Respond with a JSON object only, no other text. Use this exact schema:
{
  "citation_state": "verified|contested|implied|beyond_evidence",
  "confidence": 0.0-1.0,
  "source_passage": "verbatim quote from source or null",
  "source_passage_start": integer_or_null,
  "source_passage_end": integer_or_null,
  "reasoning": "one paragraph explanation",
  "misrepresentation_pattern": "null or one of the five patterns above"
}"""


def classify_claim(claim: dict) -> dict:
    """Classify a single claim's citation state."""
    source_text = claim.get("source_full_text") or claim.get("source_abstract") or ""
    
    user_prompt = f"""Claim: {claim['claim_text']}

Source title: {claim['source_title']}

Source text:
{source_text}

Domain: {claim.get('domain', 'unknown')}

Classify this claim's citation state."""

    raw_response = call_llm(CLASSIFICATION_SYSTEM_PROMPT, user_prompt)
    
    try:
        # Extract JSON from response
        result = json.loads(raw_response)
        
        # Validate and normalise
        if result.get("citation_state") not in CITATION_STATES:
            result["citation_state"] = "beyond_evidence"
        
        if not isinstance(result.get("confidence"), (int, float)):
            result["confidence"] = 0.5
        else:
            result["confidence"] = max(0.0, min(1.0, float(result["confidence"])))
        
        if result["citation_state"] != "contested":
            result["misrepresentation_pattern"] = None
        elif result.get("misrepresentation_pattern") not in MISREPRESENTATION_PATTERNS:
            result["misrepresentation_pattern"] = None
        
        return result
        
    except (json.JSONDecodeError, KeyError) as e:
        print(f"[Parse Error] claim_id={claim.get('claim_id')}: {e}", file=sys.stderr)
        return {
            "citation_state": "beyond_evidence",
            "confidence": 0.0,
            "source_passage": None,
            "source_passage_start": None,
            "source_passage_end": None,
            "reasoning": "Classification failed due to LLM response parse error.",
            "misrepresentation_pattern": None,
        }


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def run(gen_dir: Path) -> None:
    """Process all claims and write submission.jsonl to gen_dir."""
    if not CLAIMS_FILE.exists():
        print(f"[Error] Claims file not found: {CLAIMS_FILE}", file=sys.stderr)
        sys.exit(1)

    submission_path = gen_dir / "submission.jsonl"
    processed = 0
    errors = 0

    with open(CLAIMS_FILE) as f_in, open(submission_path, "w") as f_out:
        for line in f_in:
            line = line.strip()
            if not line:
                continue
            
            try:
                claim = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"[Skip] Invalid JSON line: {e}", file=sys.stderr)
                errors += 1
                continue
            
            print(f"[Processing] claim_id={claim.get('claim_id', '?')}", file=sys.stderr)
            
            result = classify_claim(claim)
            result["claim_id"] = claim.get("claim_id", "unknown")
            
            f_out.write(json.dumps(result) + "\n")
            processed += 1

    print(f"[Done] Processed {processed} claims, {errors} errors. Output: {submission_path}", file=sys.stderr)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Citation Integrity Reference Target Agent")
    parser.add_argument("--gen-dir", type=Path, required=True, help="Generation directory for output")
    args = parser.parse_args()
    
    args.gen_dir.mkdir(parents=True, exist_ok=True)
    run(args.gen_dir)
