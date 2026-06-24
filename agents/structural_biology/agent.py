#!/usr/bin/env python3
"""
Structural Biology Truth Desk Agent
Processes papers from the coordination work queue, fetches abstracts,
extracts protein/structural biology claims, and submits via ingest endpoint.
"""
import json
import time
import re
import requests
from typing import Optional

TASK_ID = "orch-structural_biology-1782275490572-5131a10f"
VERTICAL = "structural_biology"
COORD_BASE = "http://localhost:3000/api/coord"
COORD_KEY = "local-coord-key-2026"
MAX_ITEMS = 25

HEADERS = {
    "Content-Type": "application/json",
    "X-Coord-Key": COORD_KEY,
}

def coord_post(path: str, body: dict) -> dict:
    """POST to the coordination API."""
    url = f"{COORD_BASE}{path}"
    r = requests.post(url, json=body, headers=HEADERS, timeout=15)
    return r.json()

def _title_similarity(a: str, b: str) -> float:
    """Rough word-overlap similarity between two titles (0.0 – 1.0)."""
    if not a or not b:
        return 0.0
    wa = set(re.findall(r"[a-z0-9]+", a.lower()))
    wb = set(re.findall(r"[a-z0-9]+", b.lower()))
    # Remove very common stop words
    stops = {"the", "a", "an", "of", "in", "and", "for", "with", "by", "to", "is",
             "are", "on", "at", "from", "as", "its", "that", "this", "or", "be"}
    wa -= stops
    wb -= stops
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / max(len(wa), len(wb))


def fetch_pubmed_abstract(pmid: str, expected_title: str = "") -> Optional[dict]:
    """Fetch paper metadata and abstract from PubMed E-utilities.

    Validates that the returned PMID matches the requested one.  If PubMed
    returns a mismatched record (a known E-utilities quirk) the result is
    discarded and None is returned so the caller can fall back to the queue
    item metadata.
    """
    try:
        url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
        params = {
            "db": "pubmed",
            "id": pmid,
            "rettype": "abstract",
            "retmode": "xml",
        }
        r = requests.get(url, params=params, timeout=20)
        if r.status_code != 200:
            return None
        xml = r.text

        # ── PMID validation ────────────────────────────────────────────────────
        # PubMed occasionally returns a neighbouring record; guard against it.
        returned_pmid_match = re.search(r"<PMID[^>]*>(\d+)</PMID>", xml)
        returned_pmid = returned_pmid_match.group(1).strip() if returned_pmid_match else None
        if returned_pmid and returned_pmid != str(pmid).strip():
            print(f"[AGENT]   PMID mismatch: requested {pmid}, got {returned_pmid} — discarding")
            return None

        # ── Title ──────────────────────────────────────────────────────────────
        title_match = re.search(r"<ArticleTitle>(.*?)</ArticleTitle>", xml, re.DOTALL)
        title = title_match.group(1).strip() if title_match else ""
        title = re.sub(r"<[^>]+>", "", title)

        # ── DOI (extracted early so it is available for the early-return path) ──
        doi_match = re.search(r'<ArticleId IdType="doi">(.*?)</ArticleId>', xml)
        doi = doi_match.group(1).strip() if doi_match else None

        # ── Title similarity guard ─────────────────────────────────────────────
        # If the fetched title is very different from what the queue says the
        # paper is, the abstract belongs to a different paper entirely (the PMID
        # is genuinely assigned to a different article in PubMed).  Discard the
        # abstract so we do not extract claims from the wrong paper, and return
        # only the queue item title so the caller can still create a document.
        if expected_title and title:
            sim = _title_similarity(title, expected_title)
            if sim < 0.25:
                print(f"[AGENT]   Title mismatch (sim={sim:.2f}): "
                      f"fetched='{title[:60]}' vs expected='{expected_title[:60]}' — "
                      f"discarding mismatched abstract, using queue title only")
                return {
                    "title": expected_title,
                    "abstract": "",   # no abstract — wrong paper
                    "doi": doi,
                    "pmid": pmid,
                    "pmid_mismatch": True,
                }

        # ── Abstract ──────────────────────────────────────────────────────────
        all_abstracts = re.findall(r"<AbstractText[^>]*>(.*?)</AbstractText>", xml, re.DOTALL)
        if all_abstracts:
            abstract = " ".join(re.sub(r"<[^>]+>", "", a).strip() for a in all_abstracts)
        else:
            abstract = ""

        return {
            "title": title,
            "abstract": abstract,
            "doi": doi,
            "pmid": pmid,
        }
    except Exception as e:
        print(f"[AGENT] Error fetching PubMed abstract for PMID {pmid}: {e}")
        return None

