CREATE TABLE IF NOT EXISTS `entries` (
	`date` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notification_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notification_deliveries` (
	`schedule_id` text NOT NULL,
	`local_date` text NOT NULL,
	`endpoint` text NOT NULL,
	`sent_at` text NOT NULL,
	PRIMARY KEY(`schedule_id`, `local_date`, `endpoint`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notification_suppressions` (
	`schedule_id` text NOT NULL,
	`local_date` text NOT NULL,
	`checked_at` text NOT NULL,
	PRIMARY KEY(`schedule_id`, `local_date`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `revisions_date_created` ON `revisions` (`date`,"created_at" desc);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
