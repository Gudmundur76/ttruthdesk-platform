#!/usr/bin/env python3
"""
migrate-console-to-logger.py  (v2 — handles multi-line imports correctly)
─────────────────────────────────────────────────────────────────────────────
Migrates all console.log/warn/error/debug/info calls in production server
TypeScript files to use the structured logger from server/logger.ts.

Strategy:
1. Scan for the last line that is EITHER:
   - a single-line import statement  (import ... from "...")
   - the closing `} from "..."` of a multi-line import block
2. Insert the logger import on the line AFTER that last import
3. Insert `const log = logger("component");` after a blank line that follows
   the import block
4. Replace console.* calls with log.* equivalents

This script is idempotent — running it twice produces the same result.
"""

import re
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path("/home/ubuntu/ttruthdesk-platform")
SERVER_DIR = PROJECT_ROOT / "server"

SKIP_PATTERNS = [
    "_core/",
    ".test.ts",
    "logger.ts",
    "node_modules",
    "scripts/",
]

def should_skip(path: Path) -> bool:
    rel = str(path.relative_to(PROJECT_ROOT))
    return any(p in rel for p in SKIP_PATTERNS)

def component_name(path: Path) -> str:
    rel = path.relative_to(SERVER_DIR)
    parts = list(rel.parts)
    parts[-1] = parts[-1].replace(".ts", "")
    name = parts[-1]
    if len(parts) > 1:
        name = f"{parts[-2]}/{name}"
    return name

def relative_logger_import(path: Path) -> str:
    rel = path.relative_to(SERVER_DIR)
    depth = len(rel.parts) - 1
    if depth == 0:
        return "./logger"
    return "../" * depth + "logger"

def find_last_import_line(lines: list[str]) -> int:
    """
    Return the 0-based index of the last line that belongs to an import block.
    Handles both:
      import X from "y";            (single-line)
      import {                      (multi-line start)
        A, B
      } from "y";                   (multi-line end — this is the last import line)
    Returns -1 if no imports found.
    """
    last_import_end = -1
    in_multiline = False

    for i, line in enumerate(lines):
        stripped = line.strip()
        if in_multiline:
            # Look for the closing `} from "...";`
            if re.match(r'^}\s+from\s+["\']', stripped) or re.match(r'^}\s+from\s+["\']', stripped):
                last_import_end = i
                in_multiline = False
            # Also handle `} from "...";` with no space
            elif stripped.startswith("}") and "from" in stripped and ('"' in stripped or "'" in stripped):
                last_import_end = i
                in_multiline = False
        else:
            if stripped.startswith("import ") or stripped.startswith("import{"):
                if stripped.endswith(";") or stripped.endswith('";') or stripped.endswith("';"):
                    # Single-line import
                    last_import_end = i
                elif "{" in stripped and "}" not in stripped:
                    # Multi-line import start
                    in_multiline = True
                elif stripped.endswith(",") or stripped.endswith("{"):
                    # Multi-line import start (no closing brace yet)
                    in_multiline = True
                else:
                    last_import_end = i

    return last_import_end

def migrate_file(path: Path) -> tuple[bool, int]:
    content = path.read_text(encoding="utf-8")
    original = content
    count = 0

    if not re.search(r'\bconsole\.(log|warn|error|debug|info)\b', content):
        return False, 0

    comp = component_name(path)
    import_path = relative_logger_import(path)

    lines = content.split("\n")

    # Check if logger is already imported
    already_imported = any(
        ("from \"./logger\"" in l or "from '../logger'" in l or
         "from \"../logger\"" in l or "from '../../logger'" in l or
         "from \"../../logger\"" in l)
        for l in lines
    )

    # Check if log const already declared
    already_declared = any("const log = logger(" in l for l in lines)

    if not already_imported or not already_declared:
        last_import_idx = find_last_import_line(lines)

        if last_import_idx < 0:
            # No imports at all — insert at top
            insert_at = 0
        else:
            insert_at = last_import_idx + 1

        # Build the lines to insert
        to_insert = []
        if not already_imported:
            to_insert.append(f'import {{ logger, errData }} from "{import_path}";')
        if not already_declared:
            to_insert.append(f'const log = logger("{comp}");')
        to_insert.append("")  # blank line separator

        # Insert at the correct position
        lines = lines[:insert_at] + to_insert + lines[insert_at:]
        content = "\n".join(lines)

    # Replace console.* calls
    replacements = [
        (r'\bconsole\.log\b',   'log.info'),
        (r'\bconsole\.info\b',  'log.info'),
        (r'\bconsole\.warn\b',  'log.warn'),
        (r'\bconsole\.error\b', 'log.error'),
        (r'\bconsole\.debug\b', 'log.debug'),
    ]
    for pattern, replacement in replacements:
        new_content, n = re.subn(pattern, replacement, content)
        count += n
        content = new_content

    if content != original:
        path.write_text(content, encoding="utf-8")
        return True, count
    return False, 0

def main():
    files = sorted(SERVER_DIR.rglob("*.ts"))
    total_files = 0
    total_replacements = 0
    skipped = 0

    for f in files:
        if should_skip(f):
            skipped += 1
            continue
        modified, count = migrate_file(f)
        if modified:
            total_files += 1
            total_replacements += count
            print(f"  ✓ {f.relative_to(PROJECT_ROOT)} ({count} replacements)")

    print(f"\nMigrated {total_replacements} console calls across {total_files} files")
    print(f"Skipped {skipped} files (tests, _core, logger itself)")

if __name__ == "__main__":
    main()