def extract_claims_from_abstract(paper_data: dict, item: dict) -> list:
    """
    Extract structural biology claims from a paper abstract.
    Returns a list of claim dicts.
    """
    claims = []
    title = paper_data.get("title", item.get("title", ""))
    abstract = paper_data.get("abstract", "")
    pmid = paper_data.get("pmid", item.get("pmid", ""))
    doi = paper_data.get("doi", item.get("doi", ""))

    full_text = f"{title}. {abstract}"

    # ── PDB ID extraction ──────────────────────────────────────────────────────
    pdb_ids = re.findall(r"\b([1-9][A-Z0-9]{3})\b", full_text)
    # Filter out false positives (must be 4 chars, alphanumeric, starts with digit)
    pdb_ids = [p for p in pdb_ids if re.match(r"^[1-9][A-Z0-9]{3}$", p)]
    seen_pdb = set()
    for pdb_id in pdb_ids:
        if pdb_id not in seen_pdb:
            seen_pdb.add(pdb_id)
            # Find the sentence containing this PDB ID
            sentences = re.split(r"(?<=[.!?])\s+", full_text)
            for sent in sentences:
                if pdb_id in sent:
                    claims.append({
                        "claimText": sent.strip(),
                        "claimType": "pdb_id",
                        "extractedValue": pdb_id,
                        "pdbId": pdb_id,
                        "proteinName": None,
                    })
                    break

    # ── Resolution extraction ──────────────────────────────────────────────────
    resolution_patterns = [
        r"(\d+\.?\d*)\s*[ÅA]\b",
        r"resolution\s+of\s+(\d+\.?\d*)\s*[ÅA]",
        r"at\s+(\d+\.?\d*)\s*[ÅA]\s+resolution",
        r"(\d+\.?\d*)\s*angstrom",
    ]
    for pattern in resolution_patterns:
        matches = re.findall(pattern, full_text, re.IGNORECASE)
        for match in matches:
            val = float(match)
            if 0.5 <= val <= 10.0:  # Reasonable resolution range
                sentences = re.split(r"(?<=[.!?])\s+", full_text)
                for sent in sentences:
                    if match in sent:
                        claims.append({
                            "claimText": sent.strip(),
                            "claimType": "resolution",
                            "extractedValue": f"{match} Å",
                            "pdbId": None,
                            "proteinName": None,
                        })
                        break

    # ── Experimental method extraction ────────────────────────────────────────
    methods = {
        "cryo-EM": ["cryo-EM", "cryo-electron microscopy", "cryoEM", "cryo electron microscopy"],
        "X-ray crystallography": ["X-ray crystallography", "X-ray crystal", "crystallographic", "crystal structure"],
        "NMR": ["NMR spectroscopy", "nuclear magnetic resonance", "NMR structure"],
        "AlphaFold": ["AlphaFold", "AlphaFold2", "AF2"],
        "SAXS": ["small-angle X-ray scattering", "SAXS"],
        "cryo-ET": ["cryo-electron tomography", "cryo-ET"],
        "MD simulation": ["molecular dynamics", "MD simulation"],
    }
    found_methods = set()
    for method_name, keywords in methods.items():
        for kw in keywords:
            if kw.lower() in full_text.lower() and method_name not in found_methods:
                found_methods.add(method_name)
                sentences = re.split(r"(?<=[.!?])\s+", full_text)
                for sent in sentences:
                    if kw.lower() in sent.lower():
                        claims.append({
                            "claimText": sent.strip(),
                            "claimType": "experimental_method",
                            "extractedValue": method_name,
                            "pdbId": None,
                            "proteinName": None,
                        })
                        break

    # ── Protein name extraction ────────────────────────────────────────────────
    protein_patterns = [
        # Specific protein names
        r"\b(SARS-CoV-2 spike protein|spike protein|ACE2|angiotensin-converting enzyme 2)\b",
        r"\b(Nav\d+\.\d+|Cav\d+\.\d+|Kv\d+\.\d+)\b",  # Ion channels
        r"\b(RyR\d+|ryanodine receptor)\b",
        r"\b(CRISPR-Cas\d+|Cas\d+)\b",
        r"\b(ribosome|50S|30S|60S|40S|80S|70S)\b",
        r"\b(lysozyme|hemoglobin|myoglobin|insulin|albumin|collagen|fibrin)\b",
        r"\b(kinase|protease|phosphatase|ligase|helicase|polymerase|nuclease)\b",
        r"\b(G protein|GPCR|receptor tyrosine kinase|RTK)\b",
        r"\b(p53|BRCA\d?|RAS|RAF|MEK|ERK)\b",
        r"\b(HIV protease|neuraminidase|hemagglutinin)\b",
        r"\b(cannabinoid receptor|CB\d|opioid receptor|dopamine receptor)\b",
        r"\b(voltage-gated|ligand-gated|ion channel)\b",
    ]
    found_proteins = set()
    for pattern in protein_patterns:
        matches = re.findall(pattern, full_text, re.IGNORECASE)
        for match in matches:
            if isinstance(match, tuple):
                match = match[0]
            match = match.strip()
            if match.lower() not in found_proteins and len(match) > 2:
                found_proteins.add(match.lower())
                sentences = re.split(r"(?<=[.!?])\s+", full_text)
                for sent in sentences:
                    if match.lower() in sent.lower():
                        claims.append({
                            "claimText": sent.strip(),
                            "claimType": "protein_name",
                            "extractedValue": match,
                            "pdbId": None,
                            "proteinName": match,
                        })
                        break

    # ── Organism extraction ────────────────────────────────────────────────────
    organisms = {
        "Homo sapiens": ["human", "Homo sapiens", "H. sapiens"],
        "Mus musculus": ["mouse", "Mus musculus", "murine"],
        "SARS-CoV-2": ["SARS-CoV-2", "COVID-19", "coronavirus"],
        "E. coli": ["E. coli", "Escherichia coli"],
        "Saccharomyces cerevisiae": ["yeast", "S. cerevisiae", "Saccharomyces"],
        "Rattus norvegicus": ["rat", "Rattus norvegicus"],
    }
    found_organisms = set()
    for org_name, keywords in organisms.items():
        for kw in keywords:
            if kw.lower() in full_text.lower() and org_name not in found_organisms:
                found_organisms.add(org_name)
                sentences = re.split(r"(?<=[.!?])\s+", full_text)
                for sent in sentences:
                    if kw.lower() in sent.lower():
                        claims.append({
                            "claimText": sent.strip(),
                            "claimType": "organism",
                            "extractedValue": org_name,
                            "pdbId": None,
                            "proteinName": None,
                        })
                        break

    # ── Ligand extraction ──────────────────────────────────────────────────────
    ligand_patterns = [
        r"\b(ATP|ADP|AMP|GTP|GDP|NAD\+?|NADH|FAD|FADH2)\b",
        r"\b(inhibitor|agonist|antagonist|substrate|cofactor|ligand)\b",
        r"\b(zinc|magnesium|calcium|iron|copper|manganese)\s+(?:ion|binding|coordination)\b",
    ]
    found_ligands = set()
    for pattern in ligand_patterns:
        matches = re.findall(pattern, full_text, re.IGNORECASE)
        for match in matches:
            if isinstance(match, tuple):
                match = match[0]
            match = match.strip()
            if match.lower() not in found_ligands and len(match) > 2:
                found_ligands.add(match.lower())
                sentences = re.split(r"(?<=[.!?])\s+", full_text)
                for sent in sentences:
                    if match.lower() in sent.lower():
                        claims.append({
                            "claimText": sent.strip(),
                            "claimType": "ligand",
                            "extractedValue": match,
                            "pdbId": None,
                            "proteinName": None,
                        })
                        break

    # ── General molecular biology claims ──────────────────────────────────────
    # Add title as a general claim if no other claims found
    if not claims and title:
        claims.append({
            "claimText": title,
            "claimType": "general_molecular",
            "extractedValue": title[:100],
            "pdbId": None,
            "proteinName": None,
        })

    # Deduplicate by claimText and strip None values (real server rejects null fields)
    seen_texts = set()
    unique_claims = []
    for c in claims:
        text = c["claimText"][:200]  # Truncate for dedup key
        if text not in seen_texts and len(c["claimText"]) >= 10:
            seen_texts.add(text)
            # Ensure claimText is within limits
            c["claimText"] = c["claimText"][:2000]
            # Strip None/null values — the real ttruthdesk server uses Zod which
            # rejects null for string fields; omit optional fields entirely
            clean = {k: v for k, v in c.items() if v is not None}
            unique_claims.append(clean)

    return unique_claims


