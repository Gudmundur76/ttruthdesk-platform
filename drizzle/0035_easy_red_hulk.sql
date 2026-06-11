CREATE TABLE `sia_generations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(64) NOT NULL,
	`generation` int NOT NULL,
	`combinedScore` float NOT NULL,
	`citationStateAccuracy` float NOT NULL,
	`passagePrecision` float NOT NULL,
	`misrepresentationRecall` float NOT NULL,
	`nTotal` int NOT NULL,
	`nEvaluated` int NOT NULL,
	`targetAgentCode` text NOT NULL,
	`improvementMd` text,
	`createdAt` int NOT NULL,
	CONSTRAINT `sia_generations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sia_improvement_proposals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(64) NOT NULL,
	`generation` int NOT NULL,
	`combinedScore` float NOT NULL,
	`scoreDelta` float NOT NULL,
	`proposal` text NOT NULL,
	`status` enum('pending_review','approved','rejected','applied') NOT NULL DEFAULT 'pending_review',
	`reviewNote` text,
	`reviewedAt` int,
	`reviewedBy` int,
	`createdAt` int NOT NULL,
	CONSTRAINT `sia_improvement_proposals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `sia_gen_run_id_idx` ON `sia_generations` (`runId`);--> statement-breakpoint
CREATE INDEX `sia_gen_score_idx` ON `sia_generations` (`combinedScore`);--> statement-breakpoint
CREATE INDEX `sia_prop_run_id_idx` ON `sia_improvement_proposals` (`runId`);--> statement-breakpoint
CREATE INDEX `sia_prop_status_idx` ON `sia_improvement_proposals` (`status`);