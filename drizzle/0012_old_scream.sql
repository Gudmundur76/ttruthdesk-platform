CREATE TABLE `webhook_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`url` varchar(2048) NOT NULL,
	`secret` varchar(128) NOT NULL,
	`label` varchar(128),
	`eventTypes` json NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`lastFiredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `wa_user_idx` ON `webhook_alerts` (`userId`);--> statement-breakpoint
CREATE INDEX `wa_active_idx` ON `webhook_alerts` (`active`);