ALTER TABLE `documents` ADD `llmProvider` varchar(64) DEFAULT 'manus_builtin' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `qualityTier` enum('draft','verified') DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `needsReview` boolean DEFAULT true NOT NULL;