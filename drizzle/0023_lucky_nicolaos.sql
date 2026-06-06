CREATE TABLE `frontier_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actionType` enum('gap_detected','hypothesis_queued','search_expanded','priority_adjusted','gap_closed','hypothesis_verified','hypothesis_refuted') NOT NULL,
	`gapId` int,
	`queueItemId` int,
	`reasoning` json,
	`outcome` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `frontier_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_gaps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityAId` int,
	`entityBId` int,
	`gapType` enum('structural','evidence','contradiction','temporal','hypothesis') NOT NULL,
	`priorityScore` float NOT NULL DEFAULT 0,
	`description` text NOT NULL,
	`detectionSource` varchar(64) NOT NULL DEFAULT 'frontier_scan',
	`status` enum('open','pursued','narrowing','closed_verified','closed_resolved','stale') NOT NULL DEFAULT 'open',
	`evidenceAttempts` int NOT NULL DEFAULT 0,
	`contributingClaimCount` int NOT NULL DEFAULT 0,
	`pursuitQueueId` int,
	`closingEvidenceId` int,
	`projectedClosureAt` timestamp,
	`lastPursuedAt` timestamp,
	`openedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `knowledge_gaps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `fl_action_type_idx` ON `frontier_log` (`actionType`);--> statement-breakpoint
CREATE INDEX `fl_gap_id_idx` ON `frontier_log` (`gapId`);--> statement-breakpoint
CREATE INDEX `fl_created_at_idx` ON `frontier_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `kg_gap_type_idx` ON `knowledge_gaps` (`gapType`);--> statement-breakpoint
CREATE INDEX `kg_status_idx` ON `knowledge_gaps` (`status`);--> statement-breakpoint
CREATE INDEX `kg_priority_idx` ON `knowledge_gaps` (`priorityScore`);--> statement-breakpoint
CREATE INDEX `kg_entity_a_idx` ON `knowledge_gaps` (`entityAId`);--> statement-breakpoint
CREATE INDEX `kg_entity_b_idx` ON `knowledge_gaps` (`entityBId`);