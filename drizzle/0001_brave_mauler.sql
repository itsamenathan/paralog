CREATE TABLE `attachment_references` (
	`attachment_path` text NOT NULL,
	`entry_date` text NOT NULL,
	`occurrences` integer NOT NULL,
	PRIMARY KEY(`attachment_path`, `entry_date`)
);
--> statement-breakpoint
CREATE INDEX `attachment_references_entry_date` ON `attachment_references` (`entry_date`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`path` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`media_type` text NOT NULL,
	`kind` text NOT NULL,
	`size` integer NOT NULL,
	`added_at` text NOT NULL,
	`modified_at` text NOT NULL,
	`indexed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attachments_kind` ON `attachments` (`kind`);--> statement-breakpoint
CREATE INDEX `attachments_added_at` ON `attachments` (`added_at`);--> statement-breakpoint
CREATE INDEX `attachments_display_name` ON `attachments` (`display_name`);--> statement-breakpoint
CREATE TABLE `entry_content_scans` (
	`entry_date` text PRIMARY KEY NOT NULL,
	`entry_path` text NOT NULL,
	`entry_updated_at` text NOT NULL,
	`entry_size` integer NOT NULL,
	`index_version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `journal_references` (
	`entry_date` text NOT NULL,
	`kind` text NOT NULL,
	`normalized_name` text NOT NULL,
	`display_name` text NOT NULL,
	`occurrences` integer NOT NULL,
	PRIMARY KEY(`entry_date`, `kind`, `normalized_name`)
);
--> statement-breakpoint
CREATE INDEX `journal_references_kind_name` ON `journal_references` (`kind`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `journal_references_entry_date` ON `journal_references` (`entry_date`);