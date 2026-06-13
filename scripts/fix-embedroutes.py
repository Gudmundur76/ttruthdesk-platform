#!/usr/bin/env python3
from pathlib import Path

path = Path("/home/ubuntu/ttruthdesk-platform/server/embedRoutes.ts")
content = path.read_text()

# 1. Restore console.warn inside the client-side embed template literal
content = content.replace(
    "if (!SITE_KEY) { log.warn('[TruthDesk] Missing data-site-key attribute'); return; }",
    "if (!SITE_KEY) { console.warn('[TruthDesk] Missing data-site-key attribute'); return; }"
)

# 2. Remove unused server-side log const
lines = content.split("\n")
lines = [l for l in lines if not l.strip().startswith('const log = logger("embedRoutes")')]

# 3. Remove unused logger import (only if logger is not used elsewhere in server code)
import re
# Check if logger is still used in server-side code (outside template literals)
# Simple check: if 'log.' appears in non-template-literal context
server_log_uses = [l for l in lines if 'log.' in l and 'console' not in l and 'log.warn' not in l]
if not server_log_uses:
    lines = [l for l in lines if 'import { logger }' not in l and 'import { logger, errData }' not in l]

content = "\n".join(lines)
path.write_text(content)
print("Fixed embedRoutes.ts")
print("Remaining log. references:", sum(1 for l in lines if 'log.' in l and 'console' not in l))
