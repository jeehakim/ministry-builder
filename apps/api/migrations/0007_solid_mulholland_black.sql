CREATE TABLE `org_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target` text,
	`detail_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `org_events_org_id_created_at_idx` ON `org_events` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `org_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_invitations_token_hash_unique` ON `org_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `org_invitations_org_id_created_at_idx` ON `org_invitations` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `org_members` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `org_members_user_id_idx` ON `org_members` (`user_id`);--> statement-breakpoint
ALTER TABLE `ai_usage` ADD `org_id` text REFERENCES organizations(id);--> statement-breakpoint
CREATE INDEX `ai_usage_org_id_created_at_idx` ON `ai_usage` (`org_id`,`created_at`);--> statement-breakpoint
INSERT INTO `org_members` (`org_id`, `user_id`, `role`, `invited_by`, `joined_at`) SELECT `id`, `owner_user_id`, 'owner', NULL, `created_at` FROM `organizations`;--> statement-breakpoint
UPDATE `ai_usage` SET `org_id` = (SELECT `org_id` FROM `sites` WHERE `sites`.`id` = `ai_usage`.`site_id`) WHERE `site_id` IS NOT NULL;
