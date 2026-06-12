CREATE TABLE `citations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimId` int NOT NULL,
	`documentId` int NOT NULL,
	`passageText` text,
	`passageSection` varchar(128),
	`citationType` enum('VERIFIED','CONTESTED','IMPLIED','BEYOND_EVIDENCE') NOT NULL,
	`citationConfidence` float NOT NULL DEFAULT 0,
	`evidenceBoundary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `citations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prompt_harness` (
	`id` int AUTO_INCREMENT NOT NULL,
	`component` enum('claim_extractor','verdict_rationale','passage_extractor','misrep_classifier') NOT NULL,
	`generation` int NOT NULL DEFAULT 1,
	`promptText` text NOT NULL,
	`isActive` boolean NOT NULL DEFAULT false,
	`upgradeRate` float,
	`failRate` float,
	`avgClaimsPerDoc` float,
	`improvementProposalId` int,
	`activatedAt` int,
	`createdAt` int NOT NULL,
	CONSTRAINT `prompt_harness_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quality_pass_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runDate` varchar(32) NOT NULL,
	`batchSize` int NOT NULL,
	`processed` int NOT NULL,
	`skipped` int NOT NULL,
	`failed` int NOT NULL,
	`verdictSupported` int NOT NULL DEFAULT 0,
	`verdictContested` int NOT NULL DEFAULT 0,
	`verdictInsufficient` int NOT NULL DEFAULT 0,
	`verdictContradicted` int NOT NULL DEFAULT 0,
	`upgradeRate` float NOT NULL DEFAULT 0,
	`avgClaimsPerDoc` float NOT NULL DEFAULT 0,
	`harnessGeneration` int NOT NULL DEFAULT 1,
	`feedbackProposalId` int,
	`feedbackReasoning` text,
	`createdAt` int NOT NULL,
	CONSTRAINT `quality_pass_feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `cit_claim_id_idx` ON `citations` (`claimId`);--> statement-breakpoint
CREATE INDEX `cit_document_id_idx` ON `citations` (`documentId`);--> statement-breakpoint
CREATE INDEX `cit_citation_type_idx` ON `citations` (`citationType`);--> statement-breakpoint
CREATE INDEX `ph_component_active_idx` ON `prompt_harness` (`component`,`isActive`);--> statement-breakpoint
CREATE INDEX `ph_generation_idx` ON `prompt_harness` (`generation`);--> statement-breakpoint
CREATE INDEX `qpf_run_date_idx` ON `quality_pass_feedback` (`runDate`);--> statement-breakpoint
CREATE INDEX `qpf_harness_gen_idx` ON `quality_pass_feedback` (`harnessGeneration`);