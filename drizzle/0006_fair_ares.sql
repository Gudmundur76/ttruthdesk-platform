ALTER TABLE `email_users` ADD `plan` enum('free_trial','academic','starter','diligence','platform') DEFAULT 'free_trial' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_users` ADD `trialExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `email_users` ADD `auditCount` int DEFAULT 0 NOT NULL;