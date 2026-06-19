ALTER TABLE `frontier_directives` ADD `confidence` float DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE `frontier_directives` ADD `ttlMinutes` int DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `frontier_directives` ADD `expiresAt` timestamp;--> statement-breakpoint
CREATE INDEX `fd_expires_at_idx` ON `frontier_directives` (`expiresAt`);