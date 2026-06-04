CREATE TABLE `confidence_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimId` int NOT NULL,
	`documentId` int NOT NULL,
	`score` float NOT NULL,
	`trigger` varchar(64) NOT NULL DEFAULT 'initial',
	`flags` json,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `confidence_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ch_claim_id_idx` ON `confidence_history` (`claimId`);--> statement-breakpoint
CREATE INDEX `ch_document_id_idx` ON `confidence_history` (`documentId`);--> statement-breakpoint
CREATE INDEX `ch_recorded_at_idx` ON `confidence_history` (`recordedAt`);