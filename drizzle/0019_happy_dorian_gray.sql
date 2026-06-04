CREATE TABLE `api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`keyHash` varchar(64) NOT NULL,
	`label` varchar(128) NOT NULL,
	`scopes` json NOT NULL,
	`keyPrefix` varchar(16) NOT NULL,
	`lastUsedAt` timestamp,
	`revokedAt` timestamp,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_keyHash_unique` UNIQUE(`keyHash`),
	CONSTRAINT `ak_key_hash_idx` UNIQUE(`keyHash`)
);
--> statement-breakpoint
CREATE INDEX `ak_user_id_idx` ON `api_keys` (`userId`);--> statement-breakpoint
CREATE INDEX `ak_revoked_at_idx` ON `api_keys` (`revokedAt`);