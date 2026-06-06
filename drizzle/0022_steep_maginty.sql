CREATE TABLE `llm_provider_quality` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelId` varchar(128) NOT NULL,
	`modelName` varchar(256) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`isFree` boolean NOT NULL DEFAULT false,
	`allowedForHighStakes` boolean NOT NULL DEFAULT true,
	`totalClaims` int NOT NULL DEFAULT 0,
	`correctPredictions` int NOT NULL DEFAULT 0,
	`accuracyRate` float,
	`avgConfidence` float,
	`brierScore` float,
	`isBanned` boolean NOT NULL DEFAULT false,
	`banReason` text,
	`lastUpdatedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `llm_provider_quality_id` PRIMARY KEY(`id`),
	CONSTRAINT `llm_provider_quality_modelId_unique` UNIQUE(`modelId`),
	CONSTRAINT `lpq_model_id_idx` UNIQUE(`modelId`)
);
--> statement-breakpoint
CREATE TABLE `override_audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimId` int NOT NULL,
	`documentId` int NOT NULL,
	`overriddenBy` int NOT NULL,
	`originalVerdict` enum('Supported','Contradicted','Partially Supported','Ambiguous','Insufficient Evidence','Out of Scope','Needs Expert Review') NOT NULL,
	`newVerdict` enum('Supported','Contradicted','Partially Supported','Ambiguous','Insufficient Evidence','Out of Scope','Needs Expert Review') NOT NULL,
	`justification` text NOT NULL,
	`overrideCategory` enum('domain_expertise','new_evidence','context_clarification','scope_adjustment','error_correction') NOT NULL,
	`wikiLogged` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `override_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prediction_calibration` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelType` enum('claim_trajectory','author_reliability','consensus_velocity','market_signal','citation_decay') NOT NULL,
	`plattW` float NOT NULL DEFAULT 1,
	`plattB` float NOT NULL DEFAULT 0,
	`featureWeights` json NOT NULL,
	`trainingSampleSize` int NOT NULL DEFAULT 0,
	`brierScore` float,
	`logLoss` float,
	`isActive` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prediction_calibration_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `lpq_provider_idx` ON `llm_provider_quality` (`provider`);--> statement-breakpoint
CREATE INDEX `lpq_banned_idx` ON `llm_provider_quality` (`isBanned`);--> statement-breakpoint
CREATE INDEX `lpq_high_stakes_idx` ON `llm_provider_quality` (`allowedForHighStakes`);--> statement-breakpoint
CREATE INDEX `oal_claim_id_idx` ON `override_audit_log` (`claimId`);--> statement-breakpoint
CREATE INDEX `oal_document_id_idx` ON `override_audit_log` (`documentId`);--> statement-breakpoint
CREATE INDEX `oal_overridden_by_idx` ON `override_audit_log` (`overriddenBy`);--> statement-breakpoint
CREATE INDEX `oal_created_at_idx` ON `override_audit_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `pc_model_type_idx` ON `prediction_calibration` (`modelType`);--> statement-breakpoint
CREATE INDEX `pc_active_idx` ON `prediction_calibration` (`isActive`);