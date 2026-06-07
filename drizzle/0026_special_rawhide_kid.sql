CREATE TABLE `generated_claims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimText` text NOT NULL,
	`claimType` varchar(64) NOT NULL,
	`inferenceType` enum('gap_fill','homology_projection','contradiction_chase') NOT NULL,
	`requiredSources` json NOT NULL,
	`sourceQuery` text,
	`parentVerifications` json NOT NULL,
	`entityId` int,
	`reasoning` text NOT NULL,
	`passedGate` boolean NOT NULL DEFAULT false,
	`rejectionReason` varchar(256),
	`status` enum('pending','queued','processing','verified','contradicted','insufficient','failed','rejected','deferred') NOT NULL DEFAULT 'pending',
	`coordQueueId` int,
	`priority` int NOT NULL DEFAULT 50,
	`documentId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `generated_claims_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `gc_status_idx` ON `generated_claims` (`status`);--> statement-breakpoint
CREATE INDEX `gc_entity_id_idx` ON `generated_claims` (`entityId`);--> statement-breakpoint
CREATE INDEX `gc_inference_type_idx` ON `generated_claims` (`inferenceType`);--> statement-breakpoint
CREATE INDEX `gc_passed_gate_idx` ON `generated_claims` (`passedGate`);--> statement-breakpoint
CREATE INDEX `gc_created_at_idx` ON `generated_claims` (`createdAt`);