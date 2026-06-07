CREATE TABLE `event_queue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` enum('document_submitted','paper_discovered','source_data_changed','verdict_complete','contradiction_found','gap_closed','source_status_change','system_health_change','hypothesis_resolved','manual_review_complete','scheduled_tick','loop_action_complete') NOT NULL,
	`payload` json NOT NULL,
	`status` enum('pending','processing','processed','skipped','failed') NOT NULL DEFAULT 'pending',
	`entryLayer` int NOT NULL DEFAULT 0,
	`loopRunId` int,
	`skipReason` varchar(256),
	`attempts` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	CONSTRAINT `event_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loop_config` (
	`id` int NOT NULL DEFAULT 1,
	`safeMode` boolean NOT NULL DEFAULT false,
	`safeModeReason` varchar(512),
	`safeModeTriggeredAt` timestamp,
	`convergeThreshold` int NOT NULL DEFAULT 30,
	`healthyThreshold` int NOT NULL DEFAULT 80,
	`safeModeThreshold` int NOT NULL DEFAULT 40,
	`haltThreshold` int NOT NULL DEFAULT 60,
	`maxLoopDepth` int NOT NULL DEFAULT 10,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loop_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loop_run` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventQueueId` int NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`layersExecuted` int NOT NULL DEFAULT 0,
	`actionsExecuted` json NOT NULL,
	`converged` boolean NOT NULL DEFAULT false,
	`convergenceReason` varchar(512),
	`healthScore` int,
	`safeModeTriggered` boolean NOT NULL DEFAULT false,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loop_run_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `eq_status_idx` ON `event_queue` (`status`);--> statement-breakpoint
CREATE INDEX `eq_event_type_idx` ON `event_queue` (`eventType`);--> statement-breakpoint
CREATE INDEX `eq_created_at_idx` ON `event_queue` (`createdAt`);--> statement-breakpoint
CREATE INDEX `lr_event_queue_id_idx` ON `loop_run` (`eventQueueId`);--> statement-breakpoint
CREATE INDEX `lr_event_type_idx` ON `loop_run` (`eventType`);--> statement-breakpoint
CREATE INDEX `lr_converged_idx` ON `loop_run` (`converged`);--> statement-breakpoint
CREATE INDEX `lr_created_at_idx` ON `loop_run` (`createdAt`);