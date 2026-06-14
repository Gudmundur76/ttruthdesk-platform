-- Sprint 6 data-quality migration
-- Strips leaked prompt engineering instructions from claim verdict rationales.
--
-- Patterns stripped:
--   [Audit note: ...] — internal audit annotations
--   [INST]...[/INST]  — Llama-2 instruction tokens
--   <|system|>...<|end|> — Phi/Mistral system tokens
--   Lines starting with System: / Human: / Assistant: / User:
--
-- This is a safe UPDATE-only migration; no schema changes.
-- Run with: psql $DATABASE_URL -f drizzle/0047_sprint6_data_quality.sql

-- Step 1: Strip [Audit note: ...] patterns
UPDATE claims
SET "verdictRationale" = TRIM(
  REGEXP_REPLACE("verdictRationale", '\[Audit note:[^\]]*\]', '', 'gi')
)
WHERE "verdictRationale" IS NOT NULL
  AND "verdictRationale" ~ '\[Audit note:';

-- Step 2: Strip [INST]...[/INST] patterns
UPDATE claims
SET "verdictRationale" = TRIM(
  REGEXP_REPLACE("verdictRationale", '\[INST\].*?\[\/INST\]', '', 'gis')
)
WHERE "verdictRationale" IS NOT NULL
  AND "verdictRationale" ~ '\[INST\]';

-- Step 3: Strip <|system|>...<|end|> patterns
UPDATE claims
SET "verdictRationale" = TRIM(
  REGEXP_REPLACE("verdictRationale", '<\|system\|>.*?<\|end\|>', '', 'gis')
)
WHERE "verdictRationale" IS NOT NULL
  AND "verdictRationale" ~ '<\|system\|>';

-- Step 4: Strip role-prefix lines (System:, Human:, Assistant:, User:)
UPDATE claims
SET "verdictRationale" = TRIM(
  REGEXP_REPLACE("verdictRationale", '(?m)^(System|Human|Assistant|User):\s*', '', 'gi')
)
WHERE "verdictRationale" IS NOT NULL
  AND "verdictRationale" ~ '(?m)^(System|Human|Assistant|User):';

-- Step 5: Collapse multiple spaces to single space
UPDATE claims
SET "verdictRationale" = TRIM(REGEXP_REPLACE("verdictRationale", '\s{2,}', ' ', 'g'))
WHERE "verdictRationale" IS NOT NULL
  AND "verdictRationale" ~ '\s{2,}';

-- Step 6: Targeted fix for claim 300023 (known leaked prompt)
-- Clears the rationale so the next quality-pass job will regenerate it cleanly.
UPDATE claims
SET "verdictRationale" = NULL
WHERE id = 300023
  AND "verdictRationale" IS NOT NULL
  AND (
    "verdictRationale" LIKE '%[INST]%'
    OR "verdictRationale" LIKE '%<|system|>%'
    OR "verdictRationale" LIKE '%[Audit note:%'
    OR "verdictRationale" LIKE '%System:%'
    OR "verdictRationale" LIKE '%Human:%'
  );

-- Verification query (run manually to confirm):
-- SELECT id, LEFT("verdictRationale", 120) FROM claims
-- WHERE id = 300023;
