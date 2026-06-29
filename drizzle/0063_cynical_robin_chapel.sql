ALTER TABLE `auto_ingested_papers` MODIFY COLUMN `pmid` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `citation_edges` ADD `quantumProvenance` json;--> statement-breakpoint
ALTER TABLE `claims` ADD `modelReasoning` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `sourceRefs` json;--> statement-breakpoint
ALTER TABLE `documents` ADD `factCheckPreamble` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `overallVerdict` varchar(64);--> statement-breakpoint
ALTER TABLE `documents` ADD `relevanceAnalysis` json;