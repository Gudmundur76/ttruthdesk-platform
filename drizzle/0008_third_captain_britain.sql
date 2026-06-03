CREATE TABLE `graph_entities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` enum('protein','pdb_id','method','organism','ligand','author','concept','document') NOT NULL,
	`canonicalName` varchar(512) NOT NULL,
	`wikiPagePath` varchar(1024),
	`firstSeenDocumentId` int,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `graph_entities_id` PRIMARY KEY(`id`),
	CONSTRAINT `entity_canonical_unique` UNIQUE(`entityType`,`canonicalName`)
);
--> statement-breakpoint
CREATE TABLE `graph_relations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceEntityId` int NOT NULL,
	`targetEntityId` int NOT NULL,
	`relationType` enum('cites','contradicts','validates','homologous_to','binds','expressed_in','uses_method','authored_by','related_to') NOT NULL,
	`evidenceDocumentId` int,
	`confidenceScore` float,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `graph_relations_id` PRIMARY KEY(`id`),
	CONSTRAINT `relation_unique` UNIQUE(`sourceEntityId`,`targetEntityId`,`relationType`)
);
--> statement-breakpoint
CREATE INDEX `entity_type_name_idx` ON `graph_entities` (`entityType`,`canonicalName`);--> statement-breakpoint
CREATE INDEX `relation_source_idx` ON `graph_relations` (`sourceEntityId`);--> statement-breakpoint
CREATE INDEX `relation_target_idx` ON `graph_relations` (`targetEntityId`);--> statement-breakpoint
CREATE INDEX `relation_type_idx` ON `graph_relations` (`relationType`);