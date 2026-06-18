CREATE TABLE `claim_embeddings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claim_id` int NOT NULL,
	`embedding` VECTOR(1536) NOT NULL,
	`model` varchar(64) NOT NULL DEFAULT 'text-embedding-3-small',
	`indexed_at` bigint NOT NULL,
	CONSTRAINT `claim_embeddings_id` PRIMARY KEY(`id`),
	CONSTRAINT `claim_embeddings_claim_id_unique` UNIQUE(`claim_id`),
	CONSTRAINT `ce_claim_id_idx` UNIQUE(`claim_id`)
);
--> statement-breakpoint
CREATE TABLE `dream_staging_queue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_event_id` int NOT NULL,
	`hypothesis` json NOT NULL,
	`confidence` float NOT NULL,
	`status` enum('pending','approved','rejected','auto_promoted') NOT NULL DEFAULT 'pending',
	`reviewed_by` varchar(64),
	`review_note` text,
	`created_at` bigint NOT NULL,
	`reviewed_at` bigint,
	CONSTRAINT `dream_staging_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `frontier_directives` (
	`id` int AUTO_INCREMENT NOT NULL,
	`directiveId` varchar(36) NOT NULL,
	`triggerReason` enum('convergence_stalled','confidence_low','gap_detected','scheduled','manual') NOT NULL,
	`priority` int NOT NULL DEFAULT 5,
	`targetGapIds` json NOT NULL,
	`maxIterations` int NOT NULL DEFAULT 10,
	`evidenceStrengthThreshold` float NOT NULL DEFAULT 0.6,
	`status` enum('pending','active','complete','cancelled','max_iterations_reached') NOT NULL DEFAULT 'pending',
	`frontierSessionId` int,
	`iterationsUsed` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `frontier_directives_id` PRIMARY KEY(`id`),
	CONSTRAINT `frontier_directives_directiveId_unique` UNIQUE(`directiveId`)
);
--> statement-breakpoint
CREATE TABLE `layer_telemetry` (
	`id` int AUTO_INCREMENT NOT NULL,
	`layer` enum('L0_FRICTION','L1_TRUTH','L2_SELF_PROMPT','L3_FRONTIER','L4_META','L5_DREAM','ORCHESTRATOR') NOT NULL,
	`eventType` enum('start','end','error') NOT NULL,
	`eventQueueId` int,
	`correlationId` varchar(36),
	`durationMs` int,
	`success` boolean NOT NULL DEFAULT true,
	`errorCode` varchar(64),
	`payloadHash` varchar(64),
	`metadataJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `layer_telemetry_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `meta_agent_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`checkId` int,
	`severity` enum('info','warning','critical') NOT NULL,
	`handlerName` varchar(128) NOT NULL,
	`payload` json NOT NULL,
	`acknowledged` boolean NOT NULL DEFAULT false,
	`dedupeKey` varchar(256),
	`dispatchedAt` timestamp NOT NULL DEFAULT (now()),
	`acknowledgedAt` timestamp,
	CONSTRAINT `meta_agent_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pricing_leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`organisation` varchar(255) NOT NULL,
	`tier` enum('starter','diligence','platform_pilot') NOT NULL,
	`useCase` text,
	`status` enum('new','contacted','converted','declined') NOT NULL DEFAULT 'new',
	`notifiedAt` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pricing_leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(255) NOT NULL,
	`tier` varchar(32) NOT NULL,
	`count` int NOT NULL DEFAULT 0,
	`reset_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `rate_limit_buckets_id` PRIMARY KEY(`id`),
	CONSTRAINT `rl_key_tier_idx` UNIQUE(`key`,`tier`)
);
--> statement-breakpoint
ALTER TABLE `claims` MODIFY COLUMN `claimType` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `event_queue` MODIFY COLUMN `eventType` enum('document_submitted','paper_discovered','source_data_changed','verdict_complete','contradiction_found','gap_closed','source_status_change','system_health_change','hypothesis_resolved','manual_review_complete','scheduled_tick','loop_action_complete','dream_pattern_detected','confidence_review_needed','dream_session_complete','source_version_changed','coverage_gap','system_capability_required') NOT NULL;--> statement-breakpoint
ALTER TABLE `claims` ADD `citationGraphEnriched` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `ce_indexed_at_idx` ON `claim_embeddings` (`indexed_at`);--> statement-breakpoint
CREATE INDEX `dsq_status_idx` ON `dream_staging_queue` (`status`);--> statement-breakpoint
CREATE INDEX `dsq_session_idx` ON `dream_staging_queue` (`session_event_id`);--> statement-breakpoint
CREATE INDEX `dsq_created_at_idx` ON `dream_staging_queue` (`created_at`);--> statement-breakpoint
CREATE INDEX `fd_directive_id_idx` ON `frontier_directives` (`directiveId`);--> statement-breakpoint
CREATE INDEX `fd_status_idx` ON `frontier_directives` (`status`);--> statement-breakpoint
CREATE INDEX `fd_priority_idx` ON `frontier_directives` (`priority`);--> statement-breakpoint
CREATE INDEX `fd_created_at_idx` ON `frontier_directives` (`createdAt`);--> statement-breakpoint
CREATE INDEX `lt_layer_idx` ON `layer_telemetry` (`layer`);--> statement-breakpoint
CREATE INDEX `lt_correlation_idx` ON `layer_telemetry` (`correlationId`);--> statement-breakpoint
CREATE INDEX `lt_created_at_idx` ON `layer_telemetry` (`createdAt`);--> statement-breakpoint
CREATE INDEX `lt_event_queue_idx` ON `layer_telemetry` (`eventQueueId`);--> statement-breakpoint
CREATE INDEX `maa_severity_idx` ON `meta_agent_alerts` (`severity`);--> statement-breakpoint
CREATE INDEX `maa_check_id_idx` ON `meta_agent_alerts` (`checkId`);--> statement-breakpoint
CREATE INDEX `maa_dedupe_key_idx` ON `meta_agent_alerts` (`dedupeKey`);--> statement-breakpoint
CREATE INDEX `maa_dispatched_at_idx` ON `meta_agent_alerts` (`dispatchedAt`);--> statement-breakpoint
CREATE INDEX `pl_tier_idx` ON `pricing_leads` (`tier`);--> statement-breakpoint
CREATE INDEX `pl_status_idx` ON `pricing_leads` (`status`);--> statement-breakpoint
CREATE INDEX `pl_created_at_idx` ON `pricing_leads` (`createdAt`);--> statement-breakpoint
CREATE INDEX `rl_reset_at_idx` ON `rate_limit_buckets` (`reset_at`);