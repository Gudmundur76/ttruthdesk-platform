CREATE TABLE `meta_agent_checks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentName` varchar(128) NOT NULL DEFAULT 'codeGuardianAgent',
	`checkType` varchar(128) NOT NULL,
	`finding` json NOT NULL,
	`actionTaken` enum('ok','alerted','queuedFix','autoResolved','escalated') NOT NULL DEFAULT 'ok',
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'info',
	`confidence` float NOT NULL DEFAULT 1,
	`humanReviewedAt` timestamp,
	`humanOverride` boolean,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `meta_agent_checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `mac_check_type_idx` ON `meta_agent_checks` (`checkType`);--> statement-breakpoint
CREATE INDEX `mac_severity_idx` ON `meta_agent_checks` (`severity`);--> statement-breakpoint
CREATE INDEX `mac_action_idx` ON `meta_agent_checks` (`actionTaken`);--> statement-breakpoint
CREATE INDEX `mac_created_at_idx` ON `meta_agent_checks` (`createdAt`);--> statement-breakpoint
CREATE INDEX `mac_review_idx` ON `meta_agent_checks` (`humanReviewedAt`);