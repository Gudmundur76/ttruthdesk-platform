CREATE TABLE `discovery_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`verticalKey` varchar(64) NOT NULL,
	`status` enum('running','complete','failed') NOT NULL DEFAULT 'running',
	`currentPhase` varchar(32) DEFAULT 'match',
	`sourcesMatched` int NOT NULL DEFAULT 0,
	`sourcesProbed` int NOT NULL DEFAULT 0,
	`adaptersGenerated` int NOT NULL DEFAULT 0,
	`registeredSources` json NOT NULL DEFAULT ('[]'),
	`adapterFiles` json NOT NULL DEFAULT ('[]'),
	`errorMessage` text,
	`runLog` json NOT NULL DEFAULT ('[]'),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `discovery_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `micron_deployments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`verticalKey` varchar(64) NOT NULL,
	`displayName` varchar(256) NOT NULL,
	`domain` varchar(512),
	`deployTarget` enum('vercel','netlify','docker','ipfs') NOT NULL,
	`status` enum('pending','building','deployed','failed','cancelled') NOT NULL DEFAULT 'pending',
	`siteUrl` varchar(2048),
	`config` json NOT NULL DEFAULT ('{}'),
	`errorMessage` text,
	`userId` int NOT NULL,
	`deployedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `micron_deployments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `source_registry_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` varchar(128) NOT NULL,
	`displayName` varchar(256) NOT NULL,
	`baseUrl` varchar(2048) NOT NULL,
	`category` enum('protein_structure','sequence','literature','clinical','chemistry','genomics','nutrition','regulatory','other') NOT NULL DEFAULT 'other',
	`approvalStatus` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`isHealthy` boolean NOT NULL DEFAULT true,
	`lastHealthCheckAt` timestamp,
	`lastHealthStatus` int,
	`verticals` json NOT NULL DEFAULT ('[]'),
	`adapterStub` text,
	`discoveryRunId` int,
	`schemaDescription` text,
	`rateLimitRpm` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `source_registry_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `source_registry_entries_sourceId_unique` UNIQUE(`sourceId`),
	CONSTRAINT `sre_source_id_idx` UNIQUE(`sourceId`)
);
--> statement-breakpoint
CREATE INDEX `dr_vertical_key_idx` ON `discovery_runs` (`verticalKey`);--> statement-breakpoint
CREATE INDEX `dr_status_idx` ON `discovery_runs` (`status`);--> statement-breakpoint
CREATE INDEX `dr_started_at_idx` ON `discovery_runs` (`startedAt`);--> statement-breakpoint
CREATE INDEX `md_vertical_key_idx` ON `micron_deployments` (`verticalKey`);--> statement-breakpoint
CREATE INDEX `md_status_idx` ON `micron_deployments` (`status`);--> statement-breakpoint
CREATE INDEX `md_user_idx` ON `micron_deployments` (`userId`);--> statement-breakpoint
CREATE INDEX `sre_category_idx` ON `source_registry_entries` (`category`);--> statement-breakpoint
CREATE INDEX `sre_approval_status_idx` ON `source_registry_entries` (`approvalStatus`);