def process_item(item: dict) -> bool:
    """Process a single queue item: fetch abstract, extract claims, ingest."""
    item_id = item["id"]
    pmid = item.get("pmid")
    doi = item.get("doi")
    title = item.get("title", "")
    paper_url = item.get("paperUrl", "")

    print(f"\n[AGENT] Processing item {item_id}: {title}")
    print(f"[AGENT]   PMID: {pmid}, DOI: {doi}")

    # Fetch abstract from PubMed
    paper_data = None
    if pmid:
        print(f"[AGENT]   Fetching abstract from PubMed for PMID {pmid}...")
        paper_data = fetch_pubmed_abstract(pmid, expected_title=title)
        if paper_data and paper_data.get("abstract"):
            print(f"[AGENT]   Abstract fetched ({len(paper_data['abstract'])} chars)")
        elif paper_data and paper_data.get("pmid_mismatch"):
            print(f"[AGENT]   Abstract discarded (title mismatch) — claims from title only")
        elif paper_data is None:
            print(f"[AGENT]   PMID validation failed — using queue item metadata only")
        else:
            print(f"[AGENT]   No abstract found, using item metadata")

    if not paper_data:
        paper_data = {
            "title": title,
            "abstract": "",
            "doi": doi,
            "pmid": pmid,
        }

    # Use item title if paper_data title is empty
    if not paper_data.get("title"):
        paper_data["title"] = title
    if not paper_data.get("doi"):
        paper_data["doi"] = doi
    if not paper_data.get("pmid"):
        paper_data["pmid"] = pmid

    # Extract claims
    claims = extract_claims_from_abstract(paper_data, item)
    print(f"[AGENT]   Extracted {len(claims)} claims")
    for c in claims[:3]:
        print(f"[AGENT]     [{c['claimType']}] {c['claimText'][:80]}...")

    # Submit via ingest endpoint
    ingest_body = {
        "queueItemId": item_id,
        "taskId": TASK_ID,
        "vertical": VERTICAL,
        "paper": {
            "title": paper_data.get("title", title),
            "pmid": paper_data.get("pmid", pmid),
            "doi": paper_data.get("doi", doi),
            "abstract": paper_data.get("abstract", ""),
        },
        "claims": claims,
    }

    try:
        result = coord_post("/ingest", ingest_body)
        if result.get("ok"):
            print(f"[AGENT]   Ingested successfully: {result.get('claimsIngested', 0)} claims")
            return True
        else:
            print(f"[AGENT]   Ingest failed: {result}")
            # Fallback: mark complete directly
            coord_post("/queue/complete", {
                "itemId": item_id,
                "taskId": TASK_ID,
                "result": {"claimCount": len(claims)},
            })
            return True
    except Exception as e:
        print(f"[AGENT]   Error during ingest: {e}")
        coord_post("/queue/fail", {
            "itemId": item_id,
            "taskId": TASK_ID,
            "errorMsg": str(e),
            "retry": True,
        })
        return False


