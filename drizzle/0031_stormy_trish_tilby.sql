CREATE TABLE `cron_run_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobName` varchar(128) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'ok',
	`durationMs` int NOT NULL DEFAULT 0,
	`summary` text,
	`errorMessage` text,
	`ranAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cron_run_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `crl_job_name_idx` ON `cron_run_log` (`jobName`);--> statement-breakpoint
CREATE INDEX `crl_ran_at_idx` ON `cron_run_log` (`ranAt`);