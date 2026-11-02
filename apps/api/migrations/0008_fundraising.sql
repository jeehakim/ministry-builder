CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`site_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`story` text DEFAULT '' NOT NULL,
	`goal_amount` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`deadline` text,
	`cover_image_json` text,
	`suggested_amounts_json` text DEFAULT '[]' NOT NULL,
	`give_url` text DEFAULT '' NOT NULL,
	`give_label` text DEFAULT '' NOT NULL,
	`donor_wall_enabled` integer DEFAULT false NOT NULL,
	`thank_you_message` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`translations_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_site_id_slug_unique` ON `campaigns` (`site_id`,`slug`);--> statement-breakpoint
CREATE INDEX `campaigns_org_id_idx` ON `campaigns` (`org_id`);--> statement-breakpoint
CREATE TABLE `donors` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `donors_org_id_email_unique` ON `donors` (`org_id`,`email`);--> statement-breakpoint
CREATE TABLE `gifts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`donor_id` text,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	`donor_name` text DEFAULT '' NOT NULL,
	`donor_email` text DEFAULT '' NOT NULL,
	`public` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`received_at` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`thank_you_sent_at` integer,
	`thank_you_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`donor_id`) REFERENCES `donors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `gifts_campaign_id_received_at_idx` ON `gifts` (`campaign_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `gifts_org_id_idx` ON `gifts` (`org_id`);--> statement-breakpoint
CREATE INDEX `gifts_donor_id_idx` ON `gifts` (`donor_id`);