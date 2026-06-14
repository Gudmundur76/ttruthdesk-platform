# Production Migration Runbook: Sprint 1 & 2 Schema Changes

This runbook outlines the steps to safely apply the `0046_sprint1_sprint2_tables.sql` migration to the production `ttruthdesk.claims` database.

## 1. Pre-Migration Checklist

- [ ] Ensure no active batch verification jobs are running (`POST /api/v2/verify/batch`)
- [ ] Take a snapshot of the production MySQL database
- [ ] Verify the `drizzle/0046_sprint1_sprint2_tables.sql` file exists and is identical to the one in `origin/main` commit `e0805c9`

## 2. Migration Contents

The migration applies the following structural changes without altering existing data:

1. **`rate_limit_buckets` table**: Replaces the in-memory Maps used for API rate limiting.
2. **`dream_staging_queue` table**: Infrastructure for the autonomous dream hypothesis generation.
3. **`claim_embeddings` table**: Stores RuVector embeddings for semantic similarity search.
4. **`claims.citationGraphEnriched` column**: A new `BOOLEAN DEFAULT false` column tracking whether OpenCitations scoring (Phase 115) has been applied.
5. **`event_queue` ENUM update**: Adds `'system_capability_required'` to the `type` column to support the self-building loop.

## 3. Execution

Execute the migration against the production database:

```bash
# Using Drizzle Kit (preferred)
pnpm drizzle-kit migrate

# OR manually via MySQL CLI
mysql -u [user] -p [database_name] < drizzle/0046_sprint1_sprint2_tables.sql
```

## 4. Post-Migration Verification

1. Verify the new tables exist:
   ```sql
   SHOW TABLES LIKE 'rate_limit_buckets';
   SHOW TABLES LIKE 'dream_staging_queue';
   SHOW TABLES LIKE 'claim_embeddings';
   ```
2. Verify the new column on `claims`:
   ```sql
   SHOW COLUMNS FROM claims LIKE 'citationGraphEnriched';
   ```
3. Restart the Node.js application server to ensure connection pools are fresh and the new schema is recognized by Drizzle ORM.
4. Monitor the `/api/v2/health/detailed` endpoint to confirm database connectivity.

## 5. Rollback Plan

If the migration fails or causes application instability:

1. Stop the application server.
2. Restore the database from the snapshot taken in Step 1.
3. Restart the application server.
4. Investigate the failure logs before attempting again.
