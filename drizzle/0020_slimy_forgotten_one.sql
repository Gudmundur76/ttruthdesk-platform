CREATE TABLE `wiki_index` (
	`id` int AUTO_INCREMENT NOT NULL,
	`content` text NOT NULL DEFAULT (''),
	`pageCount` int NOT NULL DEFAULT 0,
	`lastBuiltAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wiki_index_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wiki_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`action` enum('ingest','lint','query','update') NOT NULL,
	`slug` varchar(256),
	`summary` text NOT NULL,
	`pagesAffected` int NOT NULL DEFAULT 0,
	`documentId` int,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wiki_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wiki_pages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(256) NOT NULL,
	`title` varchar(512) NOT NULL,
	`category` enum('entity','concept','synthesis','source_summary') NOT NULL DEFAULT 'entity',
	`content` text NOT NULL DEFAULT (''),
	`sourceCount` int NOT NULL DEFAULT 0,
	`inboundLinks` json NOT NULL DEFAULT ('[]'),
	`outboundLinks` json NOT NULL DEFAULT ('[]'),
	`avgConfidence` float DEFAULT 0,
	`verticalDomain` varchar(64) NOT NULL DEFAULT 'structural_biology',
	`lastCompiledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wiki_pages_id` PRIMARY KEY(`id`),
	CONSTRAINT `wiki_pages_slug_unique` UNIQUE(`slug`),
	CONSTRAINT `wp_slug_idx` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE INDEX `wl_action_idx` ON `wiki_log` (`action`);--> statement-breakpoint
CREATE INDEX `wl_recorded_at_idx` ON `wiki_log` (`recordedAt`);--> statement-breakpoint
CREATE INDEX `wl_document_id_idx` ON `wiki_log` (`documentId`);--> statement-breakpoint
CREATE INDEX `wp_category_idx` ON `wiki_pages` (`category`);--> statement-breakpoint
CREATE INDEX `wp_vertical_idx` ON `wiki_pages` (`verticalDomain`);--> statement-breakpoint
CREATE INDEX `wp_updated_at_idx` ON `wiki_pages` (`updatedAt`);