CREATE TABLE `contradiction_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimAId` int NOT NULL,
	`claimBId` int NOT NULL,
	`claimAVerdict` varchar(64),
	`claimBVerdict` varchar(64),
	`claimALabel` varchar(64),
	`claimBLabel` varchar(64),
	`claimAScore` float,
	`claimBScore` float,
	`edgeWeight` float NOT NULL DEFAULT 0.5,
	`severity` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`status` enum('open','reviewed','resolved','dismissed') NOT NULL DEFAULT 'open',
	`resolutionNotes` text,
	`detectedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contradiction_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `ca_unique_pair` UNIQUE(`claimAId`,`claimBId`)
);
--> statement-breakpoint
CREATE INDEX `ca_claim_a_idx` ON `contradiction_alerts` (`claimAId`);--> statement-breakpoint
CREATE INDEX `ca_claim_b_idx` ON `contradiction_alerts` (`claimBId`);--> statement-breakpoint
CREATE INDEX `ca_severity_idx` ON `contradiction_alerts` (`severity`);--> statement-breakpoint
CREATE INDEX `ca_status_idx` ON `contradiction_alerts` (`status`);--> statement-breakpoint
CREATE INDEX `ca_detected_at_idx` ON `contradiction_alerts` (`detectedAt`);