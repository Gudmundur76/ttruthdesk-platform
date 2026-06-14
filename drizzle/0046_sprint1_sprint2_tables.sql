-- Sprint 0 + Sprint 1 + Phase 115 migration
-- Adds: rate_limit_buckets, dream_staging_queue, claim_embeddings,
--       citationGraphEnriched column on claims,
--       system_capability_required event type on event_queue

-- ─── rate_limit_buckets ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `rate_limit_buckets` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `key` varchar(255) NOT NULL,
  `tier` varchar(32) NOT NULL,
  `count` int NOT NULL DEFAULT 0,
  `reset_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  UNIQUE KEY `rl_key_tier_idx` (`key`, `tier`),
  KEY `rl_reset_at_idx` (`reset_at`)
);

-- ─── dream_staging_queue ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `dream_staging_queue` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `session_event_id` int NOT NULL,
  `hypothesis` json NOT NULL,
  `confidence` float NOT NULL,
  `status` enum('pending','approved','rejected','auto_promoted') NOT NULL DEFAULT 'pending',
  `reviewed_by` varchar(64),
  `review_note` text,
  `created_at` bigint NOT NULL,
  `reviewed_at` bigint,
  KEY `dsq_status_idx` (`status`),
  KEY `dsq_session_idx` (`session_event_id`),
  KEY `dsq_created_at_idx` (`created_at`)
);

-- ─── claim_embeddings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `claim_embeddings` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `claim_id` int NOT NULL,
  `embedding` vector(1536) NOT NULL,
  `model` varchar(64) NOT NULL DEFAULT 'text-embedding-3-small',
  `indexed_at` bigint NOT NULL,
  UNIQUE KEY `ce_claim_id_idx` (`claim_id`),
  KEY `ce_indexed_at_idx` (`indexed_at`)
);

-- ─── claims.citation_graph_enriched (Phase 115) ───────────────────────────────
ALTER TABLE `claims`
  ADD COLUMN IF NOT EXISTS `citation_graph_enriched` boolean NOT NULL DEFAULT false;

-- ─── event_queue.eventType enum update (Sprint 1 — system_capability_required) ─
ALTER TABLE `event_queue` MODIFY COLUMN `eventType` enum(
  'document_submitted',
  'paper_discovered',
  'source_data_changed',
  'verdict_complete',
  'contradiction_found',
  'gap_closed',
  'source_status_change',
  'system_health_change',
  'hypothesis_resolved',
  'manual_review_complete',
  'scheduled_tick',
  'loop_action_complete',
  'dream_pattern_detected',
  'confidence_review_needed',
  'dream_session_complete',
  'source_version_changed',
  'coverage_gap',
  'system_capability_required'
) NOT NULL;
