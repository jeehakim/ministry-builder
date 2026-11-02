CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`hostname` text NOT NULL,
	`kind` text NOT NULL,
	`cf_custom_hostname_id` text,
	`ssl_status` text DEFAULT 'pending' NOT NULL,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_hostname_unique` ON `domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `domains_site_id_idx` ON `domains` (`site_id`);