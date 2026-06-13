#!/usr/bin/env python3
"""
fix-log-error-args.py
─────────────────────────────────────────────────────────────────────────────
After the console→logger migration, many call sites look like:
  log.warn("msg", error)          ← error is `unknown`, not Record<string,unknown>
  log.error("msg", error)
  log.info("msg", error)

The logger's `data` parameter is `Record<string, unknown> | undefined`.
We need to wrap bare `error` / `err` / `e` variables with `errData()`:
  log.warn("msg", errData(error))
  log.error("msg", errData(error))

This script also handles:
  log.error("msg", error.message)  → log.error("msg", errData(error))
  log.warn("msg", err)             → log.warn("msg", errData(err))
  log.error("[tag]", e)            → log.error("[tag]", errData(e))

Pattern: log.(warn|error|info|debug)(`...`, <bare_error_var>)
where bare_error_var is one of: error, err, e, ex, exception
"""

import re
from pathlib import Path

PROJECT_ROOT = Path("/home/ubuntu/ttruthdesk-platform")
SERVER_DIR = PROJECT_ROOT / "server"

SKIP_PATTERNS = ["_core/", ".test.ts", "logger.ts", "node_modules", "scripts/"]

def should_skip(path: Path) -> bool:
    rel = str(path.relative_to(PROJECT_ROOT))
    return any(p in rel for p in SKIP_PATTERNS)

# Match: log.warn("...", error) or log.error(`...`, err) etc.
# Group 1: log level
# Group 2: the message argument (string literal or template literal)
# Group 3: the bare error variable name
BARE_ERROR_PATTERN = re.compile(
    r'(log\.\w+)\(('
    r'(?:"[^"]*"|\'[^\']*\'|`[^`]*`)'  # string/template literal message
    r'),\s*'
    r'(error|err|e|ex|exception|claimErr|pdfErr|predErr|vecErr|vecErr|e)'
    r'\s*\)',
    re.MULTILINE
)

# Match: log.warn("...", error.message) — .message suffix
DOTMESSAGE_PATTERN = re.compile(
    r'(log\.\w+)\(('
    r'(?:"[^"]*"|\'[^\']*\'|`[^`]*`)'
    r'),\s*'
    r'(error|err|e|ex|exception)\.message'
    r'\s*\)',
    re.MULTILINE
)

# Match: log.error("[tag]", e) where e is a catch variable
# More general: any log call where second arg is a single identifier that looks like an error var
GENERAL_BARE_PATTERN = re.compile(
    r'(log\.\w+)\(([^,\n]+),\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)',
    re.MULTILINE
)

ERROR_VAR_NAMES = {
    "error", "err", "e", "ex", "exception",
    "claimErr", "pdfErr", "predErr", "vecErr", "mapErr",
    "alertErr", "ingestErr", "parseErr", "fetchErr",
    "dbErr", "llmErr", "embedErr", "wikiErr", "cronErr",
}

def fix_file(path: Path) -> tuple[bool, int]:
    content = path.read_text(encoding="utf-8")
    original = content
    count = 0

    # Fix .message suffix pattern first
    def replace_dotmessage(m: re.Match) -> str:
        return f'{m.group(1)}({m.group(2)}, errData({m.group(3)}))'

    new_content, n = DOTMESSAGE_PATTERN.subn(replace_dotmessage, content)
    count += n
    content = new_content

    # Fix bare error variable pattern (known names)
    def replace_bare(m: re.Match) -> str:
        return f'{m.group(1)}({m.group(2)}, errData({m.group(3)}))'

    new_content, n = BARE_ERROR_PATTERN.subn(replace_bare, content)
    count += n
    content = new_content

    # Fix general pattern: log.*(msg, <known_error_var>)
    def replace_general(m: re.Match) -> str:
        var = m.group(3).strip()
        if var in ERROR_VAR_NAMES:
            return f'{m.group(1)}({m.group(2)}, errData({var}))'
        return m.group(0)  # leave unchanged

    new_content, n = GENERAL_BARE_PATTERN.subn(replace_general, content)
    count += n
    content = new_content

    if content != original:
        path.write_text(content, encoding="utf-8")
        return True, count
    return False, 0

def main():
    files = sorted(SERVER_DIR.rglob("*.ts"))
    total_files = 0
    total_count = 0
    for f in files:
        if should_skip(f):
            continue
        modified, count = fix_file(f)
        if modified:
            total_files += 1
            total_count += count
            print(f"  ✓ {f.relative_to(PROJECT_ROOT)} ({count} fixes)")
    print(f"\nFixed {total_count} log call argument issues across {total_files} files")

if __name__ == "__main__":
    main()
