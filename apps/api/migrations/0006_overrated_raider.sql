CREATE TABLE `integration_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `integration_events_org_id_kind_created_at_idx` ON `integration_events` (`org_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `org_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`provider` text DEFAULT 'resend' NOT NULL,
	`encrypted_key` text NOT NULL,
	`key_hint` text NOT NULL,
	`from_address` text,
	`from_name` text,
	`verified_domains_json` text DEFAULT '[]' NOT NULL,
	`tested_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_integrations_org_id_unique` ON `org_integrations` (`org_id`);--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `delivered_via` text;