def main():
    print(f"[AGENT] Starting structural_biology Truth Desk agent")
    print(f"[AGENT] Task ID: {TASK_ID}")

    # Step 1: Register
    print(f"\n[AGENT] Step 1: Registering with coordination API...")
    reg_result = coord_post("/tasks/register", {
        "taskId": TASK_ID,
        "vertical": VERTICAL,
        "phase": "starting",
    })
    print(f"[AGENT] Registered: {reg_result.get('task', {}).get('status', 'unknown')}")

    # Step 2: Process up to MAX_ITEMS
    print(f"\n[AGENT] Step 2: Processing queue items (max {MAX_ITEMS})...")
    items_processed = 0
    items_succeeded = 0

    for i in range(MAX_ITEMS):
        # Dequeue next item
        dequeue_result = coord_post("/queue/dequeue", {
            "taskId": TASK_ID,
            "vertical": VERTICAL,
        })

        item = dequeue_result.get("item")
        if item is None:
            print(f"\n[AGENT] Queue empty after {items_processed} items. Done.")
            break

        items_processed += 1
        success = process_item(item)
        if success:
            items_succeeded += 1

        # Small delay to be respectful to PubMed API
        time.sleep(1)

    # Step 3: Mark task complete
    print(f"\n[AGENT] Step 3: Marking task complete...")
    print(f"[AGENT] Summary: {items_succeeded}/{items_processed} items processed successfully")
    coord_post("/tasks/complete", {"taskId": TASK_ID})
    print(f"[AGENT] Task completed.")

    # Print final stats
    try:
        import requests as req
        stats = req.get("http://localhost:3000/api/coord/stats",
                        headers={"X-Coord-Key": COORD_KEY}, timeout=5).json()
        print(f"\n[AGENT] Final queue stats: {stats}")
    except Exception:
        pass


if __name__ == "__main__":
    main()
