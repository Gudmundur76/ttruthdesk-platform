CREATE TABLE `saved_research` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`question` text NOT NULL,
	`claimsJson` json NOT NULL DEFAULT ('[]'),
	`totalPapers` int NOT NULL DEFAULT 0,
	`supportedClaims` int NOT NULL DEFAULT 0,
	`claimsAnalysed` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `saved_research_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `sr_user_id_idx` ON `saved_research` (`userId`);