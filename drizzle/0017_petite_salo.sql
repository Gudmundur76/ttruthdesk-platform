CREATE TABLE `entity_cooccurrences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityAId` int NOT NULL,
	`entityBId` int NOT NULL,
	`documentId` int NOT NULL,
	`coCount` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entity_cooccurrences_id` PRIMARY KEY(`id`),
	CONSTRAINT `cooc_entity_pair_doc_idx` UNIQUE(`entityAId`,`entityBId`,`documentId`)
);
--> statement-breakpoint
CREATE INDEX `cooc_entity_a_idx` ON `entity_cooccurrences` (`entityAId`);--> statement-breakpoint
CREATE INDEX `cooc_entity_b_idx` ON `entity_cooccurrences` (`entityBId`);--> statement-breakpoint
CREATE INDEX `cooc_document_id_idx` ON `entity_cooccurrences` (`documentId`);