CREATE TABLE `convergence_states` (
	`id` int AUTO_INCREMENT NOT NULL,
	`converged` boolean NOT NULL,
	`pendingEvents` int NOT NULL DEFAULT 0,
	`activeDirectives` int NOT NULL DEFAULT 0,
	`cycleNumber` int,
	`reason` varchar(512),
	`healthScore` float,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `convergence_states_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `event_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventQueueId` int,
	`eventType` varchar(64) NOT NULL,
	`processedByLayer` int,
	`outcome` enum('success','skipped','error','timeout') NOT NULL,
	`durationMs` int,
	`errorMessage` text,
	`payloadSnapshot` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `event_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `preflight_assumptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scanId` int NOT NULL,
	`assumptionType` varchar(32) NOT NULL,
	`assumptionText` text NOT NULL,
	`confidence` float,
	`highRisk` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `preflight_assumptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `preflight_constraints` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scanId` int NOT NULL,
	`constraintType` varchar(32) NOT NULL,
	`constraintText` text NOT NULL,
	`isHard` boolean NOT NULL DEFAULT false,
	`confidence` float,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `preflight_constraints_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `preflight_scans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inputHash` varchar(64) NOT NULL,
	`recommendedAction` varchar(32) NOT NULL,
	`frictionScore` float,
	`cacheHit` boolean NOT NULL DEFAULT false,
	`durationMs` int,
	`assumptionCount` int NOT NULL DEFAULT 0,
	`constraintCount` int NOT NULL DEFAULT 0,
	`reframedPrompt` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `preflight_scans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `cs_converged_idx` ON `convergence_states` (`converged`);--> statement-breakpoint
CREATE INDEX `cs_created_at_idx` ON `convergence_states` (`createdAt`);--> statement-breakpoint
CREATE INDEX `el_event_type_idx` ON `event_log` (`eventType`);--> statement-breakpoint
CREATE INDEX `el_outcome_idx` ON `event_log` (`outcome`);--> statement-breakpoint
CREATE INDEX `el_created_at_idx` ON `event_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `el_event_queue_id_idx` ON `event_log` (`eventQueueId`);--> statement-breakpoint
CREATE INDEX `pa_scan_id_idx` ON `preflight_assumptions` (`scanId`);--> statement-breakpoint
CREATE INDEX `pa_assumption_type_idx` ON `preflight_assumptions` (`assumptionType`);--> statement-breakpoint
CREATE INDEX `pc2_scan_id_idx` ON `preflight_constraints` (`scanId`);--> statement-breakpoint
CREATE INDEX `pc2_constraint_type_idx` ON `preflight_constraints` (`constraintType`);--> statement-breakpoint
CREATE INDEX `ps_input_hash_idx` ON `preflight_scans` (`inputHash`);--> statement-breakpoint
CREATE INDEX `ps_recommended_action_idx` ON `preflight_scans` (`recommendedAction`);--> statement-breakpoint
CREATE INDEX `ps_created_at_idx` ON `preflight_scans` (`createdAt`);