CREATE TABLE `self_prompt_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`stateSnapshot` json NOT NULL,
	`reasoning` text NOT NULL,
	`actions` json NOT NULL,
	`converged` boolean NOT NULL DEFAULT false,
	`actionCount` int NOT NULL DEFAULT 0,
	`executedCount` int NOT NULL DEFAULT 0,
	`executionResults` json,
	`durationMs` int,
	`claimId` int,
	`documentId` int,
	`gapId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `self_prompt_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `spl_event_type_idx` ON `self_prompt_log` (`eventType`);--> statement-breakpoint
CREATE INDEX `spl_converged_idx` ON `self_prompt_log` (`converged`);--> statement-breakpoint
CREATE INDEX `spl_claim_id_idx` ON `self_prompt_log` (`claimId`);--> statement-breakpoint
CREATE INDEX `spl_document_id_idx` ON `self_prompt_log` (`documentId`);--> statement-breakpoint
CREATE INDEX `spl_created_at_idx` ON `self_prompt_log` (`createdAt`);