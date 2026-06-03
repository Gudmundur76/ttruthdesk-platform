CREATE INDEX `auto_ingested_papers_status_idx` ON `auto_ingested_papers` (`status`);--> statement-breakpoint
CREATE INDEX `auto_ingested_papers_vertical_idx` ON `auto_ingested_papers` (`verticalDomain`);--> statement-breakpoint
CREATE INDEX `claims_documentId_idx` ON `claims` (`documentId`);--> statement-breakpoint
CREATE INDEX `claims_verdict_idx` ON `claims` (`verdict`);--> statement-breakpoint
CREATE INDEX `documents_userId_idx` ON `documents` (`userId`);--> statement-breakpoint
CREATE INDEX `documents_status_idx` ON `documents` (`status`);--> statement-breakpoint
CREATE INDEX `documents_vertical_idx` ON `documents` (`verticalDomain`);--> statement-breakpoint
CREATE INDEX `monitoring_feed_documentId_idx` ON `monitoring_feed` (`documentId`);