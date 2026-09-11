ALTER TABLE `chats` ADD `last_viewed_at` integer;--> statement-breakpoint
ALTER TABLE `chats` ADD `accent_color` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `accent_color` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `show_in_rail` integer DEFAULT true NOT NULL;