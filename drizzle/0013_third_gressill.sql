CREATE TABLE `coord_context` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(512) NOT NULL,
	`value` json NOT NULL,
	`namespace` varchar(128) NOT NULL DEFAULT 'global',
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coord_context_id` PRIMARY KEY(`id`),
	CONSTRAINT `coord_context_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `coord_queue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vertical` varchar(64) NOT NULL,
	`pmid` varchar(32),
	`doi` varchar(256),
	`paperUrl` varchar(2048),
	`title` text,
	`priority` int NOT NULL DEFAULT 0,
	`status` enum('pending','claimed','completed','failed','skipped') NOT NULL DEFAULT 'pending',
	`claimedBy` varchar(64),
	`claimedAt` timestamp,
	`result` json,
	`errorMsg` text,
	`retryCount` int NOT NULL DEFAULT 0,
	`source` varchar(64) NOT NULL DEFAULT 'manual',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `coord_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coord_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` varchar(64) NOT NULL,
	`manusTaskId` varchar(128),
	`vertical` varchar(64) NOT NULL,
	`phase` varchar(64) NOT NULL DEFAULT 'idle',
	`status` enum('pending','running','completed','failed','stalled') NOT NULL DEFAULT 'pending',
	`workItemId` int,
	`meta` json,
	`errorMsg` text,
	`itemsCompleted` int NOT NULL DEFAULT 0,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`lastHeartbeatAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `coord_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `coord_tasks_taskId_unique` UNIQUE(`taskId`)
);
--> statement-breakpoint
CREATE INDEX `cc_namespace_idx` ON `coord_context` (`namespace`);--> statement-breakpoint
CREATE INDEX `cc_expires_idx` ON `coord_context` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `cq_status_idx` ON `coord_queue` (`status`);--> statement-breakpoint
CREATE INDEX `cq_vertical_idx` ON `coord_queue` (`vertical`);--> statement-breakpoint
CREATE INDEX `cq_priority_idx` ON `coord_queue` (`priority`);--> statement-breakpoint
CREATE INDEX `cq_pmid_idx` ON `coord_queue` (`pmid`);--> statement-breakpoint
CREATE INDEX `cq_claimed_by_idx` ON `coord_queue` (`claimedBy`);--> statement-breakpoint
CREATE INDEX `ct_status_idx` ON `coord_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `ct_vertical_idx` ON `coord_tasks` (`vertical`);--> statement-breakpoint
CREATE INDEX `ct_manus_task_idx` ON `coord_tasks` (`manusTaskId`);