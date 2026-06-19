CREATE TABLE `adapter_calibration_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(64) NOT NULL,
	`adapterId` varchar(128) NOT NULL,
	`documentId` varchar(16) NOT NULL,
	`claimsExtracted` int NOT NULL DEFAULT 0,
	`claimsSupported` int NOT NULL DEFAULT 0,
	`claimsRefuted` int NOT NULL DEFAULT 0,
	`claimsUnverifiable` int NOT NULL DEFAULT 0,
	`precisionScore` float NOT NULL DEFAULT 0,
	`recallScore` float NOT NULL DEFAULT 0,
	`f1Score` float NOT NULL DEFAULT 0,
	`failureGroup` enum('G1','G2','G3','G4') NOT NULL DEFAULT 'G4',
	`errorCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `adapter_calibration_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `adapter_prompt_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adapterId` varchar(128) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`promptText` text NOT NULL,
	`failureGroup` varchar(4) NOT NULL DEFAULT 'G4',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `adapter_prompt_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `run_adapter_idx` ON `adapter_calibration_runs` (`runId`,`adapterId`);--> statement-breakpoint
CREATE INDEX `adapter_active_idx` ON `adapter_prompt_versions` (`adapterId`,`isActive`);