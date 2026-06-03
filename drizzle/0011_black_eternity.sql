CREATE TABLE `prediction_features` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`userId` int,
	`featureType` enum('contradiction_rate','claim_velocity','author_contradiction_history','method_reliability','temporal_drift','network_centrality','evidence_strength_distribution') NOT NULL,
	`value` float NOT NULL,
	`sampleSize` int NOT NULL DEFAULT 0,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prediction_features_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prediction_models` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelType` enum('claim_trajectory','author_reliability','consensus_velocity','market_signal','citation_decay') NOT NULL,
	`targetEntityId` int,
	`targetClaimId` int,
	`targetUserId` int,
	`prediction` json NOT NULL,
	`baseRate` float,
	`featuresUsed` json,
	`validatedAt` timestamp,
	`validationResult` enum('correct','incorrect','pending') DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prediction_models_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `pf_entity_feature_idx` ON `prediction_features` (`entityId`,`featureType`);--> statement-breakpoint
CREATE INDEX `pf_user_feature_idx` ON `prediction_features` (`userId`,`featureType`);--> statement-breakpoint
CREATE INDEX `pm_claim_idx` ON `prediction_models` (`targetClaimId`);--> statement-breakpoint
CREATE INDEX `pm_entity_idx` ON `prediction_models` (`targetEntityId`);--> statement-breakpoint
CREATE INDEX `pm_user_idx` ON `prediction_models` (`targetUserId`);--> statement-breakpoint
CREATE INDEX `pm_type_idx` ON `prediction_models` (`modelType`);