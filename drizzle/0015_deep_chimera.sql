CREATE TABLE `webhook_delivery_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`webhookId` int NOT NULL,
	`url` varchar(2048) NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`httpStatus` int,
	`status` enum('success','failed','timeout','retry_pending') NOT NULL,
	`responseBody` text,
	`latencyMs` int,
	`attemptCount` int NOT NULL DEFAULT 1,
	`nextRetryAt` timestamp,
	`errorMsg` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `webhook_delivery_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `wdl_webhook_idx` ON `webhook_delivery_log` (`webhookId`);--> statement-breakpoint
CREATE INDEX `wdl_status_idx` ON `webhook_delivery_log` (`status`);--> statement-breakpoint
CREATE INDEX `wdl_created_at_idx` ON `webhook_delivery_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `wdl_retry_idx` ON `webhook_delivery_log` (`nextRetryAt`);