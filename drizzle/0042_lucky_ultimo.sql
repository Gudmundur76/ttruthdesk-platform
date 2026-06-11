CREATE TABLE `claim_score_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`claimId` int NOT NULL,
	`compositeTruthScore` float NOT NULL,
	`compositeTruthLabel` varchar(64),
	`triggerSource` varchar(64) NOT NULL DEFAULT 're-evaluation',
	`snapshotAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `claim_score_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `csh_unique_snapshot` UNIQUE(`claimId`,`snapshotAt`)
);
--> statement-breakpoint
CREATE INDEX `csh_claim_id_idx` ON `claim_score_history` (`claimId`);--> statement-breakpoint
CREATE INDEX `csh_snapshot_at_idx` ON `claim_score_history` (`snapshotAt`);