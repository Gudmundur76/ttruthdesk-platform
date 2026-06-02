CREATE TABLE `audit_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`userId` int NOT NULL,
	`htmlStorageKey` varchar(1024),
	`htmlStorageUrl` varchar(2048),
	`pdfStorageKey` varchar(1024),
	`pdfStorageUrl` varchar(2048),
	`verdictSummary` json,
	`highRiskCount` int NOT NULL DEFAULT 0,
	`totalClaims` int NOT NULL DEFAULT 0,
	`notifiedCustomer` boolean NOT NULL DEFAULT false,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `audit_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `audit_reports_documentId_unique` UNIQUE(`documentId`)
);
--> statement-breakpoint
CREATE TABLE `audit_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tier` enum('starter','diligence','platform_pilot') NOT NULL,
	`contactName` varchar(256) NOT NULL,
	`contactEmail` varchar(320) NOT NULL,
	`organization` varchar(256),
	`documentDescription` text NOT NULL,
	`additionalNotes` text,
	`status` enum('new','in_review','in_progress','complete','declined') NOT NULL DEFAULT 'new',
	`ownerNotified` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `audit_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`claimText` text NOT NULL,
	`claimType` enum('pdb_id','protein_name','experimental_method','resolution','organism','ligand','general_molecular') NOT NULL,
	`extractedValue` varchar(512),
	`pdbId` varchar(16),
	`proteinName` varchar(512),
	`experimentalMethod` varchar(256),
	`resolution` float,
	`organism` varchar(512),
	`ligand` varchar(512),
	`verdict` enum('Supported','Contradicted','Partially Supported','Ambiguous','Insufficient Evidence','Out of Scope','Needs Expert Review'),
	`verdictRationale` text,
	`pdbEvidenceRaw` json,
	`pdbEvidenceUrl` varchar(2048),
	`pdbEvidenceCheckedAt` timestamp,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewNotes` text,
	`overriddenVerdict` enum('Supported','Contradicted','Partially Supported','Ambiguous','Insufficient Evidence','Out of Scope','Needs Expert Review'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `claims_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(512) NOT NULL,
	`sourceType` enum('upload','paste') NOT NULL,
	`originalFileName` varchar(512),
	`storageKey` varchar(1024),
	`storageUrl` varchar(2048),
	`rawText` text,
	`status` enum('pending','extracting','validating','generating_report','complete','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`claimCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitoring_feed` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`source` enum('pubmed','biorxiv','patent') NOT NULL,
	`title` varchar(1024) NOT NULL,
	`summary` text,
	`url` varchar(2048),
	`relevanceScore` float,
	`publishedAt` timestamp,
	`discoveredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `monitoring_feed_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitoring_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`isActive` boolean NOT NULL DEFAULT true,
	`lastRunAt` timestamp,
	`nextRunAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitoring_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `monitoring_jobs_documentId_unique` UNIQUE(`documentId`)
);
