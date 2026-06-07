CREATE TABLE `vertical_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`domainKey` varchar(64) NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`description` text,
	`meshTerms` json NOT NULL DEFAULT ('[]'),
	`sourceWhitelist` json NOT NULL DEFAULT ('[]'),
	`qualityTier` varchar(16) NOT NULL DEFAULT 'draft',
	`enabled` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vertical_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `vertical_configs_domainKey_unique` UNIQUE(`domainKey`)
);
--> statement-breakpoint
CREATE INDEX `vc_domain_key_idx` ON `vertical_configs` (`domainKey`);--> statement-breakpoint
CREATE INDEX `vc_enabled_idx` ON `vertical_configs` (`enabled`);