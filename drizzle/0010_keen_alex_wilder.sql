CREATE TABLE `user_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`paypalOrderId` varchar(128) NOT NULL,
	`paypalCaptureId` varchar(128),
	`planTier` enum('starter','diligence','platform') NOT NULL,
	`status` enum('pending','active','cancelled','refunded') NOT NULL DEFAULT 'pending',
	`auditsLimit` int NOT NULL,
	`auditsUsed` int NOT NULL DEFAULT 0,
	`amountUsd` int NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'USD',
	`activatedAt` timestamp,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_subscriptions_paypalOrderId_unique` UNIQUE(`paypalOrderId`)
);
--> statement-breakpoint
CREATE INDEX `subscriptions_userId_idx` ON `user_subscriptions` (`userId`);--> statement-breakpoint
CREATE INDEX `subscriptions_status_idx` ON `user_subscriptions` (`status`);