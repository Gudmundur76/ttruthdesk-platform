CREATE TABLE `graph_claim_edges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceClaimId` int NOT NULL,
	`targetClaimId` int NOT NULL,
	`relationType` enum('semantic_similar','cites','contradicts','supports','refines') NOT NULL DEFAULT 'semantic_similar',
	`weight` float NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `graph_claim_edges_id` PRIMARY KEY(`id`),
	CONSTRAINT `gce_unique_edge` UNIQUE(`sourceClaimId`,`targetClaimId`,`relationType`)
);
--> statement-breakpoint
CREATE INDEX `gce_source_idx` ON `graph_claim_edges` (`sourceClaimId`);--> statement-breakpoint
CREATE INDEX `gce_target_idx` ON `graph_claim_edges` (`targetClaimId`);--> statement-breakpoint
CREATE INDEX `gce_relation_idx` ON `graph_claim_edges` (`relationType`);--> statement-breakpoint
CREATE INDEX `gce_weight_idx` ON `graph_claim_edges` (`weight`);