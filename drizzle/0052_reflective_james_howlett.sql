ALTER TABLE `self_prompt_log` ADD `directivesIssued` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `self_prompt_log` ADD `directivesConsumed7d` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `self_prompt_log` ADD `llmRawResponse` text;--> statement-breakpoint
ALTER TABLE `self_prompt_log` ADD `llmResponseMs` int;--> statement-breakpoint
ALTER TABLE `self_prompt_log` ADD `executionMs` int;--> statement-breakpoint
ALTER TABLE `self_prompt_log` ADD `totalDurationMs` int;