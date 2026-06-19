ALTER TABLE `audit_reports` ADD `flaggedForReview` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_reports` ADD `flagReason` varchar(500);--> statement-breakpoint
ALTER TABLE `audit_reports` ADD `flaggedAt` timestamp;