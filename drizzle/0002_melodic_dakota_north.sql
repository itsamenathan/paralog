CREATE TABLE `entry_properties` (
	`entry_date` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`entry_date`, `name`)
);
--> statement-breakpoint
CREATE INDEX `entry_properties_name` ON `entry_properties` (`name`);