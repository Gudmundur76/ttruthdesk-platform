-- Sprint 40 — Phase 134 migration
-- Domain-aware claim extraction: widen claimType from a 7-value structural-biology
-- ENUM to varchar(64) so every domain can write its own claim types without a
-- schema migration per sprint.
--
-- The old ENUM values are preserved as valid strings; no data is lost.
-- The column is NOT NULL with no default — existing rows keep their current value.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `claims`
  MODIFY COLUMN `claimType` varchar(64) NOT NULL;
