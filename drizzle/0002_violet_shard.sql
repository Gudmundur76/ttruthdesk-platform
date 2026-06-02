CREATE TABLE `auto_ingested_papers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pmid` varchar(32) NOT NULL,
	`doi` varchar(512),
	`title` varchar(1024) NOT NULL,
	`authors` text,
	`journal` varchar(512),
	`pubYear` varchar(8),
	`searchQuery` varchar(512) NOT NULL,
	`documentId` int,
	`status` enum('fetched','submitted','complete','failed') NOT NULL DEFAULT 'fetched',
	`errorMessage` text,
	`isPublic` boolean NOT NULL DEFAULT true,
	`ingestedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `auto_ingested_papers_id` PRIMARY KEY(`id`),
	CONSTRAINT `auto_ingested_papers_pmid_unique` UNIQUE(`pmid`)
);
