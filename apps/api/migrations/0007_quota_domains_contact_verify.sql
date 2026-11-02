CREATE TABLE `contact_email_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`send_count` integer DEFAULT 0 NOT NULL,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_email_verifications_site_email_unique` ON `contact_email_verifications` (`site_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_email_verifications_token_unique` ON `contact_email_verifications` (`token`);--> statement-breakpoint
ALTER TABLE `ai_usage` ADD `status` text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE `domains` ADD `verification_token` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `domains` ADD `ownership_verified_at` integer;