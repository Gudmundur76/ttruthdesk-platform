#!/usr/bin/env bash
# export_training_corpus.sh
# PRD_SKILLOPT_AGENT2MODEL §6 — scripts/export_training_corpus.sh
#
# Exports verified claims from the ttruthdesk registry database to a JSONL
# corpus file suitable for agent2model training.
#
# The export query selects claims that meet quality criteria:
#   - verdict is not null (has been evaluated)
#   - confidenceScore >= 0.7 (high-confidence verdicts only)
#   - compositeTruthScore >= 0.6 (composite truth signal is strong)
#   - compositeTruthLabel NOT IN (insufficient_evidence, out_of_scope)
#
# Usage:
#   bash scripts/export_training_corpus.sh
#   bash scripts/export_training_corpus.sh --output training/corpus.jsonl --min-confidence 0.8
#
# Environment variables:
#   DATABASE_URL   MySQL connection string (required)
#   OUTPUT_FILE    Output JSONL path (default: training/corpus.jsonl)
#   MIN_CONFIDENCE Minimum confidence score (default: 0.7)
#   MIN_COMPOSITE  Minimum composite truth score (default: 0.6)

set -euo pipefail

# ─── Defaults ─────────────────────────────────────────────────────────────────

OUTPUT_FILE="${OUTPUT_FILE:-training/corpus.jsonl}"
MIN_CONFIDENCE="${MIN_CONFIDENCE:-0.7}"
MIN_COMPOSITE="${MIN_COMPOSITE:-0.6}"

# ─── Argument Parsing ─────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --min-confidence)
      MIN_CONFIDENCE="$2"
      shift 2
      ;;
    --min-composite)
      MIN_COMPOSITE="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--output PATH] [--min-confidence FLOAT] [--min-composite FLOAT]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ─── Validation ───────────────────────────────────────────────────────────────

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL environment variable is required" >&2
  exit 1
fi

# ─── Setup ────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_PATH="${PROJECT_ROOT}/${OUTPUT_FILE}"
OUTPUT_DIR="$(dirname "${OUTPUT_PATH}")"

mkdir -p "${OUTPUT_DIR}"

echo "Exporting training corpus..."
echo "  Output:         ${OUTPUT_PATH}"
echo "  Min confidence: ${MIN_CONFIDENCE}"
echo "  Min composite:  ${MIN_COMPOSITE}"

# ─── Export via Node.js script ────────────────────────────────────────────────
# We use a Node.js inline script to leverage the existing Drizzle DB connection
# rather than calling mysql directly (avoids credential management complexity).

node --input-type=module << EOF
import { createConnection } from "mysql2/promise";
import { createWriteStream } from "fs";

const url = new URL(process.env.DATABASE_URL);
const conn = await createConnection({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: false },
});

const [rows] = await conn.execute(
  \`SELECT
    c.id,
    c.claimText,
    c.verdict,
    c.verdictRationale,
    c.confidenceScore,
    c.confidenceFlags,
    c.verdictMethod,
    c.sourceCompletenessScore,
    c.passageConfidence,
    c.misrepresentationType,
    c.compositeTruthScore,
    c.compositeTruthLabel,
    c.domain,
    c.createdAt,
    c.updatedAt,
    d.sourceUrl AS evidenceUrl
  FROM claims c
  LEFT JOIN documents d ON c.documentId = d.id
  WHERE
    c.verdict IS NOT NULL
    AND c.confidenceScore >= ?
    AND c.compositeTruthScore >= ?
    AND c.compositeTruthLabel NOT IN (
      'insufficient_evidence',
      'out_of_scope'
    )
  ORDER BY c.compositeTruthScore DESC, c.confidenceScore DESC
  LIMIT 10000\`,
  [${MIN_CONFIDENCE}, ${MIN_COMPOSITE}]
);

await conn.end();

const output = createWriteStream("${OUTPUT_PATH}", { encoding: "utf-8" });
let count = 0;
for (const row of rows) {
  output.write(JSON.stringify(row) + "\\n");
  count++;
}
output.end();

console.log(\`Exported \${count} claims to ${OUTPUT_PATH}\`);
EOF

# ─── Stats ────────────────────────────────────────────────────────────────────

if [[ -f "${OUTPUT_PATH}" ]]; then
  LINE_COUNT=$(wc -l < "${OUTPUT_PATH}")
  FILE_SIZE=$(du -sh "${OUTPUT_PATH}" | cut -f1)
  echo ""
  echo "Export complete:"
  echo "  Lines: ${LINE_COUNT}"
  echo "  Size:  ${FILE_SIZE}"
  echo ""

  if [[ "${LINE_COUNT}" -lt 100 ]]; then
    echo "WARNING: Only ${LINE_COUNT} examples exported. Minimum 100 recommended for training." >&2
  fi

  if [[ "${LINE_COUNT}" -lt 5000 ]]; then
    echo "NOTE: PRD target is 5,000+ verified claims. Current: ${LINE_COUNT}."
    echo "      Run more ingest cycles with optimized prompts to grow the corpus."
  fi
else
  echo "ERROR: Output file was not created: ${OUTPUT_PATH}" >&2
  exit 1
fi
