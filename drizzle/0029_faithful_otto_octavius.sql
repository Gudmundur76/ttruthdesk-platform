ALTER TABLE `dream_sessions` MODIFY COLUMN `patternLog` json;--> statement-breakpoint
ALTER TABLE `dream_sessions` MODIFY COLUMN `simulationLog` json;--> statement-breakpoint
ALTER TABLE `dream_sessions` MODIFY COLUMN `recalibrationLog` json;--> statement-breakpoint
ALTER TABLE `claims` ADD `verdictMethod` enum('deterministic_source','confidence_threshold','completeness_gate','override','fallback');--> statement-breakpoint
ALTER TABLE `claims` ADD `sourceCompletenessScore` float;