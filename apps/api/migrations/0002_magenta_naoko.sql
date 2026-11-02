CREATE TABLE `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`message` text NOT NULL,
	`language` text NOT NULL,
	`ip_hash` text NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`delivered_at` integer,
	`delivery_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `form_submissions_site_id_created_at_idx` ON `form_submissions` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `form_submissions_ip_hash_created_at_idx` ON `form_submissions` (`ip_hash`,`created_at`);