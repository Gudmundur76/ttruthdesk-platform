CREATE TABLE `claim_provenance_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimId` int NOT NULL,
	`documentId` int NOT NULL,
	`step` enum('extraction','evidence_lookup','quality_scoring','verdict_override','agent_ingestion','similarity_check') NOT NULL,
	`actor` varchar(128) NOT NULL DEFAULT 'system',
	`inputSnapshot` json,
	`outputSnapshot` json,
	`durationMs` int,
	`success` boolean NOT NULL DEFAULT true,
	`errorMsg` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `claim_provenance_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `cpe_claim_id_idx` ON `claim_provenance_events` (`claimId`);--> statement-breakpoint
CREATE INDEX `cpe_document_id_idx` ON `claim_provenance_events` (`documentId`);--> statement-breakpoint
CREATE INDEX `cpe_step_idx` ON `claim_provenance_events` (`step`);--> statement-breakpoint
CREATE INDEX `cpe_created_at_idx` ON `claim_provenance_events` (`createdAt`);