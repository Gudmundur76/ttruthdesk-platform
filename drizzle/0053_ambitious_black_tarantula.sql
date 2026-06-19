CREATE TABLE `dream_event_queue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`dreamPriority` varchar(16) NOT NULL,
	`evidenceStrength` float NOT NULL DEFAULT 0,
	`autoTrigger` boolean NOT NULL DEFAULT false,
	`payload` json NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'queued',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	CONSTRAINT `dream_event_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `confidence_history` ADD `ruleTriggered` varchar(4);--> statement-breakpoint
ALTER TABLE `confidence_history` ADD `dreamSessionId` int;--> statement-breakpoint
ALTER TABLE `confidence_history` ADD `oldConfidence` float;--> statement-breakpoint
ALTER TABLE `confidence_history` ADD `newConfidence` float;--> statement-breakpoint
ALTER TABLE `confidence_history` ADD `evidence` text;--> statement-breakpoint
ALTER TABLE `confidence_history` ADD `applied` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `dream_sessions` ADD `maxCycles` int DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `dream_sessions` ADD `queuePendingAtStart` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dream_sessions` ADD `perCycleReports` json;--> statement-breakpoint
ALTER TABLE `dream_sessions` ADD `eventsPublished` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dream_sessions` ADD `aggregateRiskLevel` varchar(16);--> statement-breakpoint
ALTER TABLE `dream_sessions` ADD `status` varchar(16) DEFAULT 'running' NOT NULL;--> statement-breakpoint
ALTER TABLE `dream_sessions` ADD `abortReason` text;--> statement-breakpoint
ALTER TABLE `knowledge_gaps` ADD `directiveBoost` float DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_gaps` ADD `rank` int;--> statement-breakpoint
ALTER TABLE `knowledge_gaps` ADD `detectionCount` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_gaps` ADD `lastDetectedAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
CREATE INDEX `deq_status_idx` ON `dream_event_queue` (`status`);--> statement-breakpoint
CREATE INDEX `deq_session_id_idx` ON `dream_event_queue` (`sessionId`);--> statement-breakpoint
CREATE INDEX `deq_priority_strength_idx` ON `dream_event_queue` (`dreamPriority`,`evidenceStrength`);--> statement-breakpoint
CREATE INDEX `ds_status_idx` ON `dream_sessions` (`status`);