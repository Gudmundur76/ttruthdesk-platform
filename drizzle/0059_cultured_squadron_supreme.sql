CREATE TABLE `paper_embeddings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pmid` varchar(20) NOT NULL,
	`abstractText` text NOT NULL,
	`embedding` mediumtext NOT NULL,
	`embeddingModel` varchar(64) NOT NULL DEFAULT 'text-embedding-3-small',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paper_embeddings_id` PRIMARY KEY(`id`),
	CONSTRAINT `paper_embeddings_pmid_unique` UNIQUE(`pmid`)
);
--> statement-breakpoint
CREATE INDEX `paper_embeddings_pmid_idx` ON `paper_embeddings` (`pmid`);