#!/usr/bin/env python3
"""
fix-unused-errdata.py
─────────────────────────────────────────────────────────────────────────────
Removes `errData` from import statements in files that imported it but
don't actually call it. Also removes unused `log` const declarations.
"""

import re
from pathlib import Path

PROJECT_ROOT = Path("/home/ubuntu/ttruthdesk-platform")

FILES_WITH_UNUSED_ERRDATA = [
    "server/claimQualityScorer.ts",
    "server/embedRoutes.ts",
    "server/jwksKeys.ts",
    "server/manusOrchestrator.ts",
    "server/metaAgent/codeGuardian.ts",
    "server/privateMode.ts",
    "server/verticalAdapters/arxiv.ts",
    "server/verticalAdapters/clinvar.ts",
    "server/verticalAdapters/eur_lex.ts",
    "server/verticalAdapters/europe_pmc.ts",
    "server/verticalAdapters/ietf_rfc.ts",
    "server/verticalAdapters/openfda_labels.ts",
    "server/verticalAdapters/wikidata.ts",
]

# Also check for unused `log` const (one file had this)
FILES_WITH_UNUSED_LOG = [
    "server/embedRoutes.ts",
]

def fix_file(path: Path) -> int:
    content = path.read_text(encoding="utf-8")
    original = content
    fixes = 0

    # Check if errData is actually used (not just imported)
    # Remove the import line from consideration
    content_no_import = re.sub(r'^import[^\n]+\n', '', content, flags=re.MULTILINE)
    errdata_used = 'errData(' in content_no_import

    if not errdata_used:
        # Remove errData from import: `import { logger, errData }` → `import { logger }`
        # Pattern: `import { logger, errData }` or `import { errData, logger }`
        new = re.sub(r',\s*errData\b', '', content)
        new = re.sub(r'\berrData\s*,\s*', '', new)
        if new != content:
            content = new
            fixes += 1

    # Check if log const is actually used
    log_used_count = len(re.findall(r'\blog\.(info|warn|error|debug)\b', content_no_import))
    if log_used_count == 0:
        # Remove the `const log = logger(...);\n` line
        new = re.sub(r'^const log = logger\([^)]+\);\n', '', content, flags=re.MULTILINE)
        # Also remove the blank line that follows if present
        if new != content:
            content = new
            fixes += 1

    if content != original:
        path.write_text(content, encoding="utf-8")
    return fixes

def main():
    total = 0
    all_files = set(FILES_WITH_UNUSED_ERRDATA + FILES_WITH_UNUSED_LOG)
    for rel in sorted(all_files):
        path = PROJECT_ROOT / rel
        if path.exists():
            n = fix_file(path)
            if n:
                print(f"  ✓ {rel} ({n} fixes)")
                total += n
    print(f"\nTotal: {total} fixes")

if __name__ == "__main__":
    main()
