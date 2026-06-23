CREATE TABLE `self_direct_specs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`specId` varchar(64) NOT NULL,
	`adapterId` varchar(128) NOT NULL,
	`title` varchar(512) NOT NULL,
	`summary` text NOT NULL,
	`specJson` json NOT NULL,
	`beforeF1` float,
	`afterF1Predicted` float,
	`status` enum('pending_review','approved','rejected') NOT NULL DEFAULT 'pending_review',
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `self_direct_specs_id` PRIMARY KEY(`id`),
	CONSTRAINT `self_direct_specs_specId_unique` UNIQUE(`specId`)
);
--> statement-breakpoint
CREATE INDEX `sds_spec_id_idx` ON `self_direct_specs` (`specId`);--> statement-breakpoint
CREATE INDEX `sds_status_idx` ON `self_direct_specs` (`status`);