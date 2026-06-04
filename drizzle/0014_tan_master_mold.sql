CREATE TABLE `notification_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`notifType` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`channel` enum('manus','webhook') NOT NULL DEFAULT 'manus',
	`status` enum('sent','failed','skipped') NOT NULL DEFAULT 'sent',
	`errorMsg` text,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vertical_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`verticalDomain` varchar(128) NOT NULL,
	`minConfidence` float NOT NULL DEFAULT 0.7,
	`notifyContradictions` boolean NOT NULL DEFAULT true,
	`notifySupported` boolean NOT NULL DEFAULT true,
	`frequency` enum('instant','daily','weekly') NOT NULL DEFAULT 'daily',
	`active` boolean NOT NULL DEFAULT true,
	`lastSentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vertical_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `va_user_vertical_unique` UNIQUE(`userId`,`verticalDomain`)
);
--> statement-breakpoint
CREATE INDEX `nl_user_idx` ON `notification_log` (`userId`);--> statement-breakpoint
CREATE INDEX `nl_type_idx` ON `notification_log` (`notifType`);--> statement-breakpoint
CREATE INDEX `nl_sent_at_idx` ON `notification_log` (`sentAt`);--> statement-breakpoint
CREATE INDEX `va_user_idx` ON `vertical_alerts` (`userId`);--> statement-breakpoint
CREATE INDEX `va_vertical_idx` ON `vertical_alerts` (`verticalDomain`);--> statement-breakpoint
CREATE INDEX `va_active_idx` ON `vertical_alerts` (`active`);