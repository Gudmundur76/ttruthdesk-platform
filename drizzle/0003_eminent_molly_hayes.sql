ALTER TABLE `auto_ingested_papers` ADD `verticalDomain` varchar(64) DEFAULT 'structural_biology' NOT NULL;--> statement-breakpoint
ALTER TABLE `auto_ingested_papers` ADD `ingestSource` enum('pubmed','biorxiv','pdb_linked') DEFAULT 'pubmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `claims` ADD `confidenceScore` float;--> statement-breakpoint
ALTER TABLE `claims` ADD `confidenceFlags` json;--> statement-breakpoint
ALTER TABLE `documents` ADD `verticalDomain` varchar(64) DEFAULT 'structural_biology' NOT NULL;