CREATE TABLE `citation_edges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceDocId` int,
	`sourcePmid` varchar(32),
	`sourceTitle` text,
	`targetDocId` int,
	`targetPmid` varchar(32),
	`targetTitle` text,
	`targetDoi` varchar(256),
	`hopNumber` int NOT NULL DEFAULT 1,
	`distortionScore` float,
	`distortionType` enum('faithful','amplification','selective_omission','scope_drift','causal_overclaim','fabrication','unknown') DEFAULT 'unknown',
	`distortionRationale` text,
	`originalClaimId` int,
	`originalClaimText` text,
	`citingClaimText` text,
	`detectedAt` timestamp NOT NULL DEFAULT (now()),
	`analysisStatus` enum('pending','complete','failed','skipped') NOT NULL DEFAULT 'pending',
	CONSTRAINT `citation_edges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `ce_source_doc_idx` ON `citation_edges` (`sourceDocId`);--> statement-breakpoint
CREATE INDEX `ce_target_doc_idx` ON `citation_edges` (`targetDocId`);--> statement-breakpoint
CREATE INDEX `ce_source_pmid_idx` ON `citation_edges` (`sourcePmid`);--> statement-breakpoint
CREATE INDEX `ce_target_pmid_idx` ON `citation_edges` (`targetPmid`);--> statement-breakpoint
CREATE INDEX `ce_hop_idx` ON `citation_edges` (`hopNumber`);--> statement-breakpoint
CREATE INDEX `ce_distortion_type_idx` ON `citation_edges` (`distortionType`);