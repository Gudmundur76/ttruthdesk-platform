CREATE TABLE `public_submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimText` text NOT NULL,
	`verticalDomain` varchar(64) NOT NULL DEFAULT 'structural_biology',
	`source` varchar(64) NOT NULL DEFAULT 'api',
	`documentId` int,
	`status` enum('queued','processing','done','failed') NOT NULL DEFAULT 'queued',
	`submitterIp` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `public_submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ps_status_idx` ON `public_submissions` (`status`);--> statement-breakpoint
CREATE INDEX `ps_created_at_idx` ON `public_submissions` (`createdAt`);--> statement-breakpoint
CREATE INDEX `ps_document_id_idx` ON `public_submissions` (`documentId`);