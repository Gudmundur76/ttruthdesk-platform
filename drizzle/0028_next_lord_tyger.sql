CREATE TABLE `dream_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`wokeAt` timestamp,
	`durationMs` int,
	`cyclesCompleted` int NOT NULL DEFAULT 0,
	`reasonForWaking` varchar(128),
	`patternsFound` int NOT NULL DEFAULT 0,
	`hypothesesGenerated` int NOT NULL DEFAULT 0,
	`graphOptimizations` int NOT NULL DEFAULT 0,
	`confidenceRecalibrations` int NOT NULL DEFAULT 0,
	`simulatedScenarios` int NOT NULL DEFAULT 0,
	`patternLog` json NOT NULL DEFAULT ('[]'),
	`simulationLog` json NOT NULL DEFAULT ('[]'),
	`recalibrationLog` json NOT NULL DEFAULT ('[]'),
	`manualTrigger` boolean NOT NULL DEFAULT false,
	`healthScoreAtEntry` int,
	`entityCountAtEntry` int,
	CONSTRAINT `dream_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `event_queue` MODIFY COLUMN `eventType` enum('document_submitted','paper_discovered','source_data_changed','verdict_complete','contradiction_found','gap_closed','source_status_change','system_health_change','hypothesis_resolved','manual_review_complete','scheduled_tick','loop_action_complete','dream_pattern_detected','confidence_review_needed','dream_session_complete') NOT NULL;--> statement-breakpoint
CREATE INDEX `ds_started_at_idx` ON `dream_sessions` (`startedAt`);--> statement-breakpoint
CREATE INDEX `ds_woke_at_idx` ON `dream_sessions` (`wokeAt`);