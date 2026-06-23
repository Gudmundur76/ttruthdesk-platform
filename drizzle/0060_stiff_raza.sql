CREATE TABLE `quantum_vqe_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` varchar(128) NOT NULL,
	`citationEdgeId` int,
	`smiles` varchar(1024),
	`backend` varchar(64) NOT NULL DEFAULT 'WK_C180_2',
	`shots` int NOT NULL DEFAULT 1000,
	`status` enum('pending','computing','done','failed') NOT NULL DEFAULT 'pending',
	`vqeEnergyHartree` float,
	`resultRaw` json,
	`errorMessage` text,
	`submittedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `quantum_vqe_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `quantum_vqe_jobs_jobId_unique` UNIQUE(`jobId`)
);
--> statement-breakpoint
ALTER TABLE `knowledge_gaps` MODIFY COLUMN `gapType` enum('structural','evidence','contradiction','temporal','hypothesis','quantum_provenance') NOT NULL;--> statement-breakpoint
CREATE INDEX `qvj_job_id_idx` ON `quantum_vqe_jobs` (`jobId`);--> statement-breakpoint
CREATE INDEX `qvj_status_idx` ON `quantum_vqe_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `qvj_edge_idx` ON `quantum_vqe_jobs` (`citationEdgeId`);